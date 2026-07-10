/**
 * @fileoverview 式評価ヘルパー(フェーズ12-1 確定・2026-07-08・正本 Check_Rules「差分値」)。
 *
 * 判定結果コンテキストを式に供給し、Foundry Roll の**ダイスなし決定的評価**で解決する
 * (initiative の `@system.combatSpeed.displayTotal` と同じ流儀)。
 * 公開キー: **`@diff`(差分値)・`@achievement`(達成値)**。
 * 数値・算術式・参照キーを含む式は機械適用し、評価不能なもの(自由文・ダイスを含む式・
 * 構文エラー)は null を返して呼び出し側が「表示のみ+手動修正」扱いにする。
 *
 * 消費者: 判定ボーナス・ダメージ修正(式の行/専用欄)、
 * フェーズ13 の FS 進行判定(`floor(@diff / 10) + 進行修正`)など、式を持つ全機構。
 */

import { resolveItemNameByKey } from "./identification.mjs";
import { targetStyleWorksKeys } from "../data/item/helpers.mjs";

/**
 * 判定結果(checkResult.result)から式評価用のデータオブジェクトを作る(Foundry 非依存)。
 * card=判定に使用したカードの値(N◎VA数字・2026-07-11)。カードプレイ後(判定ボーナス評価時)から
 * 参照できる(diff/achievement は判定確定後のみ=それ以前は 0)。
 * @param {{diff?: number|null, achievement?: number|null, cardValue?: number|null}} result
 * @returns {{diff: number, achievement: number, card: number}}
 */
export function buildCheckFormulaData(result) {
    return {
        diff:        Number.isFinite(result?.diff) ? result.diff : 0,
        achievement: Number.isFinite(result?.achievement) ? result.achievement : 0,
        card:        Number.isFinite(result?.cardValue) ? result.cardValue : 0,
    };
}

/**
 * 判定/ダメージの式に供給する評価データを組み立てる(2026-07-10 ユーザー要望:
 * 「AE で参照できる値は式でも参照できるべき」)。アクターのロールデータ(`getRollData()`)を
 * 基に、判定結果(`@diff`/`@achievement`)と供給元アイテム(`@item.system.*`)を重ねる。
 * ロールデータは AE と同じ `system.*` パスを `@system.*` として公開する(initiative の
 * `@system.combatSpeed.displayTotal` と同じ流儀)。加えて**アクターの全アイテムを識別キーで引ける**
 * よう `@item.<識別キー>.system.*` を公開する(技能レベル `@item.<key>.system.level`・武器攻撃力
 * `@item.<key>.system.attack.value`・危険値等・そのアイテムに AE で乗せられる全キー。例:
 * 「選んだ武器の攻撃力をダメージに加算」＝ダメージ修正の式に `@item.<武器の識別キー>.system.attack.value`)。
 * @param {Actor|null} actor
 * @param {{diff?: number|null, achievement?: number|null}|null} [result] 判定結果(判定前は null)
 * @param {object|null} [bearer] AE 値の相対参照用(効果が乗るアイテム)。判定/ダメージの式では null
 * @param {Actor|null} [target] 攻撃対象(防御側)。**ダメージの式でのみ**供給する。`@target.system.*`
 *   (対象の実効値・AE 込み)と `@target.style.<識別キー>` / `@target.works.<組織キー>`(対象が持てば
 *   1・なければ 0＝欠損キーも 0)を公開する。判定・AE 値では null。
 * @returns {object} evaluateFormula に渡す data
 */
export function buildFormulaData(actor, result = null, bearer = null, target = null) {
    const data = { ...(actor?.getRollData?.() ?? {}) };
    if (result) Object.assign(data, buildCheckFormulaData(result));
    // @item.<識別キー>.system.* : アクターの任意アイテムを識別キーで参照(system 全体)
    const items = {};
    for (const it of (actor?.items ?? [])) {
        const key = it?.system?.identificationKey;
        if (key) items[key] = { system: it.system };
    }
    // AE 値用の相対参照(2026-07-10): @item.self=効果が乗るアイテム自身・
    // @item.parent=その親(装備先ホスト・parentItemId)。判定/ダメージの式では bearer なし。
    if (bearer) {
        items.self = { system: bearer.system };
        const parentId = bearer.system?.parentItemId;
        const parent = parentId ? actor?.items?.get(parentId) : null;
        if (parent) items.parent = { system: parent.system };
    }
    data.item = items;
    if (target) data.target = buildTargetData(target);
    return data;
}

/**
 * `@target.*` のデータを組み立てる。`system.*` は対象の getRollData(AE 込み実効値)、
 * `style` / `works` は「対象が持てば 1・なければ 0」を返す Proxy(**欠損キーも 0**＝未所持スタイルを
 * 式で参照してもエラーにせず 0 として評価させる)。例: `@target.style.ayakashi * 5`。
 * @param {Actor} target
 * @returns {object}
 */
function buildTargetData(target) {
    const td = { ...(target.getRollData?.() ?? {}) };
    const { styles, works } = targetStyleWorksKeys(target);
    const flag = (list) => {
        const set = new Set(list);
        return new Proxy({}, { get: (_o, k) => (typeof k === "string" && set.has(k)) ? 1 : 0 });
    };
    td.style = flag(styles);
    td.works = flag(works);
    return td;
}

/**
 * 式を**同期**で決定的評価する(AE 値の評価用・`prepareDerivedData` は同期のため)。
 * 数値は Roll を介さず即返し、`@…` を含む決定的式は `Roll.evaluateSync` で解く。ダイス・構文エラー・
 * 評価不能は null。
 * @param {string} formula
 * @param {object} data 参照キーのデータ(buildFormulaData の結果等)
 * @returns {number|null}
 */
export function evaluateFormulaSync(formula, data = {}) {
    const plain = parsePlainNumber(formula);
    if (plain !== null) return plain;
    const f = String(formula ?? "").trim();
    if (!f) return null;
    try {
        const roll = new Roll(f, data);
        if (!roll.isDeterministic) return null; // ダイスを含む式は機械適用しない
        roll.evaluateSync({ strict: false });
        return Number.isFinite(roll.total) ? roll.total : null;
    } catch {
        return null;
    }
}

/**
 * 判定ボーナス/ダメージ修正の**行の配列**を評価し、合計と内訳(供給元名つき)を返す(2026-07-10)。
 * 各行 = { formula, source(識別キー) }。**source は帰属表示だけ**に使い(式の参照とは独立)、内訳の
 * 表示名は**逆引きしたアイテムの現在名**(生キーは表示しない・供給元なしは "用途")。式は
 * `@system.*`・`@item.<識別キー>.system.*`・(結果があれば)`@diff`/`@achievement` を参照できる。
 * 評価不能・0 は除外。
 * @param {Array<{formula:string, source:string}>} rows
 * @param {Actor|null} actor
 * @param {{diff?:number|null, achievement?:number|null}|null} [result] 判定結果(判定前は null)
 * @param {Record<string,string>|null} [dictNames] 辞典フォールバック名
 * @param {Actor|null} [target] 攻撃対象(ダメージ修正で `@target.*` を参照する場合。判定では null)
 * @param {object|null} [bearer] 用途の親アイテム(`@item.self` を式で参照可にする)
 * @returns {Promise<{total:number, sources:Array<{name:string, value:number}>}>}
 */
export async function evaluateBonusRows(rows, actor, result = null, dictNames = null, target = null, bearer = null) {
    let total = 0;
    const sources = [];
    const data = buildFormulaData(actor, result, bearer, target); // @item/@target は全行で共通
    for (const row of (rows ?? [])) {
        const val = await evaluateFormula(row?.formula, data);
        if (!Number.isFinite(val) || val === 0) continue;
        total += val;
        sources.push({ name: resolveItemNameByKey(actor, row?.source, dictNames) || "用途", value: val });
    }
    return { total, sources };
}

/**
 * 用途自身の修正値(専用欄・checkBonusSelf / damageBonusSelf)を評価する(2026-07-10)。供給元つきの
 * 追加行(evaluateBonusRows)とは別枠の、その用途の親アイテムが持つ修正値。式では `@item.self`＝
 * 親アイテムを参照でき、台帳の帰属名は**親アイテム名**(bearer.name・なければ "用途")。
 * @param {string} formula
 * @param {Actor|null} actor
 * @param {{diff?:number|null, achievement?:number|null}|null} [result]
 * @param {Actor|null} [target] 攻撃対象(ダメージ側で `@target.*`)
 * @param {object|null} [bearer] 用途の親アイテム(`@item.self`・帰属名)
 * @returns {Promise<{name:string, value:number}|null>} 評価不能・0 は null
 */
export async function evaluateSelfBonus(formula, actor, result = null, target = null, bearer = null) {
    const data = buildFormulaData(actor, result, bearer, target);
    const val = await evaluateFormula(formula, data);
    if (!Number.isFinite(val) || val === 0) return null;
    return { name: bearer?.name || "用途", value: val };
}

/**
 * 純数値の速判定(Foundry 非依存)。数値でなければ null。
 * @param {string} formula
 * @returns {number|null}
 */
export function parsePlainNumber(formula) {
    const f = String(formula ?? "").trim();
    if (!f) return null;
    return /^[+-]?\d+(\.\d+)?$/.test(f) ? Number(f) : null;
}

/**
 * 式を決定的に評価する。`@diff` / `@achievement` 等の参照キーは data から解決する。
 * @param {string} formula 式(例: "2 + @diff")
 * @param {object} data    参照キーのデータ(buildCheckFormulaData の結果等)
 * @returns {Promise<number|null>} 評価値。評価不能(自由文・ダイス含み・構文エラー)は null
 */
export async function evaluateFormula(formula, data = {}) {
    const plain = parsePlainNumber(formula);
    if (plain !== null) return plain;
    const f = String(formula ?? "").trim();
    if (!f) return null;
    try {
        const roll = new Roll(f, data);
        if (!roll.isDeterministic) return null; // ダイスを含む式は機械適用しない(表示のみ)
        await roll.evaluate();
        return Number.isFinite(roll.total) ? roll.total : null;
    } catch {
        return null;
    }
}
