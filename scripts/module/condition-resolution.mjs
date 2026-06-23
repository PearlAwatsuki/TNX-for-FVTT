/**
 * @fileoverview コンディションのカード決定(衰弱/重圧のドロー)と controlNegate(制御判定での無効/降格)
 * の解決メカニクス(フェーズ9-4)。設計: Conditions.md §8 / damage-chart の controlNegate。
 *
 * 実機確認はダメージ判定システム(フェーズ12)が要るため未検証。メカニクスのみ実装し、修正は12。
 * 純粋ロジック(conditionNeedsDraw / drawResultFlags / negateOutcome)は Foundry 非依存でテスト可能。
 * Foundry 連携(山札ドロー・チャット受付・制御判定)はその上に載せる。
 */

import { getCardJudgmentValue } from './tnx-judgment-engine.mjs';
import { TnxActionHandler } from './tnx-action-handler.mjs';
import { CONDITION_KINDS } from './conditions.mjs';
import { getDamageChartKind } from '../data/damage-chart.mjs';
import { conditionNeedsDraw, drawResultFlags, negateOutcome } from './condition-resolution-core.mjs';

const SCOPE = "tokyo-nova-axleration";

// 純粋ロジックは core 側(Foundry 非依存・テスト可)。利便のため re-export する。
export { conditionNeedsDraw, drawResultFlags, negateOutcome };

/**
 * ダメージ値からチャートを参照し、該当段の**負傷状態をアクターに付与**する(フェーズ9-4)。
 * 付与した負傷状態は status のみ・hideFromList(ダメージ由来=供給元が浮く)。付与で createActiveEffect
 * フックが走り、inflicts のカスケード(BS/戦闘不能)＋ドロー/controlNegate 受付が連動する。
 * ダメージ値の**算出本体(カード＋攻撃力−軽減)はフェーズ12**で、本関数はその適用入口。
 * @param {Actor} actor
 * @param {"physical"|"mental"|"social"} category
 * @param {number} value 最終ダメージ(段は min(value,21)、段0=付与なし)
 * @returns {Promise<?ActiveEffect>} 付与した負傷状態(段0/不正は null)
 */
export async function applyDamageChartResult(actor, category, value) {
  const kind = getDamageChartKind(category, value);
  if (!kind || !actor) return null;
  const def = CONDITION_KINDS[kind];
  const [eff] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: def?.label, img: def?.img, statuses: [kind],
    flags: { [SCOPE]: { conditionKind: kind, hideFromList: true } },
  }]);
  return eff ?? null;
}

/** ドロー主体(GM か 受けたキャラの所有者か)を返す。衰弱=RL(GM)、重圧=受けたキャラ。 */
export function drawWhisperUserIds(kind, actor) {
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  if (kind === "pressure") {
    const owners = game.users.filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map(u => u.id);
    return [...new Set([...owners, ...gmIds])];
  }
  return gmIds; // 衰弱 等は RL
}

// ───────── Foundry 連携 ─────────

/** 山札から1枚、捨て札へ引いてカードを返す(受付なし・即時)。山札空は null。 */
async function drawOneToDiscard() {
  const deck = await TnxActionHandler.getActiveDeck();
  const discard = await TnxActionHandler.getActiveDiscardPile();
  if (!deck || !discard || !deck.availableCards?.length) return null;
  const [card] = await deck.draw(discard, 1, { chatNotification: false });
  return card ?? null;
}

/**
 * 付与された状態(衰弱/重圧でドロー要)に対し「BS受付」チャットを出す。ボタン押下でドロー解決。
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @param {string} kind
 */
export async function postDrawPrompt(actor, effect, kind) {
  const label = CONDITION_KINDS[kind]?.label ?? kind;
  const content = `<div class="tnx-condition-prompt">
    <p><b>${label}</b> の効果をカードで決定します。</p>
    <button type="button" class="tnx-condition-action" data-type="draw"
      data-actor="${actor.uuid}" data-effect="${effect.id}" data-kind="${kind}">山札を引く</button>
  </div>`;
  await ChatMessage.create({
    content,
    whisper: drawWhisperUserIds(kind, actor),
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
    const njudge = getCardJudgmentValue({ numericValue: card.value });
    value = typeof njudge === "number" ? njudge : Number(card.value) || 0;
  }
  const flags = drawResultFlags(kind, suit, value);
  await effect.setFlag(SCOPE, `conditions.${kind}`, flags);

  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  const detail = kind === "weakness"
    ? `${ABIL[flags.targetAbility] ?? "?"}の制御値 -${flags.magnitude}`
    : `${ABIL[flags.targetAbility] ?? "?"}を使う判定が不可`;
  await ChatMessage.create({
    content: `<div class="tnx-condition-result"><b>${CONDITION_KINDS[kind]?.label}</b>: ${detail}</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
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
 * controlNegate を持つ状態が付与されたとき「制御判定」受付チャットを出す。
 * @param {Actor} actor
 * @param {ActiveEffect} effect 付与された(無効化されうる)状態
 * @param {string} kind
 * @param {{ability:string, downgradeTo?:string}} controlNegate
 */
export async function postControlNegatePrompt(actor, effect, kind, controlNegate) {
  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  const label = CONDITION_KINDS[kind]?.label ?? kind;
  const content = `<div class="tnx-condition-prompt">
    <p><b>${label}</b> は <b>${ABIL[controlNegate.ability]}</b> の制御判定成功で${controlNegate.downgradeTo ? "降格" : "無効"}。</p>
    <button type="button" class="tnx-condition-action" data-type="negate"
      data-actor="${actor.uuid}" data-effect="${effect.id}" data-kind="${kind}"
      data-ability="${controlNegate.ability}" data-downgrade="${controlNegate.downgradeTo ?? ""}">制御判定</button>
  </div>`;
  await ChatMessage.create({
    content,
    whisper: drawWhisperUserIds("pressure", actor), // 受けたキャラ＋GM
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/**
 * controlNegate の制御判定を実行し、結果で状態を無効/降格/維持する。
 * 制御判定は山札ドロー方式(N◎VA値 ≤ 該当制御値で成功)＝メカニクス簡易版(本式は12で判定フロー化)。
 */
export async function executeControlNegate(actor, effect, kind, ability, downgradeTo) {
  const card = await drawOneToDiscard();
  const cardValue = card ? getCardJudgmentValue({ numericValue: card.value }) : null;
  const controlVal = actor.system?.[ability]?.totalControl ?? 0;
  const success = typeof cardValue === "number" && cardValue <= controlVal;
  const outcome = negateOutcome(success, { downgradeTo: downgradeTo || undefined });

  const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
  let msg;
  if (outcome.action === "negate") {
    await effect.delete();
    msg = `制御判定 成功 → <b>${CONDITION_KINDS[kind]?.label}</b> を無効化`;
  } else if (outcome.action === "downgrade") {
    await effect.delete();
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: CONDITION_KINDS[outcome.to]?.label, img: CONDITION_KINDS[outcome.to]?.img,
      statuses: [outcome.to], flags: { [SCOPE]: { conditionKind: outcome.to, hideFromList: true } },
    }]);
    msg = `制御判定 成功 → <b>${CONDITION_KINDS[kind]?.label}</b> を <b>${CONDITION_KINDS[outcome.to]?.label}</b> に降格`;
  } else {
    await effect.unsetFlag(SCOPE, `conditions.${kind}.pendingControlNegate`);
    msg = `制御判定 失敗（${ABIL[ability]} ${controlVal}）→ <b>${CONDITION_KINDS[kind]?.label}</b> 継続`;
  }
  await ChatMessage.create({ content: `<div class="tnx-condition-result">${msg}</div>`, speaker: ChatMessage.getSpeaker({ actor }) });
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
      else if (b.dataset.type === "negate") await executeControlNegate(actor, effect, b.dataset.kind, b.dataset.ability, b.dataset.downgrade);
    });
  }
}
