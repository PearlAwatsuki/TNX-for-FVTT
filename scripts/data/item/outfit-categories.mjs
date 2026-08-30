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
 * 小分類キーは全体で一意。大分類キーとも重複させないこと
 * (用途の repairableCategories が大分類キー・小分類キーを1つの配列に混在保存するため)。
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
 * アウトフィットとして扱う Item type の集合(OUTFIT_CATEGORIES の types から導出)。
 * 「全てのアウトフィットから選択」(使用時付与のアイテム着地・2026-07-13 再設計)の既定候補判定に使う。
 * @type {ReadonlySet<string>}
 */
export const OUTFIT_TYPES = Object.freeze(new Set(
  Object.values(OUTFIT_CATEGORIES).flatMap(major =>
    Object.values(major.minors).flatMap(minor => minor.types)),
));

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
 * 小分類キー → 所属する大分類キー。未知は空文字。
 * @param {string} minorKey
 * @returns {string}
 */
export function majorOfMinor(minorKey) {
  for (const [majorKey, major] of Object.entries(OUTFIT_CATEGORIES)) {
    if (major.minors[minorKey]) return majorKey;
  }
  return "";
}

/**
 * アウトフィットの**分類集合**(主分類＋副分類)を返す(フェーズ16-1・2026-08-30 裁定)。
 * 「複数の分類を持つアウトフィットは両方の分類として扱う」の照合はこの集合を経由する
 * (分類を読むルール挙動——改造可能項目・部位ホスト照合・電子妨害・修理・サービス免疫・
 * AE 分類狙い・※表示——の一本化点)。
 *
 * - 主分類(majorCategory/minorCategory)に副分類(additionalCategories)を加えた平坦な配列。
 * - minor だけの行は大分類を樹から補完する(全体一意のため導出可能)。
 * - 旧 isCyber=true は**サイバーウェア副分類として包摂**する: DataModel を通ったデータは
 *   migrateData(outfit-base)が副分類へ移行済みだが、辞典 index 等の**生データ**は移行を
 *   経ないため、ここで読み替える(isCyber フィールド自体は 2026-08-30 裁定で廃止)。
 * @param {{majorCategory?:string, minorCategory?:string,
 *          additionalCategories?:Array<{major?:string, minor?:string}>, isCyber?:boolean}} system
 * @returns {Array<{major:string, minor:string}>}
 */
export function outfitClassifications(system) {
  const out = [];
  const push = (major, minor) => {
    let M = String(major ?? "");
    const m = String(minor ?? "");
    if (!M && m) M = majorOfMinor(m);
    if (!M && !m) return;
    if (!out.some((r) => r.major === M && r.minor === m)) out.push({ major: M, minor: m });
  };
  push(system?.majorCategory, system?.minorCategory);
  const rows = Array.isArray(system?.additionalCategories) ? system.additionalCategories : [];
  for (const row of rows) push(row?.major, row?.minor);
  if (system?.isCyber === true) push("cyberware", "");
  return out;
}

/**
 * アウトフィットが分類キー(大分類キーまたは小分類キー・全体一意)に該当するか。
 * 主分類・副分類のどちらで該当しても true(「両方の分類として扱う」)。
 * @param {object} system アウトフィットの system
 * @param {string} key 大分類キーまたは小分類キー
 * @returns {boolean}
 */
export function hasClassification(system, key) {
  if (!key) return false;
  return outfitClassifications(system).some((r) => r.major === key || r.minor === key);
}

/**
 * 「大分類 optgroup ＋（大分類全体）＋ 小分類 option」の選択肢構造を組み立てる。
 * 修理対応分類(用途)と製作技能の対応分類(一般技能)が共用する(2026-08-30)。
 * キー空間は大分類キー・小分類キーの混在(全体一意)。
 * @param {{excludeService?: boolean, excludeKeys?: Set<string>}} [opts]
 *   excludeService: サービス大分類とその配下を除外(既定 true)
 *   excludeKeys: 除外するキーの集合(選択済みの除外に使う)
 * @returns {Array<{label: string, minors: Array<{value: string, label: string}>}>}
 */
export function buildCategoryKeyGroups({ excludeService = true, excludeKeys } = {}) {
  const excluded = excludeKeys ?? new Set();
  return Object.entries(OUTFIT_CATEGORIES)
    .filter(([majorKey]) => !(excludeService && majorKey === "service"))
    .map(([majorKey, major]) => ({
      label: major.label,
      minors: [
        ...(excluded.has(majorKey) ? [] : [{ value: majorKey, label: "（大分類全体）" }]),
        ...Object.entries(major.minors)
          .filter(([minorKey]) => !excluded.has(minorKey))
          .map(([minorKey, minor]) => ({ value: minorKey, label: minor.label })),
      ],
    }))
    .filter((g) => g.minors.length);
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
 * スロット種別を表す小分類(ソフト/ハード) → そのスロットを持つホストの小分類表記。
 * ルール上の部位表示は「タップ」だけ(ソフト/ハードを区別しない)。software/hardware は tron 配下の
 * 小分類だが実体はタップのスロットなので、部位名ではこの値(=「タップ」)に置き換える。
 * ※占有リストの「タップ/ソフトウェア」は soft/hard を見分けるための便宜表記で、正本の部位表示ではない。
 * @type {Readonly<Record<string, string>>}
 */
export const SLOT_KIND_MINOR_HOSTS = Object.freeze({
  software: "タップ",
  hardware: "タップ",
});

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
