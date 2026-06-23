/**
 * @fileoverview コンディション解決の純粋ロジック(Foundry 非依存・テスト可能)。
 * 衰弱/重圧のカード決定と controlNegate の判定結果からの動作決定。設計: Conditions.md §8。
 * Foundry 連携(ドロー・チャット・制御判定)は condition-resolution.mjs。
 */

import { SUIT_TO_ABILITY } from './tnx-judgment-engine.mjs';

/**
 * その状態が「効果値をカードドローで決定する」必要があるか。
 * - 衰弱(数字なし): 対象能力値も数字も未確定(targetAbility 無し かつ magnitude 0)。
 * - 重圧(未指定): 対象能力値が未指定(targetAbility 無し)。
 * @param {string} kind
 * @param {{targetAbility?:?string, magnitude?:number}} v
 * @returns {boolean}
 */
export function conditionNeedsDraw(kind, { targetAbility, magnitude } = {}) {
  if (kind === "weakness") return !targetAbility && !magnitude;
  if (kind === "pressure") return !targetAbility;
  return false;
}

/**
 * ドロー結果(スート・N◎VA値)から condition フラグ更新を返す。
 * スート→対象能力値。衰弱は数字を magnitude に(重圧は対象能力値のみ)。
 * @param {string} kind
 * @param {string} suit
 * @param {number} value N◎VA 値(絵札10・A11)
 * @returns {{targetAbility:?string, magnitude?:number}}
 */
export function drawResultFlags(kind, suit, value) {
  const out = { targetAbility: SUIT_TO_ABILITY[suit] ?? null };
  if (kind === "weakness") out.magnitude = value;
  return out;
}

/**
 * controlNegate の判定結果から取るべき動作を返す。
 * 制御判定成功 → 降格先があれば降格、無ければ無効。失敗 → そのまま付与継続。
 * @param {boolean} success 制御判定の成否
 * @param {{downgradeTo?:string}} [controlNegate]
 * @returns {{action:"apply"|"negate"|"downgrade", to?:string}}
 */
export function negateOutcome(success, controlNegate) {
  if (!success) return { action: "apply" };
  return controlNegate?.downgradeTo
    ? { action: "downgrade", to: controlNegate.downgradeTo }
    : { action: "negate" };
}
