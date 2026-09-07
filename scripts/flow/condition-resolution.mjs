/**
 * @fileoverview コンディションのカード決定(衰弱/重圧のドロー)と controlNegate(制御判定での無効/降格)
 * の解決メカニクス(フェーズ9-4)。設計: Conditions.md §8 / damage-chart の controlNegate。
 *
 * 実機確認はダメージ判定システム(フェーズ12)が要るため未検証。メカニクスのみ実装し、修正は12。
 * 純粋ロジック(conditionNeedsDraw / drawResultFlags / negateOutcome)は Foundry 非依存でテスト可能。
 * Foundry 連携(山札ドロー・チャット受付・制御判定)はその上に載せる。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { getCardCheckValue, normalizeSuit } from '../rules/tnx-check-engine.mjs';
import { TnxActionHandler } from '../cards/tnx-action-handler.mjs';
import { TnxSocketHandler } from '../core/tnx-socket-handler.mjs';
import { CONDITION_KINDS, conditionDisplayName, readConditions } from '../rules/conditions.mjs';
import { cardField, cardResult } from '../chat/chat-card.mjs';
import { getDamageChartKind } from '../data/damage-chart.mjs';
import { conditionNeedsDraw, drawResultFlags, negateOutcome } from '../rules/condition-resolution.mjs';
import { idKeyPrefix, ONOMASTIC_TYPES } from '../dictionary/skill-dictionary.mjs';


// 純粋ロジックは core 側(Foundry 非依存・テスト可)。利便のため re-export する。
export { conditionNeedsDraw, drawResultFlags, negateOutcome };

/**
 * ダメージ値からチャートを参照し、該当する**負傷状態をアクターに付与**する(フェーズ9-4)。
 * 付与した負傷状態は status のみ・hideFromList(ダメージ由来=供給元が浮く)。付与で createActiveEffect
 * フックが走り、inflicts のカスケード(BS/戦闘不能)＋ドロー/controlNegate 受付が連動する。
 * ダメージ値の**算出本体(カード＋攻撃力−軽減)はフェーズ12**で、本関数はその適用入口。
 * @param {Actor} actor
 * @param {"physical"|"mental"|"social"} category
 * @param {number} value 最終ダメージ(チャート参照値は min(value,21)、0=付与なし)
 * @returns {Promise<?ActiveEffect>} 付与した負傷状態(0/不正は null)
 */
export async function applyDamageChartResult(actor, category, value, { persuade = false, extraFlags = null } = {}) {
  const kind = getDamageChartKind(category, value);
  if (!kind || !actor) return null;
  const def = CONDITION_KINDS[kind];
  // extraFlags(17-3): 神業由来の印(fromMiracle)等を負傷に刻む。カスケード(createActiveEffect フック)が
  // 付与する戦闘不能・BS にも同じ印が伝わる
  // 治療の目標値算出(「それ以外＝そのダメージの数値」)のため、発生時のダメージ値と系統を負傷に保存する。
  // 付与で走る createActiveEffect フックが、この負傷の inflicts(戦闘不能・BS)への woundSource 紐づけ・
  // 社会/コネの選択(promptWoundSkillSelection)を担う(付与経路を問わない=2026-07-16 是正)。
  // 休眠(次シーン)は def.sceneDeferred から readConditions が導出する(フラグ設定不要)。
  // persuade=説得(精神)は、フック側で戦闘不能タグ(効果タグ)を付けない目印。BS は通常どおり付与。
  const [eff] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: conditionDisplayName(kind), img: def?.img, statuses: [kind],
    flags: { [SYSTEM_ID]: { conditionKind: kind, hideFromList: true, woundValue: value, woundCategory: category,
      ...(persuade ? { persuade: true } : {}), ...(extraFlags ?? {}) } },
  }]);
  return eff ?? null;
}

/**
 * 選択型(社会/コネ)の負傷が付与されたとき、使用不可にする技能を選ばせて targetSkill を確定する。
 * createActiveEffect フックから呼ぶ(付与経路を問わない=ダメージ適用でもトークントグルでも手動でも)。
 * 既に確定済み・候補ゼロはスキップ。付与ユーザー(=対象の所有者/GM・フック `userId` 一致)の画面で選ぶ。
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 */
export async function promptWoundSkillSelection(actor, effect) {
  for (const c of readConditions(effect)) {
    const cat = c.def?.skillBlock?.category;
    if (!cat || c.targetSkill) continue; // 選択型のみ・確定済みはスキップ
    const picked = await promptSelectRestrictedSkill(actor, cat, c.def.label);
    if (picked) await effect.setFlag(SYSTEM_ID, `conditions.${c.kind}.targetSkill`, picked);
  }
}

/**
 * 社会/コネ「ひとつ使用不可」(造反/人脈消失/スキャンダル/信頼喪失)の対象技能を、付与時に選ばせる。
 * 候補は対象アクターが所持する該当プレフィックス(society_/contact_)の一般技能。保存は識別キー・表示は
 * 技能名(名前で識別しない)。候補が無ければ通知して null(使用不可にする技能なし=負傷自体は付与される)。
 * @param {Actor} actor
 * @param {"society"|"contact"} category
 * @param {string} woundLabel
 * @returns {Promise<?string>} 選択した技能の識別キー(null=候補なし/キャンセル)
 */
async function promptSelectRestrictedSkill(actor, category, woundLabel) {
  const esc = foundry.utils.escapeHTML;
  const catLabel = ONOMASTIC_TYPES[category] ?? category;
  const candidates = (actor.items ?? []).filter(it =>
    it.type === "generalSkill" && idKeyPrefix(it.system?.identificationKey) === category);
  if (!candidates.length) {
    ui.notifications.info(`「${woundLabel}」: 対象は〈${catLabel}〉技能を持たないため、使用不可にする技能がありません。`);
    return null;
  }
  const opts = candidates
    .map(it => `<option value="${esc(it.system.identificationKey)}">${esc(it.name)}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.wait({
    window:  { title: `${woundLabel}: 使用不可にする〈${catLabel}〉を選択` },
    classes: ["tokyo-nova"],
    content: `<div class="form-group"><label>使用不可にする〈${catLabel}〉技能</label>`
      + `<div class="form-fields"><select name="skill">${opts}</select></div></div>`,
    buttons: [
      { action: "ok", icon: "fas fa-check", label: "決定", default: true,
        callback: (_e, _btn, dlg) => dlg.element.querySelector('[name="skill"]').value || null },
    ],
    close: () => null,
  });
}

// ───────── Foundry 連携 ─────────

/** 状態解決カードのステータス → アイコン。 */
const OUTCOME_ICON = Object.freeze({
  success: "fa-check", failure: "fa-times", damage: "fa-burst", info: "fa-circle-info",
});

/**
 * 状態の解決結果カードを投稿する(治療・カード決定ドロー等の共通)。
 * チャットカードの統一規格(condition-outcome.hbs)で出す。素のインライン div は使わない。
 * @param {?Actor} speakerActor
 * @param {{title:string, tag?:string, status?:string, label?:string, text?:string}} opts
 *   title=名前(用途名・状態名)・tag=種別(回復/改造/修理/効果決定)
 */
export async function postConditionOutcome(speakerActor, { title, tag = "", status = "info", label = "", text = "" } = {}) {
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/condition-outcome.hbs",
    { title, tag, status, icon: OUTCOME_ICON[status] ?? OUTCOME_ICON.info, label, text }
  );
  await ChatMessage.create({
    content,
    speaker: speakerActor ? ChatMessage.getSpeaker({ actor: speakerActor }) : undefined,
  });
}

/** 山札から1枚、捨て札へ引いてカードを返す(受付なし・即時)。山札空は null。 */
async function drawOneToDiscard() {
  const deck = await TnxActionHandler.getActiveDeck();
  const discard = await TnxActionHandler.getActiveDiscardPile();
  if (!deck || !discard || !deck.availableCards?.length) return null;
  // Cards#draw は「this へ from から引く」= 捨て札.draw(山札)。逆向き(deck.draw(discard))だと
  // 捨て札から引こうとして "not available cards" エラーになる(2026-07-11 ユーザー報告で修正)。
  // draw 直後は裏向き(face:-1)で suit が読めないため、表向きにして捨て札山から再取得する
  const [drawn] = await discard.draw(deck, 1, { chatNotification: false });
  if (!drawn) return null;
  await discard.updateEmbeddedDocuments("Card", [{ _id: drawn.id, face: 0 }]);
  return discard.cards.get(drawn.id) ?? drawn;
}

/**
 * 付与された状態(衰弱/重圧でドロー要)に対し「効果決定」チャットを出す。
 * ボタンと結果はカードを分けず、同一カードの状態領域をフラグ(conditionDraw)から
 * ライブ描画する(未解決=山札を引くボタン/解決後=結果表示に置換。checkRequest/攻撃カードと
 * 同型・2026-07-12 ユーザー指示でカード2枚方式を廃止)。
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @param {string} kind
 */
export async function postDrawPrompt(actor, effect, kind, { magnitude = null } = {}) {
  const label = conditionDisplayName(kind);
  // 邪毒はクリンナップのたびに引く継続ダメージ。誰が引くかは卓に委ねる(受けたキャラクターを
  // 操作しているプレイヤーか RL が引く想定・2026-08-29 ユーザー)ため、ボタンは全体に出す
  const promptText = kind === "poison"
    ? "クリンナップの継続ダメージをカードで決定します。"
    : "この状態の効果をカードで決定します。";
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/condition-prompt.hbs",
    { label, promptText }
  );
  // 全体公開(2026-07-11 ユーザー確定: 個人送信チャットは判定要求の任意選択以外に存在させない)
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: {
      [SYSTEM_ID]: {
        conditionDraw: {
          actorUuid: actor.uuid, effectId: effect.id, kind,
          ...(magnitude === null ? {} : { magnitude }),
          resolved: false, suit: "", value: null, detail: "",
        },
      },
    },
  });
}

/**
 * 効果決定カードの状態領域をフラグから描画する(renderChatMessageHTML・tnx.mjs から登録)。
 * 未解決=「山札を引く」ボタン/解決後=引いたカード+効果の結果表示。
 */
export function renderConditionDrawCard(message, html) {
  const f = message.getFlag(SYSTEM_ID, "conditionDraw");
  if (!f) return;
  const area = html.querySelector(".tnx-condition-status");
  if (!area) return;
  area.replaceChildren();

  const esc = foundry.utils.escapeHTML;
  if (f.resolved) {
    const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
    if (f.suit) {
      area.appendChild(cardField("引いたカード",
        `<span class="cr-suit suit-${esc(f.suit)}">${SUIT_SYMBOL[f.suit] ?? ""}</span>`
        + `${f.value ? ` ${f.value}` : ""}${f.wild ? "（ワイルドカード指定）" : ""}`));
    }
    area.appendChild(cardResult(`<i class="fas fa-circle-info"></i> ${esc(f.detail ?? "")}`,
      { modifier: "tnx-card__result--info" }));
    return;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tnx-chat-btn";
  btn.innerHTML = '<i class="fas fa-diamond"></i> 山札を引く';
  btn.addEventListener("click", async () => {
    const actor = await fromUuid(f.actorUuid).catch(() => null);
    const effect = actor?.effects?.get(f.effectId)
      ?? actor?.allApplicableEffects?.().find?.(e => e.id === f.effectId);
    if (!actor || !effect) return ui.notifications.warn("対象の状態が見つかりません。");
    btn.disabled = true;
    try {
      if (f.kind === "poison") await resolvePoisonDraw(actor, effect, f.magnitude ?? 0, message);
      else await executeConditionDraw(actor, effect, f.kind, message);
    } finally {
      btn.disabled = false; // キャンセル時に押し直せるように(解決済みなら再描画で消える)
    }
  });
  area.appendChild(btn);
}

/** ドローを実行して結果を condition フラグに書き、チャットに記録する。 */
export async function executeConditionDraw(actor, effect, kind, message = null) {
  let suit, value, wild = false;
  const card = await drawOneToDiscard();
  // スートは正規化して読む(Foundry 標準デッキは複数形 "spades" 等のため。未正規化のままだと
  // SUIT_TO_ABILITY に合致せず対応能力値が「？」になる=2026-07-11 ユーザー報告で修正)。
  // 正規化できないスートもジョーカー扱いでワイルドカード指定に流す
  const normalized = card ? normalizeSuit(card.suit) : null;
  const isJoker = !card || card.suit === "joker" || card.value === 99 || !normalized;
  if (isJoker) {
    const wildPick = await promptJokerWildcard(kind); // 引き直し or ワイルドカード指定
    if (wildPick === "redraw") return executeConditionDraw(actor, effect, kind, message);
    if (!wildPick) return; // キャンセル
    suit = wildPick.suit; value = wildPick.value; wild = true;
  } else {
    suit = normalized;
    const ncheck = getCardCheckValue({ numericValue: card.value });
    value = typeof ncheck === "number" ? ncheck : Number(card.value) || 0;
  }
  const flags = drawResultFlags(kind, suit, value);
  await effect.setFlag(SYSTEM_ID, `conditions.${kind}`, flags);

  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  const detail = kind === "weakness"
    ? `${ABIL[flags.targetAbility] ?? "?"}の制御値 -${flags.magnitude}`
    : `${ABIL[flags.targetAbility] ?? "?"}を使う判定が不可`;

  // 効果決定カード自身の状態領域を結果表示に置き換える(カードを分けない・2026-07-12)。
  // フラグ更新は非作者なら GM へ委譲(applyMessagePatch=自スコープフラグ限定の汎用パッチ委譲)
  if (message) {
    await TnxSocketHandler.applyMessagePatch(message,
      { resolved: true, suit, value, wild, detail }, "conditionDraw");
    return;
  }
  // 旧形式カード(フラグ無し・保存済みの静的ボタン)からの呼び出しは従来どおり別カードで記録
  await postConditionOutcome(actor, {
    // 統一規格: タグ＝カードの種別・タイトル＝名前(2026-09-05)
    title: conditionDisplayName(kind), tag: "効果決定",
    status: "info", text: detail,
  });
}

/** ジョーカー時のダイアログ: 引き直し or ワイルドカードでスート＋数字を指定。 */
async function promptJokerWildcard(kind) {
  const suitOpts = Object.entries({ spade: "♠", club: "♣", heart: "♥", diamond: "♦" })
    .map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  // 邪毒は「出た数字」だけを使う(スートは効果に関わらない)ので数字だけ聞く
  const needValue = kind === "weakness" || kind === "poison";
  const needSuit = kind !== "poison";
  const content = `<div class="tnx-joker-wild">
    <p>ジョーカーを引きました。ワイルドカードとして指定するか、引き直してください。</p>
    ${needSuit ? `<div class="form-group"><label>スート</label><select name="suit">${suitOpts}</select></div>` : ""}
    ${needValue ? `<div class="form-group"><label>数字</label><input type="number" name="value" value="1" min="1"></div>` : ""}
  </div>`;
  return foundry.applications.api.DialogV2.wait({
    window: { title: "ワイルドカード指定" },
    content,
    buttons: [
      { action: "wild", icon: "fas fa-check", label: "この指定で確定",
        callback: (e, btn, dlg) => ({
          suit: dlg.element.querySelector('[name="suit"]').value,
          value: needValue ? (Number(dlg.element.querySelector('[name="value"]').value) || 1) : 0,
        }) },
      { action: "redraw", icon: "fas fa-rotate", label: "引き直す", callback: () => "redraw" },
      { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
    ],
    close: () => null,
  });
}

/**
 * controlNegate を持つ状態が付与されたとき「制御判定要求」カードを出す。
 * RL 判定要求と同じ標準機構(check-request.hbs + checkRequest フラグ)を使い、「判定する」は
 * 通常の制御判定フロー(手札から出す・山札判定・失敗する権利)をそのまま起動する。
 * 完了時は TnxCheckFlow の完了継続(ctx.controlNegate → resolveControlNegateFromCheck)が
 * 結果の適用だけを行う(フェーズ9 の簡易山札ドロー方式は 2026-07-08 ユーザー指示で全廃)。
 * @param {Actor} actor
 * @param {ActiveEffect} effect 付与された(無効化されうる)状態
 * @param {string} kind
 * @param {{ability:string, downgradeTo?:string}} controlNegate
 */
export async function postControlNegatePrompt(actor, effect, kind, controlNegate) {
  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  const ABILITY_TO_SUIT = { reason: "spade", passion: "club", life: "heart", mundane: "diamond" };
  const label = conditionDisplayName(kind, { quote: true });
  const ability = controlNegate.ability;
  const skillLabel = `${ABIL[ability] ?? ability}（制御判定）`;
  const validSuits = [ABILITY_TO_SUIT[ability] ?? "spade"];
  const description = controlNegate.downgradeTo
    ? `${label}は制御判定に成功すると${conditionDisplayName(controlNegate.downgradeTo, { quote: true })}に降格します。`
    : `${label}は制御判定に成功すると無効化されます。`;

  // 対象はアクターで登録する(2026-07-19 ユーザー指示で checkRequest 全体を統一)。
  // 「判定する」ボタンはそのアクターの所有者権限を持つユーザー(+GM)に描画時に出る
  const targets = [{ actorId: actor.id, actorName: actor.name }];

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/check-request.hbs",
    {
      typeLabel: "制御判定",
      skillLabel,
      validSuits,
      suitSymbols: { spade: "♠", club: "♣", heart: "♥", diamond: "♦" },
      targetValue: null,
      targetValueHidden: false,
      description,
      targets,
    }
  );

  // 全体公開(2026-07-08 ユーザー指示: 直接送信=whisper にしない)
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: {
      [SYSTEM_ID]: {
        checkRequest: {
          checkType: "controlCheck",
          identificationKey: null,
          skillLabel,
          validSuits,
          targetValue: null,
          targetValueHidden: false,
          description,
          targets,
          results: {},
          status: "pending",
          controlNegate: {
            actorUuid:   actor.uuid,
            effectId:    effect.id,
            kind,
            ability,
            downgradeTo: controlNegate.downgradeTo ?? "",
          },
        },
      },
    },
  });
}

/**
 * 制御判定の完了継続(TnxCheckFlow._execute → ctx.controlNegate): 結果を状態に適用する。
 * 判定そのものは通常の制御判定フローで行われており、ここでは成功=無効/降格・
 * 失敗=状態継続の適用だけを行う(判定に独自処理を挟まない=2026-07-08 ユーザー裁定)。
 * 帰結は戻り値で返し、要求カードのライブ書き換え(checkRequest の結果注入)に載せる
 * (別の結果カードは出さない=2026-07-08 ユーザー指示)。
 *
 * 制御判定「無効」を持つダメージ(腹部損傷=気絶・心臓停止=仮死・恐怖=恐慌 等)は、その効果が
 * **ダメージそのもの**であり、負傷と付与状態(戦闘不能/BS)は区別されない(2026-07-09 ユーザー裁定)。したがって:
 * - **無効化**: 付与状態に紐づく負傷(woundSource)も含め**ダメージ全体を消滅**させる(戦闘不能でも
 *   BS でも同様=タグだけ外して負傷を残さない)。※通常の〈医療〉治療は BS を残す(独立効果)が、
 *   制御判定の「無効」はダメージ自体を resist するので付与状態ごと消える。
 * - **降格**(仮死→気絶 等): 降格後の戦闘不能を負傷に紐づけ直す(治療目標値・シーン終了回復が
 *   正しく効くように)。負傷そのものは残る(表記は元のまま=表示上の名残・機能は正しい)。
 * @param {{actorUuid:string, effectId:string, kind:string, ability:string, downgradeTo:string}} negateCtx
 * @param {object} result calcControlCheck の判定結果
 * @returns {Promise<?{text:string}>} 要求カードに表示する帰結(対象未発見は null)
 */
export async function resolveControlNegateFromCheck(negateCtx, result) {
  const { actorUuid, effectId, kind, downgradeTo } = negateCtx;
  const actor = await fromUuid(actorUuid).catch(() => null);
  const effect = actor?.effects?.get(effectId)
    ?? actor?.allApplicableEffects?.().find?.(e => e.id === effectId);
  if (!actor || !effect) {
    ui.notifications.warn("対象の状態が見つかりません（解決済みの可能性があります）。");
    return null;
  }

  const outcome = negateOutcome(result?.success === true, { downgradeTo: downgradeTo || undefined });
  const label = conditionDisplayName(kind, { quote: true });
  const woundId = effect.flags?.[SYSTEM_ID]?.woundSource || ""; // 付与状態(戦闘不能/BS)=負傷に紐づく

  if (outcome.action === "negate") {
    // 戦闘不能の無効化はダメージ全体(負傷＋その戦闘不能＋同じ負傷由来の紐づき)を消滅させる
    const ids = new Set([effect.id]);
    if (woundId && actor.effects.get(woundId)) {
      ids.add(woundId);
      for (const e of actor.effects) if (e.flags?.[SYSTEM_ID]?.woundSource === woundId) ids.add(e.id);
    }
    await actor.deleteEmbeddedDocuments("ActiveEffect", [...ids].filter(id => actor.effects.get(id)));
    return { text: woundId ? `${label}を無効化（ダメージ消滅）` : `${label}を無効化` };
  }
  if (outcome.action === "downgrade") {
    const toLabel = conditionDisplayName(outcome.to, { quote: true });
    await effect.delete();
    // 降格後の戦闘不能も同じ負傷に紐づけ直す(治療目標値=特殊値・シーン終了回復が効くように)
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: conditionDisplayName(outcome.to), img: CONDITION_KINDS[outcome.to]?.img,
      statuses: [outcome.to],
      flags: { [SYSTEM_ID]: { conditionKind: outcome.to, hideFromList: true, ...(woundId ? { woundSource: woundId } : {}) } },
    }]);
    return { text: `${label}→${toLabel}に降格` };
  }
  // 受付済みマークの除去(フラグ由来=inflicts のみ。状態定義直下の controlNegate(動転)は
  // フラグを持たないため何もしない=2026-07-22)
  if (effect.getFlag(SYSTEM_ID, `conditions.${kind}`)?.pendingControlNegate !== undefined) {
    await effect.unsetFlag(SYSTEM_ID, `conditions.${kind}.pendingControlNegate`);
  }
  return { text: `${label}は継続` };
}

/** チャットの受付ボタン(.tnx-condition-action)を解決処理に配線する(renderChatMessageHTML フックで呼ぶ)。 */
export function bindConditionChatButtons(root) {
  for (const btn of root.querySelectorAll?.(".tnx-condition-action") ?? []) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const b = ev.currentTarget;
      const actor = await fromUuid(b.dataset.actor);
      const effect = actor?.effects?.get(b.dataset.effect) ?? actor?.allApplicableEffects?.().find?.(e => e.id === b.dataset.effect);
      if (!actor || !effect) return ui.notifications.warn("対象の状態が見つかりません。");
      b.disabled = true;
      if (b.dataset.type === "draw") await executeConditionDraw(actor, effect, b.dataset.kind);
      // negate は判定要求カード(checkRequest)方式に移行済み(2026-07-08)。旧カードの残骸ボタン用の案内のみ
      else if (b.dataset.type === "negate") ui.notifications.warn("この受付は旧形式です。状態を付与し直すと新しい制御判定要求カードが出ます。");
    });
  }
}


/**
 * 邪毒の継続ダメージの受付を出す(15-6・Bad_Status「邪毒」)。
 *
 * 「クリンナッププロセスのたびに、山札から1枚引いて**出た数字 ＋ 強度**点の肉体ダメージ」。
 * **カードは自動で引かない**(2026-08-29 ユーザー指示「自動でカードを引かれると訳が分からない
 * ことになる」)——受けたキャラクターを操作しているプレイヤーか RL が、衰弱/重圧と同じ
 * 「効果決定」カードのボタンで引く。
 * @param {Actor} actor
 * @param {ActiveEffect} effect 邪毒の効果
 * @param {number} magnitude 強度(n)
 */
export async function postPoisonDrawPrompt(actor, effect, magnitude = 0) {
  await postDrawPrompt(actor, effect, "poison", { magnitude: Number(magnitude) || 0 });
}

/**
 * 邪毒の受付カードで「山札を引く」が押されたときの解決(15-6)。引いた数字＋強度の肉体ダメージを
 * 既存のチャート適用経路に流し、カード自身の状態領域を結果表示に置き換える。
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @param {number} magnitude
 * @param {ChatMessage} message 受付カード
 */
async function resolvePoisonDraw(actor, effect, magnitude, message) {
  if (!actor.isOwner && !game.user.isGM) {
    return ui.notifications.warn("このキャラクターを操作できないため、カードを引けません。");
  }
  const card = await drawOneToDiscard();
  if (!card) return ui.notifications.warn("山札からカードを引けません。");
  let value = null;
  let suit = "";
  let wild = false;
  const normalized = normalizeSuit(card.suit);
  const isJoker = card.suit === "joker" || card.value === 99 || !normalized;
  if (isJoker) {
    const pick = await promptJokerWildcard("poison"); // 引き直し or 数字の指定
    if (pick === "redraw") return resolvePoisonDraw(actor, effect, magnitude, message);
    if (!pick) return; // キャンセル=押し直せる
    value = pick.value;
    wild = true;
  } else {
    suit = normalized;
    const ncheck = getCardCheckValue({ numericValue: card.value });
    value = typeof ncheck === "number" ? ncheck : Number(card.value) || 0;
  }
  const total = value + (Number(magnitude) || 0);
  await applyDamageChartResult(actor, "physical", total);
  const detail = `肉体 ${total} 点のダメージ（カード ${value} ＋ 強度 ${Number(magnitude) || 0}）`;
  await TnxSocketHandler.applyMessagePatch(message,
    { resolved: true, suit, value, wild, detail }, "conditionDraw");
}
