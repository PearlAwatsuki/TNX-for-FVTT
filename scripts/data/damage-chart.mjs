/**
 * @fileoverview ダメージチャート定義(肉体/精神/社会 × 0〜21段)。
 *
 * §4.1 境界(ユーザー確定 2026-06-23・Damage_Rules.md §冒頭): 負傷名・段→効果の対応・付与する
 * 条件(BS/戦闘不能のメカニクス)は**同梱する**。同梱しないのは効果文(プロセ＝創作的記述)のみで、
 * それはユーザー入力(本ファイルには持たない)。実効果(条件の挙動)は conditions.mjs のレジストリ。
 *
 * セル構造:
 * - name:       負傷名(同梱)
 * - conditions: 付与する条件の配列。各 { kind, ability?, controlNegate?, duration? }
 *     - kind:         CONDITION_KINDS のキー
 *     - ability:      重圧など対象能力値が固定指定される場合(reason/passion/life/mundane)
 *     - controlNegate:{ ability, downgradeTo? } 指定能力値の制御判定成功で無効(または downgradeTo へ降格)
 *     - duration:     "治療まで" 等、通常(カット/シーン)と異なる持続(発火は13/15)
 * - notes:      条件で未モデル化の機構的効果(技能使用不可・知覚-5 等。発火は12/13/15)
 *
 * カード決定型(衰弱/能力値未指定の重圧)はチャート付与時に Conditions.md §8 のドロー機構へ繋ぐ(未実装)。
 * 制御判定での無効化(controlNegate)・notes の機構効果・持続/回復の発火は後続フェーズ。
 */

/** 肉体ダメージチャート(0〜21段)。 */
const PHYSICAL = [
  { name: "ダメージなし", conditions: [] },
  { name: "内出血",       conditions: [] },
  { name: "額が割れる",   conditions: [] },
  { name: "顔面損傷",     conditions: [] },
  { name: "嗅味覚消失",   conditions: [] },
  { name: "背部裂傷",     conditions: [] },
  { name: "胸部損傷",     conditions: [{ kind: "weakness" }] },
  { name: "腕部損傷",     conditions: [], notes: "片腕使用不可" },
  { name: "衝撃",         conditions: [{ kind: "confusion" }] },
  { name: "朦朧",         conditions: [{ kind: "doped-minor" }] },
  { name: "腹部損傷",     conditions: [{ kind: "faint", controlNegate: { ability: "life" } }] },
  { name: "心臓停止",     conditions: [{ kind: "coma", controlNegate: { ability: "life", downgradeTo: "faint" } }] },
  { name: "脚部損傷",     conditions: [{ kind: "confusion", duration: "治療まで" }] },
  { name: "消化器系損傷", conditions: [{ kind: "weakness" }] },
  { name: "眼部損傷",     conditions: [], notes: "治療されるまで〈知覚〉判定 -5" },
  { name: "動脈切断",     conditions: [{ kind: "faint" }] },
  { name: "斬首",         conditions: [{ kind: "dead" }] },
  { name: "腰部損傷",     conditions: [{ kind: "confusion", duration: "治療まで" }] },
  { name: "脳震盪",       conditions: [{ kind: "doped-major" }] },
  { name: "五感消失",     conditions: [{ kind: "pressure" }] },
  { name: "脊髄損傷",     conditions: [{ kind: "coma" }] },
  { name: "頭部損傷",     conditions: [{ kind: "dead" }] },
];

/** 精神ダメージチャート(0〜21段)。 */
const MENTAL = [
  { name: "ダメージなし", conditions: [] },
  { name: "不快",         conditions: [] },
  { name: "畏怖",         conditions: [] },
  { name: "ショック",     conditions: [] },
  { name: "喫驚",         conditions: [] },
  { name: "怒り",         conditions: [] },
  { name: "転倒",         conditions: [{ kind: "confusion" }] },
  { name: "戦慄",         conditions: [{ kind: "weakness" }] },
  { name: "恐怖",         conditions: [{ kind: "panic", controlNegate: { ability: "passion" } }] },
  { name: "動転",         conditions: [], notes: "手に持った物を落とす（感情の制御判定で無効）" },
  { name: "恐慌",         conditions: [{ kind: "swoon", controlNegate: { ability: "passion" } }] },
  { name: "自我危機",     conditions: [{ kind: "stupor", controlNegate: { ability: "reason", downgradeTo: "swoon" } }] },
  { name: "驚愕",         conditions: [], notes: "アクションランク -1" },
  { name: "硬直",         conditions: [{ kind: "panic" }, { kind: "confusion" }] },
  { name: "幻惑",         conditions: [{ kind: "doped-major" }] },
  { name: "バーサーク",   conditions: [{ kind: "panic", duration: "治療まで" }] },
  { name: "自我崩壊",     conditions: [{ kind: "mind-break" }] },
  { name: "士気喪失",     conditions: [], notes: "アクションランク 0。可能なら戦闘中止" },
  { name: "パニック",     conditions: [{ kind: "pressure", ability: "reason" }] },
  { name: "感情消失",     conditions: [{ kind: "pressure", ability: "passion" }] },
  { name: "覚めない夢",   conditions: [{ kind: "stupor" }] },
  { name: "魂魄消失",     conditions: [{ kind: "mind-break" }] },
];

/** 社会ダメージチャート(0〜21段)。社会は攻撃力なし・舞台裏判定。 */
const SOCIAL = [
  { name: "ダメージなし",   conditions: [] },
  { name: "風評",           conditions: [] },
  { name: "怪聞",           conditions: [] },
  { name: "怪文書",         conditions: [] },
  { name: "監視",           conditions: [] },
  { name: "汚名",           conditions: [] },
  { name: "信用失墜",       conditions: [], notes: "次シーン〈信用〉と報酬点 使用不可" },
  { name: "スキャンダル",   conditions: [], notes: "次シーン〈社会〉ひとつ使用不可" },
  { name: "信頼喪失",       conditions: [], notes: "次シーン〈コネ〉ひとつ使用不可" },
  { name: "強迫",           conditions: [], notes: "山札1枚の[精神ダメージ]を受ける" },
  { name: "盗聴",           conditions: [], notes: "次シーンの会話は盗聴される" },
  { name: "追放",           conditions: [{ kind: "erased" }] },
  { name: "フィーバー",     conditions: [{ kind: "doped-minor" }] },
  { name: "口座凍結",       conditions: [], notes: "治療するまで〈信用〉と報酬点 使用不可" },
  { name: "造反",           conditions: [], notes: "治療するまで〈社会〉ひとつ使用不可" },
  { name: "人脈消失",       conditions: [], notes: "治療するまで〈コネ〉ひとつ使用不可" },
  { name: "襲撃",           conditions: [{ kind: "pressure", duration: "治療まで" }] },
  { name: "逮捕令状",       conditions: [], notes: "即座に退場。次シーン登場不可" },
  { name: "権力剥奪",       conditions: [{ kind: "pressure", ability: "mundane", duration: "治療まで" }] },
  { name: "暗殺",           conditions: [], notes: "山札1枚の[肉体ダメージ]。軽減不可" },
  { name: "ID剥奪",         conditions: [], notes: "治療するまで X ランクに" },
  { name: "guilty-有罪",    conditions: [{ kind: "erased" }] },
];

/** ダメージチャート(系統別)。index = 参照段(0〜21)。 */
export const DAMAGE_CHART = Object.freeze({
  physical: PHYSICAL,
  mental:   MENTAL,
  social:   SOCIAL,
});

/** 系統キー一覧。 */
export const DAMAGE_CATEGORIES = ["physical", "mental", "social"];

/**
 * 系統とダメージ値からチャートのセル(0〜21段にクランプ)を返す。
 * @param {"physical"|"mental"|"social"} category
 * @param {number} value 最終ダメージ(チャート参照段は min(value,21))
 * @returns {{name:string, conditions:Array, notes?:string}|null}
 */
export function getDamageChartResult(category, value) {
  const chart = DAMAGE_CHART[category];
  if (!chart) return null;
  const tier = Math.max(0, Math.min(21, Math.trunc(Number(value) || 0)));
  return chart[tier] ?? null;
}
