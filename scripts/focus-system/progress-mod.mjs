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

import { evaluateFormula } from "../rules/tnx-formula.mjs";

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
        { value: "tap.combatSpeedMod",  label: "CS修正" },
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
        { value: "weapon.FAValue",    label: "FA値" },
    ] },
    { label: "防具",       params: [
        { value: "armor.controlMod", label: "制御値修正" },
    ] },
    { label: "IANUS",   params: [
        { value: "ianus.controlMod", label: "制御値修正" },
    ] },
    { label: "住居",       params: [
        { value: "residence.cyberSecurity",  label: "電脳セキュリティ" },
        { value: "residence.analogSecurity", label: "アナログセキュリティ" },
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

/**
 * アイテムのフィールド値を数値化する(進行修正 outfit の実解決・フェーズ13-7)。フィールドの形が
 * 不揃い(直値の NumberField・`{mode,value}` の modeValueField・attackField 等)なので、
 * `total`(実効値) → `value` → 直値の順で数値を取り出す。
 * @param {*} raw item.system.<フィールド> の値
 * @returns {number}
 */
export function outfitFieldNumber(raw) {
    if (typeof raw === "number") return raw;
    if (raw && typeof raw === "object") {
        if (Number.isFinite(raw.total)) return raw.total;
        if (Number.isFinite(raw.value)) return raw.value;
    }
    return 0;
}

/** 準備済みの候補が複数あるとき、判定者に参照元アイテムを選ばせる(値も併記)。 */
async function pickOutfitItem(items, field) {
    const esc = foundry.utils.escapeHTML;
    const options = items.map(i =>
        `<option value="${i.id}">${esc(i.name)}（${outfitFieldNumber(foundry.utils.getProperty(i.system, field))}）</option>`
    ).join("");
    const picked = await foundry.applications.api.DialogV2.prompt({
        window: { title: "進行修正の参照元" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>進行修正に使うアイテムを選択:</p><div class="form-group"><select name="itemId">${options}</select></div>`,
        ok: { label: "決定", icon: "fas fa-check", callback: (_e, b) => b.form.elements.itemId.value },
        modal: true,
        rejectClose: false,
    }).catch(() => null);
    return picked ? (items.find(i => i.id === picked) ?? null) : null;
}

/**
 * 進行修正を**判定者アクターに対して**解決する(フェーズ13-7)。source 別に `@param` の解決値を
 * 求めてから、既存の `resolveProgressMod`(式評価)へ渡す。
 * - none:   固定値/式(paramValue=0)。
 * - actor:  アクターの system 値。`param` は system 直下のドットパス(例 `reason.total` / `bounty`)。
 * - outfit: 判定者の**準備済み**アイテム(`param`="種別.フィールド")の値。準備済みが複数なら選ばせる。
 * @param {Actor} actor 判定者
 * @param {?{source:string, param:string, formula:string}} mod
 * @returns {Promise<number>}
 */
export async function resolveProgressModForActor(actor, mod) {
    let paramValue = 0;
    if (mod?.source === "actor" && mod.param) {
        paramValue = Number(foundry.utils.getProperty(actor?.system ?? {}, mod.param)) || 0;
    } else if (mod?.source === "outfit" && mod.param) {
        const dot = mod.param.indexOf(".");
        if (dot > 0) {
            const type = mod.param.slice(0, dot);
            const field = mod.param.slice(dot + 1);
            const items = (actor?.items ?? []).filter(i => i.type === type && i.system?.isPrepared === true);
            const item = items.length <= 1 ? items[0] : await pickOutfitItem(items, field);
            if (item) paramValue = outfitFieldNumber(foundry.utils.getProperty(item.system, field));
        }
    }
    return resolveProgressMod(mod, { paramValue });
}
