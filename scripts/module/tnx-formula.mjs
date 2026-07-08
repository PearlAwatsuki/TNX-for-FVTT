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
