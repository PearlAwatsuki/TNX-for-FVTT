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
 * @param {{type?:string|string[]}} [opts] type 指定で種別を絞る(配列で複数可・
 *   例 ["generalSkill","styleSkill"]=技能全般。2026-08-12 追加)
 * @returns {Item|null} 一致アイテム(無ければ null)
 */
export function findItemByIdentificationKey(actor, key, { type = null } = {}) {
    if (!actor?.items || !key) return null;
    const types = (type === null || type === undefined) ? null : (Array.isArray(type) ? type : [type]);
    return actor.items.find(i =>
        i.system?.identificationKey === key && (!types || types.includes(i.type))
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

// ─── 一般技能の正規ソート順(識別キー基準) ─────────────────────────────────────
// 従来 TnxSkillUtils にあったが、辞典ローダ(skill-dictionary)からも使うため循環回避で本モジュールへ
// 移設(2026-07-19)。TnxSkillUtils の同名 static は本実装への委譲として残る。

/** キャスト一般技能の正規ソート順(固有名詞技能はプレフィックスで代表)。 */
export const GENERAL_SKILL_SORT_PREFIXES = [
    "medicine", "ranged", "perception", "cybertech",
    "craft",
    "psychology", "will", "negotiation",
    "art",
    "athletics", "evasion",
    "operate",
    "melee", "intrigue", "stature", "stealth",
    "society",
    "contact",
];

/**
 * identificationKey の正規ソートリスト内位置を返す。
 * "craft_food" → 4、"craft" → 4、未知文字列・空文字 → Infinity
 * @param {string} identificationKey
 * @returns {number}
 */
export function skillSortPosition(identificationKey) {
    if (!identificationKey) return Infinity;
    for (let i = 0; i < GENERAL_SKILL_SORT_PREFIXES.length; i++) {
        const p = GENERAL_SKILL_SORT_PREFIXES[i];
        if (identificationKey === p || identificationKey.startsWith(p + "_")) return i;
    }
    return Infinity;
}

/**
 * 一般技能をアクターへ足すときの `sort` 値を、**正規ソート順の位置に挿し込む**ように決める。
 * キャストシートの一般技能リストは `item.sort` で並ぶため、sort を振らずに作ると
 * 末尾に付いて正規順を無視する(2026-07-10 に辞典ドロップで同じ不具合を是正済み)。
 * 一般技能を作る経路が増えるたびに必要なので、シート外からも呼べるようここに置く
 * (2026-08-13・HO のコネ生成が3つ目の経路)。
 *
 * 識別キーを持たない技能(自作)は位置が Infinity になり末尾へ挿す。
 * @param {Array<{sort?: number, system?: {identificationKey?: string}}>} existingSkills 所持中の一般技能
 * @param {string} identificationKey 追加する技能の識別キー
 * @returns {number} 付与する sort 値
 */
export function calcSkillInsertSort(existingSkills, identificationKey) {
    const targetPos = skillSortPosition(identificationKey);
    let prevSort = 0;
    let nextSort = Infinity;
    for (const skill of existingSkills ?? []) {
        const skillSort = skill.sort ?? 0;
        const skillPos  = skillSortPosition(skill.system?.identificationKey);
        if (skillPos <= targetPos) {
            if (skillSort > prevSort) prevSort = skillSort;
        } else if (skillSort < nextSort) {
            nextSort = skillSort;
        }
    }
    if (!isFinite(nextSort)) return prevSort + 100_000;
    return Math.floor((prevSort + nextSort) / 2);
}

// ─── スタイルの正規ソート順(識別キー基準) ─────────────────────────────────────
// 辞典のスタイルを選ぶプルダウンは、システム内のどこでも本リストの並びで表示する(2026-08-12 ユーザー指示)。

/** スタイルの正規ソート順(スタイル辞典の identificationKey)。 */
export const STYLE_SORT_KEYS = [
    "kabuki", "vasara", "tatara", "mistress", "kabuto", "charisma", "mannequin", "kaze",
    "fate", "kuromaku", "exec", "katana", "kugutsu", "kage", "chakra", "legger",
    "kabuto-wari", "highlander", "mayakashi", "talkie", "inu", "neuro", "common",
    "hiruko", "kurogane", "ibuki", "shikigami", "arashi", "kagemusha", "migiude",
    "etranger", "ayakashi", "utsuwa",
];

const STYLE_SORT_INDEX = new Map(STYLE_SORT_KEYS.map((key, i) => [key, i]));

/**
 * スタイル識別キーの正規ソートリスト内位置を返す。
 * 一般技能(skillSortPosition)と違いプレフィックス一致は見ない(スタイルキーは分割されない)。
 * リストに無いキー・空文字は Infinity(末尾)。
 * @param {string} identificationKey
 * @returns {number}
 */
export function styleSortPosition(identificationKey) {
    if (!identificationKey) return Infinity;
    return STYLE_SORT_INDEX.get(identificationKey) ?? Infinity;
}
