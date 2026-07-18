/**
 * @fileoverview 用途の目標値解決(2026-07-13 ユーザー確定)。
 *
 * 目標値の選択肢はデータ(技能固有値)から拾われるもので、中身は用途で決めるが、
 * データから拾える目標値を無視して良いわけでもない——選択肢ごとに扱いを固定する:
 * - number(数字): 特定の目標値が必ず入る → **そのまま判定の目標値として扱う**
 * - explanation(解説参照)/other(その他): 自由記入欄(targetValueOther)に**式を入力して
 *   任意に目標値を設定できる**(@system.*・@item.self 等。回復は @condition.* を注入)。
 *   空・評価不能は目標値なし(記入内容は表示のみ=卓裁定)
 * - control(制御値)/total(達成値): 別メカニクス(制御値目標・対決)で実現済み → 具体値は引かない
 * - enterDifficulty(登場目標値): 登場判定のメカニクス側で目標値が明示される想定 → 同上
 * - blank/none: 目標値なし
 *
 * 目標値の入力先はこの一箇所(発動タブ)に一本化する(回復専用の式欄は廃止=2026-07-13。
 * 同じ値の入力先を二重化しない)。
 */

import { buildFormulaData, evaluateFormula } from "./tnx-formula.mjs";

/**
 * 用途の目標値を判定用の数値へ解決する。
 * @param {object} usage 用途エントリ
 * @param {Actor|null} actor 実行アクター
 * @param {Item|null} bearerItem 用途の親アイテム(@item.self)
 * @param {{condition?: {magnitude:number, woundValue:number}}} [extra] 追加の式コンテキスト
 *   (治療用途。woundValue=治療対象のダメージのチャート値)
 * @returns {Promise<number|null>} 目標値。null=目標値なし(成否は他メカニクス/卓裁定)
 */
export async function resolveUsageTargetValue(usage, actor, bearerItem, extra = {}) {
    switch (usage?.targetValue) {
        case "number":
            return Number(usage.targetValueNumber) || 0;
        case "explanation":
        case "other": {
            const formula = String(usage.targetValueOther ?? "").trim();
            if (!formula) return null;
            const data = buildFormulaData(actor, null, bearerItem);
            if (extra.condition) data.condition = extra.condition;
            return await evaluateFormula(formula, data);
        }
        default:
            return null;
    }
}
