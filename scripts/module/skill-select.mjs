/**
 * @fileoverview 技能選択プルダウンの共通ヘルパー(2026-07-09)。
 *
 * リアクション・代用判定・治療など「技能を選ばせる」全ダイアログで表示順と既定選択を統一する。
 * - 並び順: アクターシートと同じ手動並び順(item.sort)。**一般技能 → スタイル技能**の順に束ねる。
 * - 既定選択: 規定の指定技能(パリー=白兵・ドッジ=回避・治療=医療 等)がある場合は初期値に選ぶ
 *   (正準名で照合。規定が無い/所持していなければ先頭のまま)。
 */

import { formatSkillName } from "./identification.mjs";

/** 一般技能(sort 順) → スタイル技能(sort 順) の順に並べ替える。 */
export function orderSkills(items) {
    const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
    const general = items.filter(i => i.type === "generalSkill").sort(bySort);
    const style   = items.filter(i => i.type === "styleSkill").sort(bySort);
    return [...general, ...style];
}

/**
 * 技能選択ダイアログ用の option 配列を組み立てる。
 * @param {Item[]} items 候補技能(呼び出し側でフィルタ済み)
 * @param {{defaultName?: string}} [opts] defaultName=正準名(白兵/回避/自我/信用/医療 等)で既定選択
 * @returns {Array<{value:string, label:string, selected:boolean}>}
 */
export function buildSkillOptions(items, { defaultName = "" } = {}) {
    const ordered = orderSkills(items);
    let matched = false;
    return ordered.map(s => {
        const selected = !matched && !!defaultName && s.name === defaultName;
        if (selected) matched = true;
        // 技能名の表示は 〈〉 整形(2026-07-18 ユーザー確定・識別マークは省く)
        return { value: s.id, label: formatSkillName(s.name), selected };
    });
}
