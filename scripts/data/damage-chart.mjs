/**
 * @fileoverview ダメージチャートの負傷状態(肉体/精神/社会 × 1〜21段)定義。
 *
 * §4.1 境界(ユーザー確定 2026-06-23・Damage_Rules.md): 負傷名・段→効果の対応・付与する条件は
 * **同梱**する。同梱しないのは効果文(プロセ)のみ＝設定アプリでユーザー入力(本ファイルに持たない)。
 *
 * 設計(ユーザー確定 2026-06-23): BS・戦闘不能タグ・ダメージ(負傷)を**すべて同列の状態(condition)**
 * として用意し、`inflicts` で「状態の付与＝指定した別状態の自動付与」を表す(汎用カスケード)。
 * 本ファイルは負傷状態(段1〜21・段0=ダメージなしは状態なし)を定義し、conditions.mjs が
 * CONDITION_KINDS へ統合する(BS→戦闘不能→肉体→精神→社会の順)。
 *
 * 負傷状態の def:
 * - label:   負傷名(同梱)
 * - group:   "physical" | "mental" | "social"(ドロップダウンのグループ)
 * - type:    "wound"(直接の数値/遮断効果は持たない。効果は inflicts と notes)
 * - inflicts:[{ kind, ability?, controlNegate?, duration? }] 付与する別状態(BS/戦闘不能)
 *     - controlNegate:{ ability, downgradeTo? } 指定能力値の制御判定成功で無効/降格
 *     - duration: "治療まで" 等(発火は13/15)
 * - notes:   条件で未モデル化の機構効果(技能使用不可・アクションランク等。発火は12/13/15)
 *
 * カード決定型(衰弱・能力値未指定の重圧)は付与時に Conditions.md §8 のドロー機構へ繋ぐ(未実装)。
 */

const ABIL_LIFE = "life", ABIL_PASSION = "passion", ABIL_REASON = "reason", ABIL_MUNDANE = "mundane";

/** 肉体ダメージ(段1〜21)。 */
const PHYSICAL = {
  "phys-1":  { label: "内出血" },
  "phys-2":  { label: "額が割れる" },
  "phys-3":  { label: "顔面損傷" },
  "phys-4":  { label: "嗅味覚消失" },
  "phys-5":  { label: "背部裂傷" },
  "phys-6":  { label: "胸部損傷",     inflicts: [{ kind: "weakness" }] },
  "phys-7":  { label: "腕部損傷",     notes: "片腕使用不可" },
  "phys-8":  { label: "衝撃",         inflicts: [{ kind: "confusion" }] },
  "phys-9":  { label: "朦朧",         inflicts: [{ kind: "doped-minor" }] },
  "phys-10": { label: "腹部損傷",     inflicts: [{ kind: "faint", controlNegate: { ability: ABIL_LIFE } }] },
  "phys-11": { label: "心臓停止",     inflicts: [{ kind: "coma", controlNegate: { ability: ABIL_LIFE, downgradeTo: "faint" } }] },
  "phys-12": { label: "脚部損傷",     inflicts: [{ kind: "confusion", duration: "治療まで" }] },
  "phys-13": { label: "消化器系損傷", inflicts: [{ kind: "weakness" }] },
  "phys-14": { label: "眼部損傷",     notes: "治療されるまで〈知覚〉判定 -5" },
  "phys-15": { label: "動脈切断",     inflicts: [{ kind: "faint" }] },
  "phys-16": { label: "斬首",         inflicts: [{ kind: "dead" }] },
  "phys-17": { label: "腰部損傷",     inflicts: [{ kind: "confusion", duration: "治療まで" }] },
  "phys-18": { label: "脳震盪",       inflicts: [{ kind: "doped-major" }] },
  "phys-19": { label: "五感消失",     inflicts: [{ kind: "pressure" }] },
  "phys-20": { label: "脊髄損傷",     inflicts: [{ kind: "coma" }] },
  "phys-21": { label: "頭部損傷",     inflicts: [{ kind: "dead" }] },
};

/** 精神ダメージ(段1〜21)。 */
const MENTAL = {
  "ment-1":  { label: "不快" },
  "ment-2":  { label: "畏怖" },
  "ment-3":  { label: "ショック" },
  "ment-4":  { label: "喫驚" },
  "ment-5":  { label: "怒り" },
  "ment-6":  { label: "転倒",       inflicts: [{ kind: "confusion" }] },
  "ment-7":  { label: "戦慄",       inflicts: [{ kind: "weakness" }] },
  "ment-8":  { label: "恐怖",       inflicts: [{ kind: "panic", controlNegate: { ability: ABIL_PASSION } }] },
  "ment-9":  { label: "動転",       notes: "手に持った物を落とす（感情の制御判定で無効）" },
  "ment-10": { label: "恐慌",       inflicts: [{ kind: "swoon", controlNegate: { ability: ABIL_PASSION } }] },
  "ment-11": { label: "自我危機",   inflicts: [{ kind: "stupor", controlNegate: { ability: ABIL_REASON, downgradeTo: "swoon" } }] },
  "ment-12": { label: "驚愕",       notes: "アクションランク -1" },
  "ment-13": { label: "硬直",       inflicts: [{ kind: "panic" }, { kind: "confusion" }] },
  "ment-14": { label: "幻惑",       inflicts: [{ kind: "doped-major" }] },
  "ment-15": { label: "バーサーク", inflicts: [{ kind: "panic", duration: "治療まで" }] },
  "ment-16": { label: "自我崩壊",   inflicts: [{ kind: "mind-break" }] },
  "ment-17": { label: "士気喪失",   notes: "アクションランク 0。可能なら戦闘中止" },
  "ment-18": { label: "パニック",   inflicts: [{ kind: "pressure", ability: ABIL_REASON }] },
  "ment-19": { label: "感情消失",   inflicts: [{ kind: "pressure", ability: ABIL_PASSION }] },
  "ment-20": { label: "覚めない夢", inflicts: [{ kind: "stupor" }] },
  "ment-21": { label: "魂魄消失",   inflicts: [{ kind: "mind-break" }] },
};

/** 社会ダメージ(段1〜21)。 */
const SOCIAL = {
  "soc-1":  { label: "風評" },
  "soc-2":  { label: "怪聞" },
  "soc-3":  { label: "怪文書" },
  "soc-4":  { label: "監視" },
  "soc-5":  { label: "汚名" },
  "soc-6":  { label: "信用失墜",     notes: "次シーン〈信用〉と報酬点 使用不可" },
  "soc-7":  { label: "スキャンダル", notes: "次シーン〈社会〉ひとつ使用不可" },
  "soc-8":  { label: "信頼喪失",     notes: "次シーン〈コネ〉ひとつ使用不可" },
  "soc-9":  { label: "強迫",         notes: "山札1枚の[精神ダメージ]を受ける" },
  "soc-10": { label: "盗聴",         notes: "次シーンの会話は盗聴される" },
  "soc-11": { label: "追放",         inflicts: [{ kind: "erased" }] },
  "soc-12": { label: "フィーバー",   inflicts: [{ kind: "doped-minor" }] },
  "soc-13": { label: "口座凍結",     notes: "治療するまで〈信用〉と報酬点 使用不可" },
  "soc-14": { label: "造反",         notes: "治療するまで〈社会〉ひとつ使用不可" },
  "soc-15": { label: "人脈消失",     notes: "治療するまで〈コネ〉ひとつ使用不可" },
  "soc-16": { label: "襲撃",         inflicts: [{ kind: "pressure", duration: "治療まで" }] },
  "soc-17": { label: "逮捕令状",     notes: "即座に退場。次シーン登場不可" },
  "soc-18": { label: "権力剥奪",     inflicts: [{ kind: "pressure", ability: ABIL_MUNDANE, duration: "治療まで" }] },
  "soc-19": { label: "暗殺",         notes: "山札1枚の[肉体ダメージ]。軽減不可" },
  "soc-20": { label: "ID剥奪",       notes: "治療するまで X ランクに" },
  "soc-21": { label: "guilty-有罪",  inflicts: [{ kind: "erased" }] },
};

/** 系統メタ(group キー・kind プレフィックス・統合用 img)。 */
const CATEGORY_META = {
  physical: { states: PHYSICAL, prefix: "phys", img: "icons/svg/blood.svg" },
  mental:   { states: MENTAL,   prefix: "ment", img: "icons/svg/daze.svg" },
  social:   { states: SOCIAL,   prefix: "soc",  img: "icons/svg/net.svg" },
};

/** 系統キー一覧(肉体→精神→社会の順)。 */
export const DAMAGE_CATEGORIES = ["physical", "mental", "social"];

/**
 * 負傷状態を CONDITION_KINDS 形式(group/type/img 付き)で返す。conditions.mjs が統合する。
 * 段1〜21のみ(段0=ダメージなしは状態を作らない)。順は 肉体→精神→社会、各 1→21。
 * @returns {Object<string, object>}
 */
export function buildDamageStates() {
  const out = {};
  for (const cat of DAMAGE_CATEGORIES) {
    const { states, img } = CATEGORY_META[cat];
    for (const [id, def] of Object.entries(states)) {
      out[id] = { ...def, group: cat, type: "wound", img };
    }
  }
  return out;
}

/**
 * 系統とダメージ値から負傷状態の kind id を返す(段は min(value,21)、段0/負値は null)。
 * @param {"physical"|"mental"|"social"} category
 * @param {number} value 最終ダメージ
 * @returns {?string} 負傷状態の kind id(例 "phys-6")。段0 は null
 */
export function getDamageChartKind(category, value) {
  const meta = CATEGORY_META[category];
  if (!meta) return null;
  const tier = Math.max(0, Math.min(21, Math.trunc(Number(value) || 0)));
  if (tier === 0) return null;
  return `${meta.prefix}-${tier}`;
}
