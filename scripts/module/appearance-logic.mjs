/**
 * @fileoverview 登場判定の純ロジック(フェーズ14-5・正本 Appearance_Check.md)。
 *
 * - 目標値は舞台エリアのセキュリティ・ランクで決まる(レッド8/イエロー10/グリーン10/
 *   ホワイト12/サンクチュアリ12)。
 * - 危険値ペナルティ(携帯中アウトフィットの合計=appearanceModifier・負)は**達成値に加算**
 *   (2026-08-07 ユーザー裁定)。グリーン×1・ホワイト×2・レッド/イエローなし。
 * - サンクチュアリは「危険値が0未満の装備を携帯」で登場不可——合計でなく**個別装備**で判定する
 *   (＋2 と −1 を携帯した合計 +1 でも不可)。
 * - 使用技能の既定候補=社会/コネ分類(「大抵いずれかの社会技能またはコネ技能」)。他技能の使用は
 *   卓の裁定=候補の絞り込みは表示上の既定にとどめ、システムは制限しない。
 */

import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";

/** エリア別の目標値と危険値係数(正本 Appearance_Check の表)。 */
export const AREA_APPEARANCE = Object.freeze({
    red:       { tn: 8,  dangerFactor: 0 },
    yellow:    { tn: 10, dangerFactor: 0 },
    green:     { tn: 10, dangerFactor: 1 },
    white:     { tn: 12, dangerFactor: 2 },
    sanctuary: { tn: 12, dangerFactor: 0 },
});

/**
 * 登場判定のパラメータ(目標値・達成値修正・登場不可)を算出する。
 * シーン行の登場設定(14-7): mode="area"(既定=エリアの固定 TN)/"fixed"(数値指定=TN はその値・
 * 危険値係数はエリアに従う)/"none"(登場不可=シーンプレイヤー以外登場できない)。
 * サンクチュアリの装備チェックはモードに関わらず生きる。
 * @param {{area: string, appearanceModifier?: number, hasNegativeDangerItem?: boolean,
 *          mode?: ("area"|"fixed"|"none"), fixedValue?: ?number}} args
 * @returns {{blocked: boolean, targetValue: ?number, modifier: number}}
 */
export function appearanceCheckParams({
    area, appearanceModifier = 0, hasNegativeDangerItem = false, mode = "area", fixedValue = null,
}) {
    if (mode === "none") return { blocked: true, targetValue: null, modifier: 0 };
    const def = AREA_APPEARANCE[area] ?? null;
    const targetValue = mode === "fixed"
        ? (Number.isFinite(Number(fixedValue)) ? Number(fixedValue) : null)
        : (def?.tn ?? null);
    if (area === "sanctuary" && hasNegativeDangerItem) {
        return { blocked: true, targetValue, modifier: 0 };
    }
    const modifier = (Number(appearanceModifier) || 0) * (def?.dangerFactor ?? 0);
    return { blocked: false, targetValue, modifier: modifier || 0 };
}

/**
 * 危険値ペナルティ(負の危険値)を持つ装備を携帯しているか(サンクチュアリの登場不可判定)。
 * 携帯条件は appearanceModifier の集計(computeOutfitAggregates)と同じ isCarrying。
 * @param {Array<{type: string, system: object}>} items アクターの全アイテム(素オブジェクト可)
 * @returns {boolean}
 */
export function hasNegativeDangerOutfit(items) {
    return (items ?? []).some(item => {
        if (!OUTFIT_ITEM_TYPES.has(item.type)) return false;
        const s = item.system;
        if (!s?.isCarrying) return false;
        if (s.appearancePenalty?.mode !== "value") return false;
        return (Number(s.appearancePenalty.value) || 0) < 0;
    });
}

/** 登場判定の既定候補(社会/コネ分類)の識別キーか。 */
export function isAppearanceSkillKey(identificationKey) {
    if (!identificationKey) return false;
    return ["society", "contact"].some(p =>
        identificationKey === p || identificationKey.startsWith(`${p}_`));
}
