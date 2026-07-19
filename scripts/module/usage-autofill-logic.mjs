/**
 * @fileoverview 用途の自動入力(発動パラメータ導出)の純ロジック(Foundry 非依存・テスト対象)。
 * 正本: Check_Rules.md「組み合わせ後の対象」「組み合わせ後の射程」「目標値の選択肢の扱い」。
 *
 * 優先度表(対象・射程)はルール由来。「解説参照」「その他」は表に無いシステム側の値で、
 * KI-033(2026-07-19 ユーザー裁定)により次の扱いに確定した:
 * - 用途において「解説参照」は不自然(用途は解説の実装そのものなので自己参照になる)。
 *   親データが「解説参照」の場合、用途側では「その他」へ自動解決する(対象欄に限らず全欄)。
 * - 「解説参照」「その他」は優先度最下位のフォールバック: 有効値が1つでもあればそちらが勝ち、
 *   有効値が無くそれらだけなら「その他」を書き込む(親が「その他」なら自由記入欄も複写・
 *   「解説参照」なら空)。
 */

/** 解説参照/その他のフォールバック優先度(有効値の最下位 1 未満・blank の 0 より上)。 */
const FALLBACK_RANK = 0.5;

const isFallbackValue = (v) => v === "explanation" || v === "other";

/** 対象優先度（高→低）: 自身 > 単体※ > チーム > シーン(選択) > シーン > 範囲(選択) > 範囲 > 単体 */
export function targetRank(target, isFixed) {
    switch (target) {
        case "self":        return 8;
        case "single":      return isFixed ? 7 : 1;
        case "team":        return 6;
        case "sceneSelect": return 5;
        case "scene":       return 4;
        case "areaSelect":  return 3;
        case "area":        return 2;
        case "explanation":
        case "other":       return FALLBACK_RANK;
        default:            return 0; // blank は無視
    }
}

/** 射程の物理的な短さ順（小さいほど近い）。※複数時の「短い方を優先」に使用 */
export const RANGE_PHYSICAL = { close: 0, short: 1, middle: 2, long: 3, superLong: 4, weapon: 5 };

/** 幅(最長射程)を持てる射程値=物理射程。武器/なし/その他/blank は単点のみ */
export const RANGE_SPAN_CAPABLE = new Set(["close", "short", "middle", "long", "superLong"]);

/** 射程優先度（高→低）: 至近※ > 武器 > 超遠 > 遠 > 中 > 近 > 至近 */
export function rangeRank(range, isFixed) {
    if (range === "close" && isFixed) return 7;
    switch (range) {
        case "weapon":    return 6;
        case "superLong": return 5;
        case "long":      return 4;
        case "middle":    return 3;
        case "short":     return 2;
        case "close":     return 1;
        case "explanation":
        case "other":     return FALLBACK_RANK;
        default:          return 0; // blank / なし は無視
    }
}

/**
 * 参加技能群の対象を優先度で解決。null=有効な対象なし。
 * 勝者が解説参照/その他のときは「その他」へ変換して返す(otherText=自由記入欄の複写値)。
 * @param {Array<{target?: string, isFixed?: boolean, otherText?: string}>} entries
 * @returns {?{target: string, isFixed: boolean, otherText?: string}}
 */
export function resolveTarget(entries) {
    let best = null, bestRank = 0;
    for (const e of entries) {
        const r = targetRank(e.target, e.isFixed);
        if (r > bestRank) { bestRank = r; best = e; }
    }
    if (!best) return null;
    if (isFallbackValue(best.target)) {
        return { target: "other", isFixed: !!best.isFixed, otherText: best.target === "other" ? (best.otherText ?? "") : "" };
    }
    return { target: best.target, isFixed: best.isFixed };
}

/** 解説参照/その他の勝者を「その他」へ変換する(射程用・otherText=自由記入欄の複写値)。 */
function convertRangeResult(best) {
    if (isFallbackValue(best.range)) {
        return { range: "other", isFixed: !!best.isFixed, otherText: best.range === "other" ? (best.otherText ?? "") : "" };
    }
    return { range: best.range, isFixed: best.isFixed };
}

/**
 * 参加技能群の射程を優先度で解決。変更不可（※）が複数なら最短を優先。
 * @param {Array<{range?: string, isFixed?: boolean, otherText?: string}>} entries
 * @returns {?{range: string, isFixed: boolean, otherText?: string}}
 */
export function resolveRange(entries) {
    const valid = entries.filter(e => rangeRank(e.range, e.isFixed) > 0);
    if (!valid.length) return null;
    const fixed = valid.filter(e => e.isFixed);
    if (fixed.length >= 2) {
        const shortest = fixed.reduce((a, b) =>
            (RANGE_PHYSICAL[b.range] ?? 99) < (RANGE_PHYSICAL[a.range] ?? 99) ? b : a);
        return convertRangeResult({ ...shortest, isFixed: true });
    }
    const best = valid.reduce((a, b) =>
        rangeRank(b.range, b.isFixed) > rangeRank(a.range, a.isFixed) ? b : a);
    return convertRangeResult(best);
}

/**
 * 参加技能群の目標値を解決。数値があれば最大、なければ最初の実値型
 * (解説参照/その他はフォールバック=実値が無いときだけ「その他」として採用)。
 * @param {Array<{targetValue?: string, number?: number, otherText?: string}>} entries
 * @returns {?{targetValue: string, targetValueNumber?: number, targetValueOther?: string}}
 */
export function resolveTargetValue(entries) {
    const numerics = entries.filter(e => e.targetValue === "number");
    if (numerics.length) {
        return { targetValue: "number", targetValueNumber: Math.max(...numerics.map(e => e.number ?? 0)) };
    }
    const real = entries.find(e => e.targetValue && e.targetValue !== "blank" && e.targetValue !== "none"
        && !isFallbackValue(e.targetValue));
    if (real) return { targetValue: real.targetValue };
    const fallback = entries.find(e => isFallbackValue(e.targetValue));
    if (!fallback) return null;
    return { targetValue: "other", targetValueOther: fallback.targetValue === "other" ? (fallback.otherText ?? "") : "" };
}

/**
 * ベース技能のタイミング配列から用途へ写すタイミングを解決する。
 * 最初の実値 timing を優先し、解説参照/その他だけならフォールバック採用
 * (解説参照は「その他」へ変換・サブ選択の解説参照も同様)。null=設定なし。
 * @param {Array<{value?: string, actionName?: string, processName?: string, timingOther?: string}>} timingList
 * @returns {?{value: string, actionName: string, processName: string, timingOther: string}}
 */
export function resolveTiming(timingList) {
    const list = Array.isArray(timingList) ? timingList : [];
    const isSet = (x) => !!x?.value && x.value !== "blank";
    const bt = list.find(x => isSet(x) && !isFallbackValue(x.value)) ?? list.find(isSet);
    if (!bt) return null;
    if (bt.value === "explanation") {
        return { value: "other", actionName: "blank", processName: "blank", timingOther: "" };
    }
    const subst = (v) => (v === "explanation" ? "other" : (v ?? "blank"));
    return {
        value: bt.value,
        actionName: subst(bt.actionName),
        processName: subst(bt.processName),
        timingOther: bt.timingOther ?? "",
    };
}

/**
 * 用途に保存済みの「解説参照」を「その他」へ正規化する(冪等・KI-033)。
 * 対象・射程・目標値・タイミング(値/アクション種別/プロセス種別)が対象。
 * 自由記入欄は変更しない(目標値の式欄 targetValueOther は両値で共用のため保持される)。
 * @param {object} usage 用途エントリ(平データ・その場で書き換える)
 * @returns {boolean} 変更があったか
 */
export function normalizeUsageExplanation(usage) {
    let changed = false;
    const fix = (obj, key) => {
        if (obj?.[key] === "explanation") { obj[key] = "other"; changed = true; }
    };
    fix(usage, "target");
    fix(usage, "range");
    fix(usage, "targetValue");
    fix(usage?.timing, "value");
    fix(usage?.timing, "actionName");
    fix(usage?.timing, "processName");
    return changed;
}
