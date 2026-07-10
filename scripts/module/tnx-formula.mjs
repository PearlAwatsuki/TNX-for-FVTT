/**
 * @fileoverview 式評価ヘルパー(フェーズ12-1 確定・2026-07-08・正本 Check_Rules「差分値」)。
 *
 * 判定結果コンテキストを式に供給し、Foundry Roll の**ダイスなし決定的評価**で解決する
 * (initiative の `@system.combatSpeed.displayTotal` と同じ流儀)。
 * 公開キー: **`@diff`(差分値)・`@achievement`(達成値)**。
 * 数値・算術式・参照キーを含む式は機械適用し、評価不能なもの(自由文・ダイスを含む式・
 * 構文エラー)は null を返して呼び出し側が「表示のみ+手動修正」扱いにする。
 *
 * 消費者: ダメージ算出(damageBoost/damageReduce の formula・手動修正欄)、
 * フェーズ13 の FS 進行判定(`floor(@diff / 10) + 進行修正`)など、式を持つ全機構。
 */

import { resolveItemNameByKey } from "./identification.mjs";

/**
 * 判定結果(checkResult.result)から式評価用のデータオブジェクトを作る(Foundry 非依存)。
 * @param {{diff?: number|null, achievement?: number|null}} result
 * @returns {{diff: number, achievement: number}}
 */
export function buildCheckFormulaData(result) {
    return {
        diff:        Number.isFinite(result?.diff) ? result.diff : 0,
        achievement: Number.isFinite(result?.achievement) ? result.achievement : 0,
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
 * @returns {object} evaluateFormula に渡す data
 */
export function buildFormulaData(actor, result = null) {
    const data = { ...(actor?.getRollData?.() ?? {}) };
    if (result) Object.assign(data, buildCheckFormulaData(result));
    // @item.<識別キー>.system.* : アクターの任意アイテムを識別キーで参照(system 全体)
    const items = {};
    for (const it of (actor?.items ?? [])) {
        const key = it?.system?.identificationKey;
        if (key) items[key] = { system: it.system };
    }
    data.item = items;
    return data;
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
 * @returns {Promise<{total:number, sources:Array<{name:string, value:number}>}>}
 */
export async function evaluateBonusRows(rows, actor, result = null, dictNames = null) {
    let total = 0;
    const sources = [];
    const data = buildFormulaData(actor, result); // @item マップは全行で共通
    for (const row of (rows ?? [])) {
        const val = await evaluateFormula(row?.formula, data);
        if (!Number.isFinite(val) || val === 0) continue;
        total += val;
        sources.push({ name: resolveItemNameByKey(actor, row?.source, dictNames) || "用途", value: val });
    }
    return { total, sources };
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
