/**
 * @fileoverview コンディションのカード決定(衰弱/重圧のドロー)と controlNegate(制御判定での無効/降格)
 * の解決メカニクス(フェーズ9-4)。設計: Conditions.md §8 / damage-chart の controlNegate。
 *
 * 実機確認はダメージ判定システム(フェーズ12)が要るため未検証。メカニクスのみ実装し、修正は12。
 * 純粋ロジック(conditionNeedsDraw / drawResultFlags / negateOutcome)は Foundry 非依存でテスト可能。
 * Foundry 連携(山札ドロー・チャット受付・制御判定)はその上に載せる。
 */

import { getCardCheckValue } from './tnx-check-engine.mjs';
import { TnxActionHandler } from './tnx-action-handler.mjs';
import { CONDITION_KINDS } from './conditions.mjs';
import { getDamageChartKind } from '../data/damage-chart.mjs';
import { conditionNeedsDraw, drawResultFlags, negateOutcome } from './condition-resolution-core.mjs';

const SCOPE = "tokyo-nova-axleration";

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
export async function applyDamageChartResult(actor, category, value) {
  const kind = getDamageChartKind(category, value);
  if (!kind || !actor) return null;
  const def = CONDITION_KINDS[kind];
  // 治療の目標値算出(「それ以外＝そのダメージの数値」)のため、発生時のダメージ値と系統を負傷に保存する。
  // 付与で走る createActiveEffect フックが、この負傷の inflicts(戦闘不能・BS)に woundSource を紐づける
  // (治療は非BSを除去・制御判定の無効化はダメージ全体を除去)
  const [eff] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: def?.label, img: def?.img, statuses: [kind],
    flags: { [SCOPE]: { conditionKind: kind, hideFromList: true, woundValue: value, woundCategory: category } },
  }]);
  return eff ?? null;
}

// ───────── Foundry 連携 ─────────

/** 状態解決カードのステータス → アイコン。 */
const OUTCOME_ICON = Object.freeze({
  success: "fa-check", failure: "fa-times", damage: "fa-burst", info: "fa-circle-info",
});

/**
 * 状態の解決結果カードを投稿する(治療・カード決定ドロー等の共通)。
 * 判定結果カードと同じ意匠(condition-outcome.hbs)で出す。素のインライン div は使わない。
 * @param {?Actor} speakerActor
 * @param {{title:string, tag?:string, status?:string, label?:string, text?:string}} opts
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
 * 付与された状態(衰弱/重圧でドロー要)に対し「BS受付」チャットを出す。ボタン押下でドロー解決。
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @param {string} kind
 */
export async function postDrawPrompt(actor, effect, kind) {
  const label = CONDITION_KINDS[kind]?.label ?? kind;
  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/condition-prompt.hbs",
    {
      label, promptText: "この状態の効果をカードで決定します。",
      type: "draw", buttonLabel: "山札を引く",
      actorUuid: actor.uuid, effectId: effect.id, kind,
    }
  );
  // 全体公開(2026-07-11 ユーザー確定: 個人送信チャットは判定要求の任意選択以外に存在させない)
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/** ドローを実行して結果を condition フラグに書き、チャットに記録する。 */
export async function executeConditionDraw(actor, effect, kind) {
  let suit, value;
  const card = await drawOneToDiscard();
  const isJoker = !card || card.suit === "joker" || card.value === 99;
  if (isJoker) {
    const wild = await promptJokerWildcard(kind); // 引き直し or ワイルドカード指定
    if (wild === "redraw") return executeConditionDraw(actor, effect, kind);
    if (!wild) return; // キャンセル
    suit = wild.suit; value = wild.value;
  } else {
    suit = card.suit;
    const ncheck = getCardCheckValue({ numericValue: card.value });
    value = typeof ncheck === "number" ? ncheck : Number(card.value) || 0;
  }
  const flags = drawResultFlags(kind, suit, value);
  await effect.setFlag(SCOPE, `conditions.${kind}`, flags);

  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  const detail = kind === "weakness"
    ? `${ABIL[flags.targetAbility] ?? "?"}の制御値 -${flags.magnitude}`
    : `${ABIL[flags.targetAbility] ?? "?"}を使う判定が不可`;
  await postConditionOutcome(actor, {
    title: "効果決定", tag: CONDITION_KINDS[kind]?.label ?? kind,
    status: "info", text: detail,
  });
}

/** ジョーカー時のダイアログ: 引き直し or ワイルドカードでスート＋数字を指定。 */
async function promptJokerWildcard(kind) {
  const suitOpts = Object.entries({ spade: "♠", club: "♣", heart: "♥", diamond: "♦" })
    .map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  const needValue = kind === "weakness";
  const content = `<div class="tnx-joker-wild">
    <p>ジョーカーを引きました。ワイルドカードとして指定するか、引き直してください。</p>
    <div class="form-group"><label>スート</label><select name="suit">${suitOpts}</select></div>
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
      { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
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
  const label = CONDITION_KINDS[kind]?.label ?? kind;
  const ability = controlNegate.ability;
  const skillLabel = `${ABIL[ability] ?? ability}（制御判定）`;
  const validSuits = [ABILITY_TO_SUIT[ability] ?? "spade"];
  const description = controlNegate.downgradeTo
    ? `「${label}」は制御判定に成功すると「${CONDITION_KINDS[controlNegate.downgradeTo]?.label ?? controlNegate.downgradeTo}」に降格します。`
    : `「${label}」は制御判定に成功すると無効化されます。`;

  // 判定者 = 状態を受けたキャラの操作ユーザー(いなければ RL)
  const ownerUser = game.users.find(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"))
    ?? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"))
    ?? null;
  const targets = [{
    userId:    ownerUser?.id ?? null,
    actorId:   actor.id,
    actorName: actor.name,
    userName:  ownerUser?.name ?? "RL",
  }];

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
      [SCOPE]: {
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
  const label = CONDITION_KINDS[kind]?.label ?? kind;
  const woundId = effect.flags?.[SCOPE]?.woundSource || ""; // 付与状態(戦闘不能/BS)=負傷に紐づく

  if (outcome.action === "negate") {
    // 戦闘不能の無効化はダメージ全体(負傷＋その戦闘不能＋同じ負傷由来の紐づき)を消滅させる
    const ids = new Set([effect.id]);
    if (woundId && actor.effects.get(woundId)) {
      ids.add(woundId);
      for (const e of actor.effects) if (e.flags?.[SCOPE]?.woundSource === woundId) ids.add(e.id);
    }
    await actor.deleteEmbeddedDocuments("ActiveEffect", [...ids].filter(id => actor.effects.get(id)));
    return { text: woundId ? `「${label}」を無効化（ダメージ消滅）` : `「${label}」を無効化` };
  }
  if (outcome.action === "downgrade") {
    const toLabel = CONDITION_KINDS[outcome.to]?.label ?? outcome.to;
    await effect.delete();
    // 降格後の戦闘不能も同じ負傷に紐づけ直す(治療目標値=特殊値・シーン終了回復が効くように)
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: CONDITION_KINDS[outcome.to]?.label, img: CONDITION_KINDS[outcome.to]?.img,
      statuses: [outcome.to],
      flags: { [SCOPE]: { conditionKind: outcome.to, hideFromList: true, ...(woundId ? { woundSource: woundId } : {}) } },
    }]);
    return { text: `「${label}」→「${toLabel}」に降格` };
  }
  await effect.unsetFlag(SCOPE, `conditions.${kind}.pendingControlNegate`);
  return { text: `「${label}」は継続` };
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
