/**
 * @fileoverview 神業の純ロジック(フェーズ17-1・Foundry 非依存)。
 * 正本: Miracle_Rules.md「神業の位置づけ」「神業の構造」・Phase_17_Tasks_Detail「設計の中心 — 神業由来の印」。
 *
 * 神業はゴールデンルール「RL の絶対権限」のひとつ下に位置する強制力の強いルールであり、
 * 挙動は既存の用途の器で表現するが、その用途が神業のものであるという**印**を結果へ運ぶ。
 * 本モジュールは印の出どころ・残回数ゲート・使用時の消費・カードの描画データといった
 * 計算だけを担い、ドキュメントの更新や投稿(Foundry 依存)は呼び出し側が行う。
 */

import { usesMaxTotalOf } from "../data/item/uses.mjs";

/**
 * 残回数ゲート。残り ＝ 実効最大値(AE 込み・usesMaxTotalOf) − 消費済み。
 * @param {object|null|undefined} system 神業アイテムの system
 * @returns {{ok: boolean, remaining: number, max: number}}
 */
export function miracleUseGate(system) {
    const max = usesMaxTotalOf(system);
    const spent = Number(system?.uses?.spent) || 0;
    const remaining = Math.max(0, max - spent);
    return { ok: remaining > 0, remaining, max };
}

/**
 * 使用による消費の更新オブジェクト。消費済みを 1 増やし(実効最大値で頭打ち)、この消費で
 * 尽きるなら isUsed を true にする(手動リセットの起点として残す・旧経路と同じ)。
 * @param {object} system 神業アイテムの system
 * @returns {Record<string, number|boolean>} item.update 用の更新データ
 */
export function miracleConsumeUpdate(system) {
    const { max } = miracleUseGate(system);
    const spent = Math.min(max, (Number(system?.uses?.spent) || 0) + 1);
    const update = { "system.uses.spent": spent };
    if (spent >= max) update["system.isUsed"] = true;
    return update;
}

/**
 * 消費先が空の神業用途に「このアイテム自身の使用回数 ×1」を既定消費として補う(実行時のみ・保存しない)。
 * 「消費は消費先の設定からのみ」の一般原則はコンボ参加技能の遠隔消費を廃した文脈のもので、
 * 使用＝回数消費が定義に含まれる神業には当たらない(用途を作った途端に回数が減らなくなるのは
 * 「用途を前提条件にしない」設計判断0と食い違う)。
 * @param {object} usage 用途エントリ
 * @returns {object} 既定行を補った複製。設定済みなら引数そのもの
 */
export function withDefaultMiracleConsumption(usage) {
    if (Array.isArray(usage?.consumeTargets) && usage.consumeTargets.length > 0) return usage;
    return { ...usage, consumeTargets: [{ type: "item", itemId: "", resource: "uses", amount: 1 }] };
}

/**
 * 神業由来の印の出どころ: 用途の親アイテムが miracle 型であること(専用フィールドは持たない)。
 * @param {{id?: string, type?: string, name?: string}|null|undefined} item
 * @returns {?{itemId: string, name: string}} 神業でなければ null
 */
export function miracleOriginOf(item) {
    if (item?.type !== "miracle") return null;
    return { itemId: item.id ?? "", name: item.name ?? "" };
}

/**
 * カードのフラグ(またはそれに相当するオブジェクト)が神業由来の印を持つか。
 * 読み手はすべて本関数を通す(効き先＝軽減・リアクション・治療・打ち消しの各ゲートは 17-2/17-3)。
 * @param {object|null|undefined} flags システムスコープのフラグ
 * @returns {boolean}
 */
export function isMiracleOrigin(flags) {
    return !!flags?.miracle?.itemId;
}

/**
 * 神業カードの描画データ。効果文・条件はエンリッチ済みの HTML を受け取る(純関数のため
 * エンリッチは呼び出し側)。空の欄は空文字で返し、テンプレート側で行ごと畳む。
 * @param {{name?: string, system?: {furigana?: string}}} item 神業アイテム
 * @param {{description?: string, condition?: string, remaining: number, max: number}} opts
 * @returns {{typeLabel: string, name: string, furigana: string, description: string,
 *            condition: string, remaining: number, max: number}}
 */
/**
 * ダメージカードで、まだ防がれていない対象行の添字。表示(行が消える)と適用(残った対象だけ)の
 * 両方がこれを読む(防御タイプ「適用前に防ぐ」・17-2)。
 * @param {{targets?: Array<{protectedBy?: object}>}} f ダメージカードのフラグ
 * @returns {number[]}
 */
export function unprotectedTargetIndices(f) {
    return (f?.targets ?? []).map((t, i) => (t?.protectedBy ? -1 : i)).filter(i => i >= 0);
}

/**
 * 「適用前に防ぐ」の計画(防御タイプ・17-2)。効果文: 《難攻不落》「社会ダメージを除く、ダメージをひとつ
 * 打ち消す。このダメージは1回の判定、もしくは1発の神業によって発生したものすべて」「ダメージを受けて
 * しまった後から治療することはできない」／《守護神》《友情》「選択したひとりのキャラクター以外に…
 * 被害をこうむるキャラクターがいる場合、そのキャラクターを助けることはできない」。
 * @param {{category?: string, applied?: boolean, targets?: Array}} f ダメージカードのフラグ
 * @param {{defenceScope?: "all"|"one", defenceCategories?: string[]}} usage 防御タイプの用途
 * @param {{rowIndex: number, by: {itemId: string, name: string, actorId: string}}} opts
 *   rowIndex=クリックした対象行(1人のときに使う)・by=防いだ神業(印)
 * @returns {{ok: true, indices: number[], by: object} | {ok: false, reason: "applied"|"category"|"noTargets"|"alreadyProtected"}}
 */
export function defencePreventPlan(f, usage, { rowIndex, by }) {
    if (f?.applied) return { ok: false, reason: "applied" };
    const cats = Array.isArray(usage?.defenceCategories) && usage.defenceCategories.length
        ? usage.defenceCategories : ["physical", "mental", "social"];
    if (!cats.includes(f?.category || "physical")) return { ok: false, reason: "category" };
    if (!(f?.targets ?? []).length) return { ok: false, reason: "noTargets" };
    const open = unprotectedTargetIndices(f);
    const indices = usage?.defenceScope === "one" ? open.filter(i => i === rowIndex) : open;
    if (!indices.length) return { ok: false, reason: "alreadyProtected" };
    return { ok: true, indices, by };
}

export function buildMiracleCardData(item, { description = "", condition = "", remaining, max }) {
    return {
        typeLabel:   "神業",
        name:        item?.name ?? "",
        furigana:    item?.system?.furigana ?? "",
        description: description ?? "",
        condition:   condition ?? "",
        remaining,
        max,
    };
}
