/**
 * @fileoverview アウトフィットのカテゴリ定数(大分類 → 小分類 → Item type 対応)
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md(フェーズ6-0、2026-06-12 ユーザー確認)
 *
 * フェーズ9: 各カテゴリに**コードキー**と**表示値(label)**を持たせる(2026-06-21 ユーザー確定)。
 * - majorCategory / minorCategory には**キー**(例 "melee")を格納する。
 * - 表示は label を引く(後でローカライズ)。キーは ActiveEffect・他コードからの特定に使う。
 * - 旧データは日本語名を格納していたため、LEGACY_CATEGORY_MAP で キー へ移行する。
 */

/**
 * 大分類キー → { label, minors: { 小分類キー: { label, types } } }。
 * types はその小分類に対応する Item type 配列。
 * 小分類キーは全体で一意。
 * @type {Readonly<Record<string, {label: string, minors: Readonly<Record<string, {label: string, types: string[]}>>}>>}
 */
export const OUTFIT_CATEGORIES = Object.freeze({
  weapon: { label: "武器", minors: Object.freeze({
    melee:        { label: "白兵武器",        types: ["weapon"] },
    ranged:       { label: "射撃武器",        types: ["weapon"] },
    mounted:      { label: "搭載兵器",        types: ["weapon"] },
    weaponOption: { label: "武器オプション",   types: ["weapon"] },
    specialAmmo:  { label: "特殊弾",          types: ["weapon"] },
  }) },
  armor: { label: "防具", minors: Object.freeze({
    bodyArmor: { label: "ボディアーマー", types: ["armor"] },
    armorGear: { label: "アーマーギア",   types: ["armor"] },
    fashion:   { label: "ファッション",   types: ["general"] },
  }) },
  cyberware: { label: "サイバーウェア", minors: Object.freeze({
    ianus:          { label: "IANUS",                  types: ["ianus"] },
    ianusOption:    { label: "IANUSオプション",         types: ["general"] },
    neuralware:     { label: "ニューラルウェア",         types: ["general"] },
    artificialBody: { label: "アーティフィシャルボディ", types: ["general"] },
    organicware:    { label: "オーガニックウェア",       types: ["general"] },
    psychoApp:      { label: "サイコアプリ",            types: ["general"] },
    cosmetic:       { label: "コスメティック",           types: ["general"] },
    fullCyborg:     { label: "全身義体",                types: ["cyborg"] },
  }) },
  tron: { label: "トロン", minors: Object.freeze({
    pocketron: { label: "ポケットロン", types: ["tron"] },
    ptOption:  { label: "PTオプション", types: ["tron"] },
    tap:       { label: "タップ",       types: ["tap"] },
    software:  { label: "ソフトウェア", types: ["tap"] },
    hardware:  { label: "ハードウェア", types: ["tap"] },
  }) },
  vehicle: { label: "ヴィークル", minors: Object.freeze({
    groundVehicle: { label: "地上車両",          types: ["vehicle"] },
    aircraft:      { label: "航空機",            types: ["vehicle"] },
    ship:          { label: "船舶",              types: ["vehicle"] },
    walker:        { label: "ウォーカー",        types: ["vehicle"] },
    drone:         { label: "ドローン",          types: ["vehicle"] },
    vehicleOption: { label: "ヴィークルオプション", types: ["vehicle"] },
  }) },
  housing: { label: "住宅", minors: Object.freeze({
    residence:        { label: "住宅施設",     types: ["residence"] },
    housingOption:    { label: "住宅オプション", types: ["general"] },
    housingAccessory: { label: "住宅アクセサリ", types: ["general"] },
  }) },
  item: { label: "アイテム", minors: Object.freeze({
    tool:      { label: "ツール",         types: ["general"] },
    magicItem: { label: "マジックアイテム", types: ["general"] },
    biotech:   { label: "生体装備",       types: ["general", "weapon", "armor"] },
    drug:      { label: "ドラッグ",       types: ["general"] },
    food:      { label: "フーズ",         types: ["general"] },
  }) },
  service: { label: "サービス", minors: Object.freeze({
    social:     { label: "ソーシャル",       types: ["general"] },
    background: { label: "バックグラウンド", types: ["general"] },
    extra:      { label: "エキストラ",       types: ["general"] },
    combiner:   { label: "コンバイナー",     types: ["combiner"] },
  }) },
});

/**
 * majorCategory の choices({キー: label})。Foundry StringField はこの形式で
 * 「値=キー / 表示=label」のドロップダウンを生成する。
 * @returns {Record<string, string>}
 */
export function getMajorCategoryChoices() {
  const out = {};
  for (const [key, major] of Object.entries(OUTFIT_CATEGORIES)) out[key] = major.label;
  return out;
}

/**
 * minorCategory の choices({キー: label})。全小分類のフラット。
 * @returns {Record<string, string>}
 */
export function getMinorCategoryChoices() {
  const out = {};
  for (const major of Object.values(OUTFIT_CATEGORIES)) {
    for (const [key, minor] of Object.entries(major.minors)) out[key] = minor.label;
  }
  return out;
}

/**
 * 大分類キー → 表示 label。未知は空文字。
 * @param {string} key
 * @returns {string}
 */
export function getMajorCategoryLabel(key) {
  return OUTFIT_CATEGORIES[key]?.label ?? "";
}

/**
 * 小分類キー → 表示 label。未知は空文字。
 * @param {string} key
 * @returns {string}
 */
export function getMinorCategoryLabel(key) {
  for (const major of Object.values(OUTFIT_CATEGORIES)) {
    if (major.minors[key]) return major.minors[key].label;
  }
  return "";
}

/**
 * 「大分類レベルでスロットを共有する」大分類。オプションの部位名(スロット名)を
 * **大分類名**で表記する(「武器」「武器(白兵武器)」)。
 *
 * 構造上は武器(全小分類 weapon 型)もヴィークル(全小分類 vehicle 型)も同型だが、ルルブ表記は
 * **経験的に武器のみ**が大分類名表記で、ヴィークルは小分類名「船舶」「航空機」等でそのまま記述
 * される(ユーザー確認 2026-06-26。理由不明だが武器が例外)。よって構造逆算ではなく**観測に
 * 基づく例外リスト**として持つ。他に該当大分類が見つかればここへ足す。
 * @type {readonly string[]}
 */
export const MAJOR_LEVEL_SLOT_MAJORS = Object.freeze(["weapon"]);

/**
 * 大分類が大分類レベルでスロットを共有するか(オプション部位名を大分類名で表記するか)。
 * @param {string} majorKey
 * @returns {boolean}
 */
export function isMajorLevelSlotMajor(majorKey) {
  return MAJOR_LEVEL_SLOT_MAJORS.includes(majorKey);
}

/**
 * 旧データ(日本語名格納)→ コードキー の対応表(大分類・小分類を一括)。
 * label と同一文字列をキーへ写像する。migrateData 用。
 * @type {Readonly<Record<string, string>>}
 */
export const LEGACY_CATEGORY_MAP = Object.freeze((() => {
  const map = {};
  for (const [majorKey, major] of Object.entries(OUTFIT_CATEGORIES)) {
    map[major.label] = majorKey;
    for (const [minorKey, minor] of Object.entries(major.minors)) {
      map[minor.label] = minorKey;
    }
  }
  return map;
})());
