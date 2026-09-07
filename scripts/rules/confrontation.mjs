/**
 * @fileoverview 対決欄の純ロジック(Foundry 非依存・テスト対象)。
 * 正本: Check_Rules.md「対決の解釈（是正 2026-07-17）」。
 *
 * 対決欄は拘束リスト(一般則): ※がなくても列挙された手段・技能によってしかリアクションできない。
 * - 「技能名」(無印): リアクションのコンボに列挙のどれか1つが含まれていればよい。
 * - 「技能名※」: その技能を必ずコンボに含める。
 * - 手段行: リアクション用途タイプ(ドッジ/パリー/リアクション（精神攻撃）等)と 1:1。
 *   資格=そのタイプの用途を持つ技能(レベル1以上)の所持。
 * - 「不可」: 対決判定だがリアクション不能(マスク)。下地の行は保存し続ける(無視・無効化に備える)。
 * 組み合わせ判定の対決欄=構成技能の対決欄の合算(和集合・重複は吸収)。
 */

import { USAGE_TYPE_DEFS } from "./usage-types.mjs";

/** 対決欄の手段行に使えるリアクション用途タイプのキー(定義順)。 */
export const CONFRONTATION_REACTION_VALUES = Object.freeze(
    Object.keys(USAGE_TYPE_DEFS).filter(k => USAGE_TYPE_DEFS[k].kind === "reaction")
);

/**
 * 用途の対決欄の選択肢(2026-07-17 ユーザー確定の並び:
 * 「-」「技能名」「技能名※」＋手段行＋「なし」「不可」)。
 * スタイル技能の対決欄(解説参照/その他あり・手段行なし)とは別のセット。
 */
export const USAGE_CONFRONTATION_OPTIONS = Object.freeze({
    blank:             "-",
    skillName:         "技能名",
    skillNameAsterisk: "技能名※",
    ...Object.fromEntries(CONFRONTATION_REACTION_VALUES.map(k => [k, USAGE_TYPE_DEFS[k].label])),
    none:              "なし",
    cannot:            "不可",
});

/** 行が「情報を持つ」有効行か(blank/なし/名前未設定の技能名行は無効)。 */
function isEffectiveRow(row) {
    const v = row?.value;
    if (v === "cannot") return true;
    if (v === "skillName" || v === "skillNameAsterisk") return !!row.name;
    return CONFRONTATION_REACTION_VALUES.includes(v);
}

/**
 * 対決判定か: 対決欄に「-」「なし」以外の有効行が1つでもあるか(2026-07-17 ユーザー確定)。
 * 「不可」は対決判定(リアクション不能のマスク)として数える。
 */
export function isOpposedConfrontation(rows) {
    return (rows ?? []).some(isEffectiveRow);
}

/** 「不可」マスクがあるか。 */
export function confrontationHasCannot(rows) {
    return (rows ?? []).some(r => r?.value === "cannot");
}

/** 対決欄の手段行(リアクション用途タイプ)を重複なしで返す(定義順)。 */
export function confrontationReactionTypes(rows) {
    const set = new Set((rows ?? []).map(r => r?.value).filter(v => CONFRONTATION_REACTION_VALUES.includes(v)));
    return CONFRONTATION_REACTION_VALUES.filter(v => set.has(v));
}

/**
 * 対決欄の技能名行(識別キー保存・無印/※)を返す。
 * @returns {Array<{key: string, asterisk: boolean}>}
 */
export function confrontationSkillRows(rows) {
    return (rows ?? [])
        .filter(r => (r?.value === "skillName" || r?.value === "skillNameAsterisk") && r.name)
        .map(r => ({ key: r.name, asterisk: r.value === "skillNameAsterisk" }));
}

/** ※(必須)の技能識別キー一覧。 */
export function asteriskSkillKeys(rows) {
    return confrontationSkillRows(rows).filter(r => r.asterisk).map(r => r.key);
}

/**
 * 対決行の合算(追記マージ・2026-07-17 ユーザー確定)。
 * 既存行(existing)を保持したまま incoming を追記する。置き換えにしないのは、一般技能が対決
 * データを持たず用途に手入力された行が消えてはならないため。
 * - 完全一致(同 value・技能名行は同キー)は吸収(スキップ)。
 * - 無印技能名行は、既にある手段行のリアクション用途タイプをその技能が持つなら吸収
 *   (例: ドッジ行があり〈回避〉がドッジ用途を持つ→〈回避〉行はスキップ。既定技能でなく
 *   技能の能力で判定する=2026-07-17 ユーザー裁定)。※(必須)行は吸収しない。
 * - blank/なし・用途対決欄で表せない値(スタイル技能の解説参照/その他)は持ち込まない。
 * @param {Array<object>} existing 用途の既存行
 * @param {Array<object>} incoming 追記する行(参加技能の対決欄など)
 * @param {{skillHasReactionType?: (key: string, type: string) => boolean}} [helpers]
 * @returns {Array<object>} 合算後の行(existing は変更しない)
 */
export function mergeConfrontationRows(existing, incoming, { skillHasReactionType = () => false } = {}) {
    const out = (existing ?? []).map(r => ({ ...r }));
    const hasManeuver = (v) => out.some(r => r.value === v);
    const hasSkillRow = (v, key) => out.some(r => r.value === v && (r.name || "") === key);
    for (const row of incoming ?? []) {
        const v = row?.value;
        if (v === "cannot") {
            if (!confrontationHasCannot(out)) out.push(makeRow("cannot"));
            continue;
        }
        if (v === "skillName" || v === "skillNameAsterisk") {
            const key = row.name || "";
            if (!key || hasSkillRow(v, key)) continue;
            if (v === "skillName") {
                const maneuvers = confrontationReactionTypes(out);
                if (maneuvers.some(m => skillHasReactionType(key, m))) continue;
            }
            out.push({
                value: v, name: key,
                skillDict: row.skillDict ?? "", skillGroup: row.skillGroup ?? "", skillSub: row.skillSub ?? "",
            });
            continue;
        }
        if (CONFRONTATION_REACTION_VALUES.includes(v)) {
            if (!hasManeuver(v)) out.push(makeRow(v));
        }
        // blank/none/explanation/other 等はスキップ
    }
    return out;
}

function makeRow(value) {
    return { value, name: "", skillDict: "", skillGroup: "", skillSub: "" };
}
