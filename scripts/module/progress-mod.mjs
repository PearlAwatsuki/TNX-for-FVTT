/**
 * @fileoverview FS判定の進行修正(フェーズ12-5・2026-07-20 確定)。
 *
 * 進行修正は固定値のこともあれば、アウトフィットのデータ(例: タップのサイクル数)や
 * アクター側の数値(例: 生命の制御値に係数をかけた値)を参照することもある(ルール4)。
 *
 * **式キーでアイテムを直接指定することはできない**(2026-07-20 ユーザー指摘)——キャラクターが
 * どのタップを装備しているかは FS 側から特定できない。そこで FS は「**何を見るか**」だけを
 * 持ち、解決値を式の `@param` に注入する。係数は式で表す(`@param * 2`)。
 * アクター側も式の直書きにせずプルダウンに統一する(参照元による非対称を作らない)。
 *
 * `source: "outfit"` の実解決(判定者の準備済みアイテムから該当種別を探し、複数なら選ばせる)は
 * **フェーズ13**。ここでは選択肢の提示・保存と、解決値を渡された場合の評価までを担う。
 */

import { evaluateFormula } from "./tnx-formula.mjs";

/** 進行修正の参照元。 */
export const PROGRESS_MOD_SOURCES = Object.freeze([
    { value: "none",   label: "なし（固定値）" },
    { value: "outfit", label: "アウトフィット" },
    { value: "actor",  label: "キャラクター" },
]);

const ABILITY_LABELS = Object.freeze({
    reason:  "理性",
    passion: "感情",
    life:    "生命",
    mundane: "外界",
});

/** キャラクター側の参照パラメータ(グループ見出し → パラメータ)。 */
const ACTOR_GROUPS = Object.freeze([
    {
        label:  "能力値",
        params: Object.entries(ABILITY_LABELS).map(([k, label]) => ({ value: `${k}.total`, label })),
    },
    {
        label:  "制御値",
        params: Object.entries(ABILITY_LABELS).map(([k, label]) => ({ value: `${k}.totalControl`, label })),
    },
    {
        label: "その他",
        params: [
            { value: "bounty",                     label: "報酬点" },
            { value: "combatSpeed.displayTotal",   label: "コンバットスピード" },
            { value: "actionRank.maxTotal",        label: "アクションランク" },
        ],
    },
]);

/**
 * アウトフィット側の参照パラメータ(アイテム種別 → そのアイテムが持つ数値)。
 * 値は「種別.フィールド」の論理キーで、実際のアイテムの解決はフェーズ13 が行う。
 */
const OUTFIT_GROUPS = Object.freeze([
    { label: "タップ",     params: [
        { value: "tap.cycle",           label: "サイクル数" },
        { value: "tap.combatSpeedMod",  label: "コンバットスピード修正" },
    ] },
    { label: "ヴィークル", params: [
        { value: "vehicle.speedFactor", label: "スピードファクター" },
        { value: "vehicle.passenger",   label: "乗員" },
        { value: "vehicle.controlMod",  label: "制御値修正" },
        { value: "vehicle.attack",      label: "攻撃力" },
    ] },
    { label: "武器",       params: [
        { value: "weapon.attack",     label: "攻撃力" },
        { value: "weapon.guardValue", label: "受け値" },
        { value: "weapon.FAValue",    label: "フルオート値" },
    ] },
    { label: "防具",       params: [
        { value: "armor.controlMod", label: "制御値修正" },
    ] },
    { label: "イアヌス",   params: [
        { value: "ianus.controlMod", label: "制御値修正" },
    ] },
    { label: "住居",       params: [
        { value: "residence.cyberSecurity",  label: "電子セキュリティ" },
        { value: "residence.analogSecurity", label: "物理セキュリティ" },
    ] },
]);

/**
 * 参照元に応じたパラメータの選択肢(グループ形式プルダウン用)。
 * 表示は必ず日本語ラベル(内部キーの生値を出さない)。
 * @param {string} source none / outfit / actor
 * @returns {Array<{label:string, params:Array<{value:string,label:string}>}>}
 */
export function buildProgressModChoices(source) {
    if (source === "actor")  return ACTOR_GROUPS.map(g => ({ ...g }));
    if (source === "outfit") return OUTFIT_GROUPS.map(g => ({ ...g }));
    return [];
}

/**
 * 進行修正を評価する。パラメータの解決値は `@param` として式に入る。
 * @param {?{source:string, param:string, formula:string}} mod
 * @param {{paramValue?:number}} [ctx] パラメータの解決値(フェーズ13 が供給する)
 * @returns {Promise<number>} 評価値(評価不能・空は 0)
 */
export async function resolveProgressMod(mod, { paramValue = 0 } = {}) {
    if (!mod?.formula) return 0;
    const value = await evaluateFormula(mod.formula, { param: Number(paramValue) || 0 });
    return Number.isFinite(value) ? value : 0;
}
