/**
 * @fileoverview 識別キー(identificationKey)の汎用ユーティリティ(2026-07-10 ユーザー確定)。
 *
 * 識別キーは「該当アイテム(技能・アウトフィット等)を**逆引き**するための安定参照」であり、
 * **保存するのは識別キー・表示は必ず逆引きしたアイテムの現在名**で行う(生の識別キーは表示しない)。
 * 各所で `actor.items.find(i => i.system.identificationKey === key)` を再実装していたのを一本化する。
 */

/**
 * アクターの所持アイテムから identificationKey が一致するものを逆引きする。
 * @param {Actor|null} actor
 * @param {string} key identificationKey
 * @param {{type?:string}} [opts] type 指定で種別(generalSkill 等)を絞る
 * @returns {Item|null} 一致アイテム(無ければ null)
 */
export function findItemByIdentificationKey(actor, key, { type = null } = {}) {
    if (!actor?.items || !key) return null;
    return actor.items.find(i =>
        i.system?.identificationKey === key && (!type || i.type === type)
    ) ?? null;
}

/**
 * 識別キーを**表示名**に解決する。逆引きしたアイテムの**現在名**を返す(生の識別キーは返さない)。
 * アクターに該当アイテムがあればその名前、無ければ辞典名(渡された場合)、最後に空文字。
 * @param {Actor|null} actor
 * @param {string} key identificationKey
 * @param {Record<string,string>|null} [dictNames] loadSkillChoices の {key:name}(辞典フォールバック)
 * @returns {string} 表示名(解決不能は "")
 */
export function resolveItemNameByKey(actor, key, dictNames = null) {
    if (!key) return "";
    const item = findItemByIdentificationKey(actor, key);
    if (item) return item.name;
    if (dictNames && dictNames[key]) return dictNames[key];
    return "";
}

/**
 * 技能名の表示整形(2026-07-18 ユーザー確定): **アイテム名欄・アクターシートの技能リスト以外**で
 * 技能名を表示するときは必ず 〈〉 で囲い、秘技/奥義/演出特技の識別マーク(†・※・@)は省く。
 * @param {string} name 技能名(素の item.name)
 * @returns {string} 「〈名前〉」(空は "")
 */
export function formatSkillName(name) {
    // 既に 〈〉 付きの入力も受ける(冪等・二重囲い防止)
    const stripped = String(name ?? "").replace(/[〈〉†※@]/g, "").trim();
    return stripped ? `〈${stripped}〉` : "";
}

/**
 * アイテムの表示ラベル: 技能(一般/スタイル)は formatSkillName で 〈〉 整形・それ以外は素の名前。
 * 用途の実効名「タイプ名（親アイテム名）」の親名部分など、技能か否かが混在する表示に使う。
 * @param {{type?: string, name?: string}|null} item
 * @returns {string}
 */
export function itemDisplayName(item) {
    if (!item) return "";
    return (item.type === "generalSkill" || item.type === "styleSkill")
        ? formatSkillName(item.name)
        : (item.name ?? "");
}
