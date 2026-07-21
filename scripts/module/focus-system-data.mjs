/**
 * @fileoverview FS判定シートのデータ(2026-07-21 是正)。
 *
 * FS判定シートは**JournalEntry のシート**であり、データは flags に置く——アクトシートと
 * 同じ持ち方(`Journal.registerSheet` ＋ flags)。当初 JournalEntryPage のサブタイプとして
 * 実装したのは Code の誤りで、ユーザーは一貫して「ジャーナルエントリーのタイプ」と述べていた。
 * JournalEntry はサブタイプを持てない(`hasTypeData` が false)ため、DataModel ではなく
 * flags ＋ ここでの正規化で表す。
 *
 * FS 名はジャーナル名を使う。進行状態(進行値・カット数)は持たない——実行中 FS の正本は
 * ワールド設定 `activeFocusSystems` で、起動時にスナップショットを取り込む。
 */

const SCOPE = "tokyo-nova-axleration";
const KEY = "focusSystem";

const randomID = () => (globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18));

/** 判定行の新規行。 */
export function newProgressRow() {
    return {
        id:          randomID(),
        threshold:   0,
        skillKeys:   [],
        targetValue: 0,
        progressMod: { source: "none", param: "", formula: "" },
        note:        "",
    };
}

/** 空の FS判定。 */
export function defaultFocusSystemData() {
    return {
        restriction:      "",
        defeatCondition:  { type: "cut", text: "", cutLimit: 0 },
        defeatEffect:     "",
        targetProgress:   0,
        supportSkillKeys: [],
        rows:             [],
        memo:             "",
    };
}

/** 空・重複を畳んだ識別キーの配列。 */
function normalizeKeys(keys) {
    const out = [];
    for (const key of (keys ?? [])) {
        const k = String(key ?? "").trim();
        if (k && !out.includes(k)) out.push(k);
    }
    return out;
}

/**
 * 判定行を正規化する(欠けた項目を埋め、数値を数値にする)。
 * 進行修正は `{source, param, formula}` の3点で、source=none のときパラメータを使わない。
 */
function normalizeRow(row) {
    const mod = row?.progressMod ?? {};
    // 進行判定の技能は複数持てる(2026-07-21)。旧・単数 skillKey は配列へ読み替える
    const skillKeys = row?.skillKeys
        ? normalizeKeys(row.skillKeys)
        : normalizeKeys([row?.skillKey]);
    return {
        id:          row?.id || randomID(),
        threshold:   Number(row?.threshold) || 0,
        skillKeys,
        targetValue: Number(row?.targetValue) || 0,
        progressMod: {
            source:  mod.source ?? "none",
            param:   mod.param ?? "",
            formula: mod.formula ?? "",
        },
        note:        row?.note ?? "",
    };
}

/**
 * ジャーナルの flags から FS判定の設定を読む(正規化済み・元は書き換えない)。
 *
 * 支援判定の技能は**配列**で持つ(2026-07-21)。当初 Code が単数の文字列にしていたが、
 * 現物のシートの「支援判定」欄は自由記入で複数書けるうえ、単数と決めた根拠は無かった。
 * 旧データ(単数 `supportSkillKey`)は配列へ読み替える。
 *
 * @param {?{flags?:object}} doc JournalEntry(または同じ形のもの)
 * @returns {object} FS判定の設定
 */
export function readFocusSystemData(doc) {
    const saved = doc?.flags?.[SCOPE]?.[KEY] ?? {};
    const base  = defaultFocusSystemData();

    const keys = saved.supportSkillKeys
        ? normalizeKeys(saved.supportSkillKeys)
        : normalizeKeys([saved.supportSkillKey]);   // 旧・単数からの読み替え

    return {
        restriction:     saved.restriction ?? base.restriction,
        defeatCondition: {
            type:     saved.defeatCondition?.type ?? base.defeatCondition.type,
            text:     saved.defeatCondition?.text ?? base.defeatCondition.text,
            cutLimit: Number(saved.defeatCondition?.cutLimit) || 0,
        },
        defeatEffect:     saved.defeatEffect ?? base.defeatEffect,
        targetProgress:   Number(saved.targetProgress) || 0,
        supportSkillKeys: keys,
        rows:             (saved.rows ?? []).map(normalizeRow),
        memo:             saved.memo ?? base.memo,
    };
}

/** FS判定シートとして使われているジャーナルか(起動フォームの読み込み元の絞り込み)。 */
export function isFocusSystemJournal(doc) {
    return !!doc?.flags?.[SCOPE]?.[KEY];
}

/** flags のスコープとキー(書き込み側で使う)。 */
export const FOCUS_SYSTEM_FLAG = Object.freeze({ scope: SCOPE, key: KEY });
