/**
 * @fileoverview 登場判定と登場そのものの純ロジック(フェーズ14-5/14-8・正本 Appearance_Check.md)。
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

import { OUTFIT_ITEM_TYPES, CHARACTER_ACTOR_TYPES } from "../data/helpers.mjs";

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

/**
 * シーン行の登場設定の要約表示(シナリオコントロールパネルの「登場：」行・2026-08-09 ユーザー指示)。
 * 「〈社会：N◎VA、ストリート〉〈医療〉 10」形式＝指定技能(整形済み)を並べ、末尾に目標値。
 * 登場不可のシーンは「不可」。指定技能も目標値も無ければ ""(行そのものを出さない)。
 * @param {{mode?: string, targetValue?: ?number, skillNames?: Array<string>}} args
 *        skillNames は formatGroupedSkillNames で解決・整形済みの表示名
 * @returns {string}
 */
export function formatAppearanceSummary({ mode = "area", targetValue = null, skillNames = [] } = {}) {
    if (mode === "none") return "不可";
    const skills = (skillNames ?? []).join("");
    const tn = Number.isFinite(Number(targetValue)) && targetValue !== null && targetValue !== ""
        ? String(targetValue) : "";
    // 技能と目標値の間は不改行スペース: 幅の狭いパネルで折り返すと目標値だけが次行に取り残され、
    // 何の数値か分からなくなる(隔離描画で確認・2026-08-09)
    return [skills, tn].filter(Boolean).join("\u00A0");
}

/**
 * 「登場：不可」のシーンか(2026-08-09 ユーザー裁定)。**登場判定が行えないだけでなく、
 * チーム免除でも登場できない**——シーンプレイヤー以外のキャストは登場できないシーン。
 * RL による登場(パネルの手動登場・台本の事前設定)はこのゲートの外側にある。
 * @param {?{appearanceMode?: string}} row 正規化済みシーン行
 * @returns {boolean}
 */
export function isAppearanceBlockedScene(row) {
    return (row?.appearanceMode ?? "area") === "none";
}

/**
 * シーン行の「登場キャラクター」事前設定を正規化する(14-8)。
 * `hideName` は名前を伏せて登場させる指定(卓には「？？？」と表示される)。
 * @param {?Array<{actorId?: string, hideName?: boolean}>} list
 * @returns {Array<{actorId: string, hideName: boolean}>}
 */
export function normalizeAppearanceActors(list) {
    return (Array.isArray(list) ? list : [])
        .map(entry => ({
            actorId:  String(entry?.actorId ?? ""),
            hideName: entry?.hideName === true,
        }))
        .filter(entry => entry.actorId);
}

/**
 * シーン入場時に登場させるキャラクターの集合(14-8)。
 * シーンプレイヤーのキャラクター(判定なしで登場する)に、台本の事前設定を重ねる。
 * 両方に居る場合はシーンプレイヤーとしての登場を採る——シーンプレイヤーは卓に開示された
 * 主役であり、名前を伏せる対象にならないため。
 * @param {?{appearanceActors?: Array<object>}} row 正規化済みシーン行
 * @param {{scenePlayerActorId?: string}} [args]
 * @returns {Array<{actorId: string, hideName: boolean}>}
 */
export function sceneEntryAppearances(row, { scenePlayerActorId = "" } = {}) {
    const entries = scenePlayerActorId ? [{ actorId: scenePlayerActorId, hideName: false }] : [];
    for (const entry of normalizeAppearanceActors(row?.appearanceActors)) {
        if (entries.some(e => e.actorId === entry.actorId)) continue;
        entries.push(entry);
    }
    return entries;
}

/**
 * キャラクター選択プルダウンの type 別グループ(14-8)。RL の登場候補(パネル)と台本の
 * 事前設定(アクトシート)で共用する。並びは CHARACTER_ACTOR_TYPES の順、空の群は出さない。
 * RL は登場判定を経ずに誰でも登場させられる(2026-08-09 ユーザー裁定)ため、キャストも含む。
 * @param {Array<{id: string, name: string, type: string, appearing?: boolean}>} actors
 * @param {{labelOf?: (type: string) => string, excludeAppearing?: boolean}} [args]
 *        excludeAppearing=登場中を候補から外す(パネルの追加プルダウン)
 * @returns {Array<{label: string, actors: Array<{id: string, name: string}>}>}
 */
export function groupCharacterChoices(actors, { labelOf = t => t, excludeAppearing = false } = {}) {
    return CHARACTER_ACTOR_TYPES
        .map(type => ({
            label: labelOf(type),
            actors: (actors ?? [])
                .filter(a => a?.type === type && !(excludeAppearing && a.appearing === true))
                .map(a => ({ id: a.id, name: a.name })),
        }))
        .filter(group => group.actors.length > 0);
}

/** 登場判定の既定候補(社会/コネ分類)の識別キーか。 */
export function isAppearanceSkillKey(identificationKey) {
    if (!identificationKey) return false;
    return ["society", "contact"].some(p =>
        identificationKey === p || identificationKey.startsWith(`${p}_`));
}
