/**
 * @fileoverview アウトフィットのカテゴリ定数(大分類 → 小分類 → Item type 対応)
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md(フェーズ6-0、2026-06-12 ユーザー確認)
 *
 * - majorCategory / minorCategory(outfit-base.mjs)の choices の供給源。
 * - シート側では大分類→小分類の連動ドロップダウンとし、その Item type に
 *   有効な小分類のみを提示する(フェーズ6-1 以降)。
 * - 値は日本語表記をそのまま格納する(フェーズ4 の i18n ハードコード方針に従う)。
 */

/**
 * 大分類 → { 小分類: Item type } のマップ。
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const OUTFIT_CATEGORIES = Object.freeze({
  "武器": Object.freeze({
    "白兵武器":   "weapon",
    "射撃武器":   "weapon",
    "搭載兵器":   "weapon",
    "武器オプション": "weapon",
    "特殊弾":     "weapon",
  }),
  "防具": Object.freeze({
    "ボディアーマー": "armor",
    "アーマーギア":   "armor",
    "ファッション":   "general",
  }),
  "サイバーウェア": Object.freeze({
    "IANUS":            "ianus",
    "IANUSオプション":   "ianus",
    "ニューラルウェア":   "general",
    "アーティフィシャルボディ": "general",
    "オーガニックウェア": "general",
    "サイコアプリ":      "general",
    "コスメティック":     "general",
    "全身義体":          "cyborg",
  }),
  "トロン": Object.freeze({
    "ポケットロン": "tron",
    "PTオプション": "tron",
    "タップ":       "tap",
    "ソフトウェア": "tap",
    "ハードウェア": "tap",
  }),
  "ヴィークル": Object.freeze({
    "地上車両":   "vehicle",
    "航空機":     "vehicle",
    "船舶":       "vehicle",
    "ウォーカー": "vehicle",
    "ドローン":   "vehicle",
    "ヴィークルオプション": "vehicle",
  }),
  "住宅": Object.freeze({
    "住宅施設":     "residence",
    "住宅オプション": "residence",
    "住宅アクセサリ": "residence",
  }),
  "アイテム": Object.freeze({
    "ツール":         "general",
    "マジックアイテム": "general",
    "生体装備":       "general",
    "生体装備：武器":  "weapon",
    "生体装備：防具":  "armor",
    "ドラッグ":       "general",
    "フーズ":         "general",
  }),
  "サービス": Object.freeze({
    "ソーシャル":     "general",
    "バックグラウンド": "general",
    "エキストラ":     "general",
    "コンバイナー":   "combiner",
  }),
});

/**
 * majorCategory の choices(大分類名の配列)。
 * @returns {string[]}
 */
export function getMajorCategoryChoices() {
  return Object.keys(OUTFIT_CATEGORIES);
}

/**
 * minorCategory の choices(全小分類名のフラットな配列)。
 * 小分類名は全体で一意である。
 * @returns {string[]}
 */
export function getMinorCategoryChoices() {
  return Object.values(OUTFIT_CATEGORIES).flatMap((minors) => Object.keys(minors));
}
