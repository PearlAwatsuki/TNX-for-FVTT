/**
 * @fileoverview リストの手動並び替えの汎用純ロジック(フェーズ14-4)。
 *
 * TNX 標準「表・リスト系 UI は手動並び替え可能(上下ボタン＋グリップ DnD)・順序は永続化」の
 * 共通部品。非破壊(新しい配列を返す)・id 不明や範囲端は変化なし/クランプ。
 * DnD の挿入意味論は FS判定エディタ(focus-system-editor)と同じ「抜いてから対象 index へ挿入」。
 */

/**
 * id の要素を delta ぶん前後へ動かした配列を返す(上下ボタン用)。
 * @param {Array<{id: string}>} list
 * @param {string} id
 * @param {number} delta 負=上へ・正=下へ(端でクランプ)
 * @returns {Array} 新しい配列
 */
export function moveItemBy(list, id, delta) {
    const items = [...(list ?? [])];
    const from = items.findIndex(x => x?.id === id);
    if (from < 0) return items;
    const to = Math.min(Math.max(from + (Number(delta) || 0), 0), items.length - 1);
    if (to === from) return items;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    return items;
}

/**
 * id の要素を抜き、指定 index へ挿入した配列を返す(グリップ DnD 用)。
 * @param {Array<{id: string}>} list
 * @param {string} id
 * @param {number} toIndex 挿入先(範囲外はクランプ)
 * @returns {Array} 新しい配列
 */
export function moveItemTo(list, id, toIndex) {
    const items = [...(list ?? [])];
    const from = items.findIndex(x => x?.id === id);
    if (from < 0) return items;
    const [moved] = items.splice(from, 1);
    const to = Math.min(Math.max(Math.trunc(Number(toIndex) || 0), 0), items.length);
    items.splice(to, 0, moved);
    return items;
}
