/**
 * @fileoverview 指定技能への応答の選択肢(フェーズ14-9・2026-08-26 設計・純ロジック)。
 *
 * プレイヤーの決定は「この指定にどう応じるか」の一段で、選択肢は**4系統**(2026-08-25/26 裁定):
 * 1. 指定技能そのもの——所持は選べる・未所持はグレーアウト(存在は見せる)
 * 2. 代用技能(substituteTarget)——代用元が指定に含まれる所持技能(ペナルティなしの正規選択肢)
 * 3. 指定充足宣言(designationStandIn)——判定種別が一致し、指定キーが条件を満たす所持技能
 * 4. 代用判定——指定(の束)への応じ方としての常設の明示的選択肢。行(目標値)ごとに出す
 *
 * 代用判定は「選んだ技能の代用」ではなく**指定技能の代用**(2026-08-25 ユーザー是正)。
 * 「未所持なら自動で代用へ落とす」遷移は廃止され、代用はプレイヤーが明示的に選ぶ。
 */

import { idKeyPrefix } from "./skill-dictionary.mjs";

/** 指定充足宣言の判定種別(拡張可能・2026-08-26 裁定=まず情報収集と登場の2種)。 */
export const STAND_IN_KINDS = {
    infoGathering: "情報収集判定",
    appearance:    "登場判定",
};

/**
 * 指定充足の条件照合。指定キーが宣言の条件を満たすか。
 * - "society"(あらゆる社会)=区分が社会なら合致。辞典に無いキーはプレフィックスで導出する。
 * - 下位区分(SOCIETY_CLASSES のキー)=辞典の societyClass が一致するキーのみ(未分類は拾わない)。
 * @param {string} condition 宣言の条件
 * @param {string} key 指定キー
 * @param {Map<string, {type: string, societyClass: string}>} classByKey 辞典由来の区分マップ
 * @returns {boolean}
 */
export function standInMatchesKey(condition, key, classByKey) {
    const cls = classByKey?.get?.(key) ?? null;
    const type = cls?.type || (idKeyPrefix(key) || "");
    if (type !== "society") return false;
    if (condition === "society") return true;
    return (cls?.societyClass ?? "") === condition;
}

/**
 * 応答選択肢を組む。行(=指定の単位。情報項目は技能行・判定要求/登場は1行)ごとに4系統を列挙する。
 * @param {{rows?: Array<{keys?: Array<string>, tn?: ?(number|string), label?: string}>,
 *          actorSkills?: Array<{id: string, name: string, identificationKey: string,
 *                               isSubstitute?: boolean, substituteTarget?: Array<string>,
 *                               designationStandIn?: Array<{kinds?: Array<string>, condition?: string}>}>,
 *          classByKey?: Map<string, object>, checkKind?: ?string}} args
 *        checkKind=null(判定要求など種別を持たない文脈)では指定充足は並ばない
 * @returns {Array<object>} 選択肢。kind: "designated"(key/itemId/disabled) | "skill"(source=
 *          "substitute"|"standIn") | "direct"(ラベルのみ行) | "substitution"(常設の代用判定)
 */
export function buildDesignationOptions({ rows = [], actorSkills = [], classByKey = new Map(), checkKind = null } = {}) {
    const options = [];
    rows.forEach((row, rowIndex) => {
        const keys = Array.isArray(row?.keys) ? row.keys.filter(Boolean) : [];
        const tn = row?.tn ?? null;
        const used = new Set();

        if (!keys.length) {
            // 識別キーの無い旧自由記述行: 直接オープンの選択肢として残す(ラベルが無ければ挑み先なし)
            if (row?.label) options.push({ kind: "direct", rowIndex, tn, label: row.label });
        }

        for (const key of keys) {
            const owned = actorSkills.find(s => s.identificationKey === key) ?? null;
            if (owned) used.add(owned.id);
            options.push({
                kind: "designated", rowIndex, tn, key,
                itemId: owned?.id ?? null, disabled: !owned,
            });
        }

        for (const skill of actorSkills) {
            if (used.has(skill.id)) continue;
            if (skill.isSubstitute === true
                && (skill.substituteTarget ?? []).some(t => keys.includes(t))) {
                used.add(skill.id);
                options.push({ kind: "skill", source: "substitute", rowIndex, tn, itemId: skill.id, name: skill.name });
                continue;
            }
            if (checkKind && (skill.designationStandIn ?? []).some(d =>
                (d?.kinds ?? []).includes(checkKind)
                && keys.some(k => standInMatchesKey(d?.condition ?? "", k, classByKey)))) {
                used.add(skill.id);
                options.push({ kind: "skill", source: "standIn", rowIndex, tn, itemId: skill.id, name: skill.name });
            }
        }

        // 代用判定は行(目標値)ごとに常設(2026-08-25 是正=指定の束への応じ方)
        if (keys.length || row?.label) {
            options.push({ kind: "substitution", rowIndex, tn, label: row?.label ?? "" });
        }
    });
    return options;
}
