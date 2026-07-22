/**
 * @fileoverview ダメージチャートの負傷状態(肉体/精神/社会 × 1〜21)定義。
 *
 * §4.1 境界(ユーザー確定 2026-06-23・Damage_Rules.md): 負傷名・チャート値→効果の対応・付与する条件は
 * **同梱**する。同梱しないのは効果文(プロセ)のみ＝設定アプリでユーザー入力(本ファイルに持たない)。
 *
 * 設計(ユーザー確定 2026-06-23): BS・戦闘不能タグ・ダメージ(負傷)を**すべて同列の状態(condition)**
 * として用意し、`inflicts` で「状態の付与＝指定した別状態の自動付与」を表す(汎用カスケード)。
 * 本ファイルは負傷状態(1〜21・0=ダメージなしは状態なし)を定義し、conditions.mjs が
 * CONDITION_KINDS へ統合する(BS→戦闘不能→肉体→精神→社会の順)。
 *
 * 負傷状態の def:
 * - label:   負傷名(同梱)
 * - group:   "physical" | "mental" | "social"(ドロップダウンのグループ)
 * - type:    "wound"(別状態のカスケードは inflicts、負傷自身の直接効果は下記フィールドで表す)
 * - inflicts:[{ kind, ability?, controlNegate?, duration? }] 付与する別状態(BS/戦闘不能)
 *     - controlNegate:{ ability, downgradeTo? } 指定能力値の制御判定成功で無効/降格
 *     - duration: "治療まで" 等(発火は13/15)
 * - controlNegate(状態直下): 付与状態を持たない負傷自身の制御判定(動転=感情)。要求カードは
 *   inflicts 版と同じ機構で自動化し、成功でダメージ消滅(2026-07-09 裁定の一般則)
 * - 旧 notes(UI 表示される説明文)は規約違反のため全廃(2026-07-22 ユーザー)。未自動化の機構効果は
 *   各状態行のコードコメントに残す(自動化したらコメントごと構造化フィールドへ昇格する)
 * - 負傷自身の直接効果(2026-07-16 ユーザー確定・負傷そのものが課す。BS へのカスケードではない):
 *     - skillPenalty:{ skillKey, value } 特定技能の上方判定に -value(眼部損傷=〈知覚〉-5)。技能は識別キーで指定
 *     - skillBlock:{ skillKey } or { category:"society"|"contact" } 特定技能の使用(判定)不可=警告のみ。
 *       固定は skillKey(信用=stature 等)、カテゴリ選択は付与時にユーザーが該当技能を選び targetSkill に確定
 *     - bountyBlock:true 報酬点の使用不可(技能判定時の消費ダイアログをスキップ)
 *     - sceneDeferred:true 「次シーン」発火=付与時は休眠(pendingScene)、発火機構(13/15)が有効化する
 *
 * カード決定型(衰弱・能力値未指定の重圧)は付与時に Conditions.md §8 のドロー機構へ繋ぐ(未実装)。
 */

const ABIL_LIFE = "life", ABIL_PASSION = "passion", ABIL_REASON = "reason", ABIL_MUNDANE = "mundane";

/** 肉体ダメージ(1〜21)。 */
const PHYSICAL = {
  "phys-1":  { label: "内出血" },
  "phys-2":  { label: "額が割れる" },
  "phys-3":  { label: "顔面損傷" },
  "phys-4":  { label: "嗅味覚消失" },
  "phys-5":  { label: "背部裂傷" },
  "phys-6":  { label: "胸部損傷",     inflicts: [{ kind: "weakness" }] },
  // partSlotMod.part は部位キー(フェーズ12・one-hand=片手持ち)。照合はキー優先・旧ラベルも後方互換で引ける
  "phys-7":  { label: "腕部損傷",     partSlotMod: { part: "one-hand", delta: -1 } },
  "phys-8":  { label: "衝撃",         inflicts: [{ kind: "confusion" }] },
  "phys-9":  { label: "朦朧",         inflicts: [{ kind: "doped-minor" }] },
  "phys-10": { label: "腹部損傷",     inflicts: [{ kind: "faint", controlNegate: { ability: ABIL_LIFE } }] },
  "phys-11": { label: "心臓停止",     inflicts: [{ kind: "coma", controlNegate: { ability: ABIL_LIFE, downgradeTo: "faint" } }] },
  "phys-12": { label: "脚部損傷",     inflicts: [{ kind: "confusion", duration: "治療まで" }] },
  "phys-13": { label: "消化器系損傷", inflicts: [{ kind: "weakness" }] },
  "phys-14": { label: "眼部損傷",     skillPenalty: { skillKey: "perception", value: 5 } },
  "phys-15": { label: "動脈切断",     inflicts: [{ kind: "faint" }] },
  "phys-16": { label: "斬首",         inflicts: [{ kind: "dead" }] },
  "phys-17": { label: "腰部損傷",     inflicts: [{ kind: "confusion", duration: "治療まで" }] },
  "phys-18": { label: "脳震盪",       inflicts: [{ kind: "doped-major" }] },
  "phys-19": { label: "五感消失",     inflicts: [{ kind: "pressure" }] },
  "phys-20": { label: "脊髄損傷",     inflicts: [{ kind: "coma" }] },
  "phys-21": { label: "頭部損傷",     inflicts: [{ kind: "dead" }] },
};

/** 精神ダメージ(1〜21)。 */
const MENTAL = {
  "ment-1":  { label: "不快" },
  "ment-2":  { label: "畏怖" },
  "ment-3":  { label: "ショック" },
  "ment-4":  { label: "喫驚" },
  "ment-5":  { label: "怒り" },
  "ment-6":  { label: "転倒",       inflicts: [{ kind: "confusion" }] },
  "ment-7":  { label: "戦慄",       inflicts: [{ kind: "weakness" }] },
  "ment-8":  { label: "恐怖",       inflicts: [{ kind: "panic", controlNegate: { ability: ABIL_PASSION } }] },
  // 動転: 手に持った物を落とす(感情の制御判定で無効)。制御判定要求は自動化(状態自身の
  // controlNegate=成功でダメージ消滅・2026-07-09 裁定の一般則)。失敗時に物を落とす処理は卓運用
  "ment-9":  { label: "動転", controlNegate: { ability: ABIL_PASSION } },
  // 元資料は「恐慌」だが誤り(BS「恐慌」との名称衝突・エラッタ相当)。正=「茫然自失」(2026-07-15 ユーザー確定)
  "ment-10": { label: "茫然自失",   inflicts: [{ kind: "swoon", controlNegate: { ability: ABIL_PASSION } }] },
  "ment-11": { label: "自我危機",   inflicts: [{ kind: "stupor", controlNegate: { ability: ABIL_REASON, downgradeTo: "swoon" } }] },
  // 驚愕: アクションランク -1。未自動化(AR 減算の付与時発火は13以降の接続候補)
  "ment-12": { label: "驚愕" },
  "ment-13": { label: "硬直",       inflicts: [{ kind: "panic" }, { kind: "confusion" }] },
  "ment-14": { label: "幻惑",       inflicts: [{ kind: "doped-major" }] },
  "ment-15": { label: "バーサーク", inflicts: [{ kind: "panic", duration: "治療まで" }] },
  "ment-16": { label: "自我崩壊",   inflicts: [{ kind: "mind-break" }] },
  // 士気喪失: アクションランク 0。可能なら戦闘中止。未自動化(AR 0 化の付与時発火は13以降の接続候補)
  "ment-17": { label: "士気喪失" },
  "ment-18": { label: "パニック",   inflicts: [{ kind: "pressure", ability: ABIL_REASON }] },
  "ment-19": { label: "感情消失",   inflicts: [{ kind: "pressure", ability: ABIL_PASSION }] },
  "ment-20": { label: "覚めない夢", inflicts: [{ kind: "stupor" }] },
  "ment-21": { label: "魂魄消失",   inflicts: [{ kind: "mind-break" }] },
};

/** 社会ダメージ(1〜21)。 */
const SOCIAL = {
  "soc-1":  { label: "風評" },
  "soc-2":  { label: "怪聞" },
  "soc-3":  { label: "怪文書" },
  "soc-4":  { label: "監視" },
  "soc-5":  { label: "汚名" },
  "soc-6":  { label: "信用失墜",     skillBlock: { skillKey: "stature" }, bountyBlock: true, sceneDeferred: true },
  "soc-7":  { label: "スキャンダル", skillBlock: { category: "society" }, sceneDeferred: true },
  "soc-8":  { label: "信頼喪失",     skillBlock: { category: "contact" }, sceneDeferred: true },
  "soc-9":  { label: "強迫",         derivedDamage: { category: "mental", cards: 1 } },
  // 盗聴: 次シーンの会話は盗聴される。物語効果のため自動化対象外(卓運用)
  "soc-10": { label: "盗聴" },
  "soc-11": { label: "追放",         inflicts: [{ kind: "erased" }] },
  "soc-12": { label: "フィーバー",   inflicts: [{ kind: "doped-minor" }] },
  "soc-13": { label: "口座凍結",     skillBlock: { skillKey: "stature" }, bountyBlock: true },
  "soc-14": { label: "造反",         skillBlock: { category: "society" } },
  "soc-15": { label: "人脈消失",     skillBlock: { category: "contact" } },
  "soc-16": { label: "襲撃",         inflicts: [{ kind: "pressure", duration: "治療まで" }] },
  // 逮捕令状: 即座に退場・次シーン登場不可。未自動化(退場/登場はシーン進行=14・登場判定=18)
  "soc-17": { label: "逮捕令状" },
  "soc-18": { label: "権力剥奪",     inflicts: [{ kind: "pressure", ability: ABIL_MUNDANE, duration: "治療まで" }] },
  "soc-19": { label: "暗殺",         derivedDamage: { category: "physical", cards: 1 } },
  // ID剥奪: 治療するまで X ランクに。未自動化(ランクの機構自体が未実装)
  "soc-20": { label: "ID剥奪" },
  "soc-21": { label: "guilty-有罪",  inflicts: [{ kind: "erased" }] },
};

/** 系統メタ(group キー・kind プレフィックス・統合用 img)。 */
const CATEGORY_META = {
  physical: { states: PHYSICAL, prefix: "phys", img: "icons/svg/blood.svg" },
  mental:   { states: MENTAL,   prefix: "ment", img: "icons/svg/sun.svg" },
  social:   { states: SOCIAL,   prefix: "soc",  img: "icons/svg/padlock.svg" },
};

/** 系統キー一覧(肉体→精神→社会の順)。 */
export const DAMAGE_CATEGORIES = ["physical", "mental", "social"];

/**
 * 負傷状態を CONDITION_KINDS 形式(group/type/img 付き)で返す。conditions.mjs が統合する。
 * 1〜21のみ(0=ダメージなしは状態を作らない)。順は 肉体→精神→社会、各 1→21。
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
 * 系統とダメージ値から負傷状態の kind id を返す(チャート参照値は min(value,21)、0/負値は null)。
 * @param {"physical"|"mental"|"social"} category
 * @param {number} value 最終ダメージ
 * @returns {?string} 負傷状態の kind id(例 "phys-6")。0 は null
 */
export function getDamageChartKind(category, value) {
  const meta = CATEGORY_META[category];
  if (!meta) return null;
  const tier = Math.max(0, Math.min(21, Math.trunc(Number(value) || 0)));
  if (tier === 0) return null;
  return `${meta.prefix}-${tier}`;
}

/**
 * 負傷状態の kind id からチャート値(1〜21)を返す(getDamageChartKind の逆引き)。
 * ダメージ適用フローを通らず付与された負傷(トークントグル・手動作成)は woundValue フラグを
 * 持たないため、チャート値の導出元として使う。負傷 kind でない id(BS・戦闘不能・未知)は 0。
 * @param {string} kind 例 "phys-6"
 * @returns {number}
 */
export function getDamageChartValue(kind) {
  const m = /^([a-z]+)-(\d+)$/.exec(String(kind ?? ""));
  if (!m) return 0;
  if (!DAMAGE_CATEGORIES.some(cat => CATEGORY_META[cat].prefix === m[1])) return 0;
  const tier = Number(m[2]);
  return tier >= 1 && tier <= 21 ? tier : 0;
}
