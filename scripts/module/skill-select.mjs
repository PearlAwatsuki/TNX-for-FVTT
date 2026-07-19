/**
 * @fileoverview 技能選択プルダウンの共通ヘルパー(2026-07-09)。
 *
 * リアクション・代用判定・治療など「技能を選ばせる」全ダイアログで表示順と既定選択を統一する。
 * - 並び順: アクターシートと同じ手動並び順(item.sort)。**一般技能 → スタイル技能**の順に束ねる。
 * - 既定選択: 規定の指定技能(パリー=白兵・ドッジ=回避・治療=医療 等)がある場合は初期値に選ぶ
 *   (正準名で照合。規定が無い/所持していなければ先頭のまま)。
 */

import { formatSkillName, skillSortPosition } from "./identification.mjs";

/**
 * 一般技能 → スタイル技能 の順に並べ替える。各群の中は
 * ①手動並び順(item.sort=シートの並び) ②正規ソート順(識別キー) ③名前(ja) の優先で比較する
 * (①はアクター所持アイテムのみ持つ。辞典由来の軽量アイテムは②③で正規順=シートの既定順になる。
 * 2026-07-19 ユーザー指示=技能選択プルダウンの並びをシートのソート順へ統一)。
 */
export function orderSkills(items) {
    const cmp = (a, b) => {
        const sa = Number.isFinite(a.sort) ? a.sort : null;
        const sb = Number.isFinite(b.sort) ? b.sort : null;
        if (sa !== null && sb !== null && sa !== sb) return sa - sb;
        const pa = skillSortPosition(a.system?.identificationKey ?? "");
        const pb = skillSortPosition(b.system?.identificationKey ?? "");
        if (pa !== pb) return pa < pb ? -1 : 1;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    };
    const general = items.filter(i => i.type === "generalSkill").sort(cmp);
    const style   = items.filter(i => i.type === "styleSkill").sort(cmp);
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
