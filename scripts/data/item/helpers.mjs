/**
 * @fileoverview Item DataModel 用の共通フィールドヘルパー
 *
 * 複数の Item type で同一構造を持つフィールドを関数として切り出す。
 * scripts/data/helpers.mjs が Actor 側共通ヘルパーであるのに対し、
 * こちらは Item 専用。
 *
 * B-2 の outfit-base.mjs で示された方針(「再利用が必要になった時点で切り出す」)に
 * 従い、B-5b で defence フィールドが armor / cyborg の 2 箇所で必要になったため
 * 切り出した。
 *
 * B-6a で attack フィールドが cyborg / weapon の 2 箇所で必要になったため
 * attackField() として切り出した。
 *
 * modeValueField は outfit-base.mjs での局所定義から昇格し、
 * 各 DataModel で広く使われるようになったため helpers.mjs に集約した。
 */

import { OUTFIT_TYPES } from "./outfit-categories.mjs";

/**
 * 旧 uses.value（残り回数）→ uses.spent（消費済み回数）へのデータ移行。
 * spent = max - value（[0, max] にクランプ）。style-skill と outfit-base の uses で共用。
 * source を破壊的に書き換える（migrateData の慣例）。
 * @param {object} source DataModel の生ソース
 */
export function migrateUsesValueToSpent(source) {
    const uses = source?.uses;
    if (uses && typeof uses.value === "number" && uses.spent === undefined) {
        const max = typeof uses.max === "number" ? uses.max : 0;
        uses.spent = Math.max(0, Math.min(max, max - uses.value));
        delete uses.value;
    }
}

/**
 * 「なし / 数値」の 2 状態を持つフィールド。buy / hide / hack などと同形。
 *
 * effectMod は ActiveEffect の着地点(フェーズ9-3)。改造・スタイル技能等が ADD で積む。
 * mode === "value" のときのみ意味を持ち、実効値 = value + effectMod は消費側で算出する
 * (mode が reference / control / none のときは effectMod は無効)。手動編集 UI は持たない。
 *
 * @param {string[]} choices mode の選択肢(例: ["none", "value"])
 * @returns {foundry.data.fields.SchemaField}
 */
export function modeValueField(choices) {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    mode:  new fields.StringField({ required: true, blank: false, initial: "none", choices }),
    value: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 防御値(ストリート / フィジカル / インフォウォー)の SchemaField を返す。
 * mode: "none" | "value" を持ち、"value" のときのみ S/P/I を使う。
 *
 * 使用 Item type: armor / cyborg / vehicle
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function defenceField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    mode:      new fields.StringField({ required: true, blank: false, initial: "none", choices: ["none", "value"] }),
    S_defence: new fields.NumberField({ initial: 0 }),
    P_defence: new fields.NumberField({ initial: 0 }),
    I_defence: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 攻撃のダメージ種別(2026-06-12 ユーザー確定)。
 * S: 斬撃 / P: 貫通 / I: 衝撃 / X: 装甲無視(エクストラ)。
 * 表記は「攻：I+4」のように 種別 + 攻撃値。
 * @type {Readonly<Record<string, string>>}
 */
export const ATTACK_DAMAGE_TYPES = Object.freeze({
  S: "斬撃",
  P: "貫通",
  I: "衝撃",
  X: "装甲無視",
});

/**
 * 攻撃力(ダメージ種別 / 値 / AE 着地修正)の SchemaField を返す。
 * damageType は S/P/I/X の choices 付き単一選択(2026-06-13 ユーザー指示で
 * ドロップダウン選択に変更。空文字は未設定)。value は基本攻撃力。
 *
 * effectMod は ActiveEffect の着地点(フェーズ9-3。旧 mod をリネーム)。手動編集 UI は持たず、
 * AE(改造・スタイル技能等)が ADD で積む。実効攻撃力 = value + effectMod は消費側
 * (ダメージ算出フェーズ12)で算出する。
 *
 * 使用 Item type: weapon / cyborg / vehicle
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function attackField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    damageType: new fields.StringField({
      required: true,
      blank: true,
      initial: "",
      choices: ATTACK_DAMAGE_TYPES,
    }),
    value:     new fields.NumberField({ initial: 0 }),
  });
}

/**
 * アイテムの実効値(`.total` 系)を base から派生する(フェーズ9-3 v2)。
 * **base 値は書き換えず** total=base を別キーに置く。バフはアクターの適用パスが total へ直接効かせる。
 * これにより編集 UI は base を、表示・消費側は total を読める(入力に total が漏れない)。
 *
 * - modeValueField({mode,value}) / attackField({damageType,value}): `field.total = value`。
 * - defence(S/P/I): `defence.{S,P,I}_total = X_defence`。
 * - slots[].count: 各 `count.total = value`。
 * - 素の値(FAValue / residence の各 stat): `<base>Total = base`。
 * clamp はしない(0clamp は能力値側＝消費側の責務)。
 *
 * @param {object} system アイテムの system データ(prepareDerivedData の this)
 */
export function computeItemEffectiveValues(system) {
  // {mode|damageType, value} 形(modeValueField / attackField)を形状で検出して total=value
  for (const field of Object.values(system)) {
    if (field && typeof field === "object" && typeof field.value === "number"
        && ("mode" in field || "damageType" in field)) {
      field.total = field.value;
      // ダメージ種別の実効値(2026-07-13): 上書き AE の着地先。設定欄(素値 damageType)は不変
      if ("damageType" in field) field.damageTypeTotal = field.damageType ?? "";
    }
  }
  // defence(S/P/I)
  const def = system.defence;
  if (def && typeof def === "object" && typeof def.S_defence === "number") {
    for (const k of ["S", "P", "I"]) def[`${k}_total`] = def[`${k}_defence`] ?? 0;
  }
  // slots[].count
  if (Array.isArray(system.slots)) {
    for (const slot of system.slots) {
      const c = slot?.count;
      if (c && typeof c.value === "number") c.total = c.value;
    }
  }
  // 素の値(base フィールド名で検出)
  for (const base of ["FAValue", "appearanceTarget", "cyberSecurity", "analogSecurity"]) {
    if (typeof system[base] === "number") system[`${base}Total`] = system[base];
  }
  // 特性フラグの実効値(フェーズ12。AE のオン/オフ上書きはここへ着地する)
  computeFlagEffectiveValues(system);
}

/**
 * AE 変更キーの条件式(角括弧内)を解析する。`path op value` を `;` 区切り(フェーズ9 v2)。
 * 例 "hack>=3;guardValue>0" → [{path:"hack", op:">=", value:3}, {path:"guardValue", op:">", value:0}]
 * @param {string} str
 * @returns {Array<{path:string, op:string, value:number}>}
 */
export function parseEffectConditions(str) {
  if (!str) return [];
  const out = [];
  for (const raw of str.split(";")) {
    const c = raw.trim();
    if (!c) continue;
    const m = c.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
    if (!m) continue;
    out.push({ path: m[1].trim(), op: m[2], value: Number(m[3].trim()) });
  }
  return out;
}

/**
 * AE 変更キーを解析する(フェーズ9 v2・確定設計)。標準 UI のキー文字列で対象を表す。
 * 文法: `<セレクタ>[<条件>].<パス>`(条件は省略可)。
 *
 * セレクタ → scope:
 * - "system"            → { scope:"system" }（キャラ＝そのドキュメント自身）
 * - "self"              → { scope:"self" }（効果が乗るアイテム自身）
 * - "parent"            → { scope:"parent" }（その親アウトフィット）
 * - "cat:<小分類キー>"   → { scope:"cat", selector:小分類キー }
 * - "<プレフィックス>*"   → { scope:"prefix", selector:プレフィックス }（識別キー前方一致）
 * - "<識別キー>"         → { scope:"key", selector:識別キー }（完全一致）
 *
 * @param {string} key ActiveEffect change のキー
 * @returns {{scope:string, selector?:string, path:string, conditions:Array}|null}
 */
const ABILITY_NAMES = ["reason", "passion", "life", "mundane"];

/**
 * AE で切り替えられる特性フラグの opt-in レジストリ(フェーズ12・ユーザー確定)。
 * 「特性(アイテムの性質でルール挙動・照合に効く)」のみを載せる——状態(isPrepared/isCarrying 等の
 * ユーザー操作)・構造(isOption/isDerivedData 等のデータ管理)・変更不可マーカー(isFixedRange 等)は
 * 対象外。登録=着地(`<フラグ>Total`)の派生と読み手の実効読み化が済んでいる印。
 * 追加時は読み手を grep で全数掃引してから登録すること(着地だけ作って効かない状態を残さない)。
 * @type {ReadonlyArray<string>}
 */
export const AE_FLAG_PARAMS = Object.freeze([
  // 武器
  "isFullAuto", "isLaser", "isFleshChange",
  // アウトフィット共通
  "isCyber", "isMutantOrgan", "isShiki", "noPrepareRequired", "isConsumption",
  // 技能(共通)
  "usesBounty",
  "suits.spade", "suits.heart", "suits.diamond", "suits.club",
  // ※ isAction / noCombo は「特性」だが**構造的読み手**(用途チェーン設定・辞典構築)が
  //   フラグを読んで**永続設定を書き込む**ため、実行時 AE 上書きと両立させるには
  //   チェーン再解決の設計が要る(config 書き手は base を読み、実行時解決は実効を読む必要がある)。
  //   実効読みへの一括掃引が構造的に安全でないため、今回のレジストリからは外す(将来別設計で扱う)。
]);

/** フラグの素パス → 実効パス(`suits.spade`→`suits.spadeTotal`・`isFullAuto`→`isFullAutoTotal`)。 */
export function flagTotalPath(path) {
  const segs = String(path).split(".");
  segs.push(`${segs.pop()}Total`);
  return segs.join(".");
}

/** ドット区切りパスで system から値を引く(Foundry 非依存・テストでも動く)。 */
function getFlagPath(obj, path) {
  return String(path).split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

/**
 * 特性フラグの**実効値**を読む(フェーズ12)。AE のオン/オフ上書きが着地した `<フラグ>Total` が
 * あればそれ、無ければ base。AE 未適用(直下・辞典アイテム)でも base を安全に読める。
 * ルール挙動・照合が真偽フラグを読む箇所は**必ず本関数を経由**する(base 直読みは AE が効かない)。
 * @param {object} system アイテムの system
 * @param {string} path フラグの素パス("isFullAuto" / "suits.spade" 等)
 * @returns {boolean}
 */
export function readFlag(system, path) {
  const t = getFlagPath(system, flagTotalPath(path));
  if (typeof t === "boolean") return t;
  return getFlagPath(system, path) === true;
}

/** 実効綴りの集合(resolveItemTotalPath の正規化と、適用パスの boolean 判別に使う)。 */
export const AE_FLAG_TOTAL_PATHS = Object.freeze(new Set(AE_FLAG_PARAMS.map(flagTotalPath)));

/**
 * 特性フラグの実効値(`<フラグ>Total`)を base から派生する(フェーズ12)。
 * computeItemEffectiveValues(アウトフィット)と SkillBaseTemplate(技能)の両方から呼ぶ。
 * base のフラグは書き換えず、AE はアクターの適用パスで実効側を上書きする。
 * @param {object} system アイテムの system データ
 */
export function computeFlagEffectiveValues(system) {
  for (const path of AE_FLAG_PARAMS) {
    const segs = path.split(".");
    let obj = system;
    for (let i = 0; i < segs.length - 1; i++) {
      obj = obj?.[segs[i]];
      if (!obj) break;
    }
    const last = segs[segs.length - 1];
    if (obj && typeof obj[last] === "boolean") obj[`${last}Total`] = obj[last];
  }
}

/**
 * 真偽フラグ AE の値を解釈する(フェーズ12)。オン/オフの選択式注入が書く "true"/"false" のほか、
 * 手打ちの 1/0・on/off 等も受ける。解釈不能は null(=その変更を無視)。
 * @param {*} raw change.value
 * @returns {boolean|null}
 */
export function parseBooleanFlagValue(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (["1", "true", "on", "yes", "オン"].includes(v)) return true;
  if (["0", "false", "off", "no", "オフ"].includes(v)) return false;
  return null;
}

/**
 * 判定バフの変更キーが、判定の条件(criteria)に合致するか(フェーズ9-3 v2)。
 * @param {string} key  change.key
 * @param {{type:"skill"|"ability"|"control", skills?:{key:string,style?:string,organization?:string}[], skillKeys?:string[], ability?:string}} criteria
 * @returns {boolean}
 */
export function checkChangeMatches(key, criteria) {
  const p = parseEffectTargetKey(key);
  if (!p || !criteria) return false;
  // 判定全般(check.all・2026-07-13): 無印「判定」=能力値判定+技能判定に合致(制御判定は対象外)
  if (p.scope === "anyCheck") return criteria.type === "skill" || criteria.type === "ability";
  if (criteria.type === "ability") return p.scope === "abilityCheck" && p.ability === criteria.ability;
  if (criteria.type === "control") return p.scope === "controlCheck" && p.ability === criteria.ability;
  if (criteria.type === "skill") {
    if (p.scope !== "skillCheck") return false;
    // criteria.skills（{key,style,organization}）優先。旧 skillKeys は key のみとして後方互換受理。
    const skills = criteria.skills ?? (criteria.skillKeys ?? []).map(k => ({ key: k }));
    if (p.group === "style") return skills.some(s => s.style === p.selector);
    if (p.group === "works") return skills.some(s => s.organization === p.selector);
    return skills.some(s =>
      p.prefix ? !!s.key?.startsWith?.(p.selector) : s.key === p.selector);
  }
  return false;
}

/**
 * 判定バフの寄与エフェクト一覧(重複排除済み)を返す(フェーズ9-3 v2)。
 * **同一効果の重複適用不可**: 各効果(identity)につき最大1回。同一効果内で複数の変更が合致しても
 * 最も有利な値を1回。別効果はスタック。`stackable` の効果は重複排除せず常に列挙。
 * チャットの内訳表示(エフェクト名＋値)に用いる。
 *
 * @param {Array<{identity:string, name?:string, stackable?:boolean, active?:boolean, changes?:Array<{key:string,value:any}>}>} effects
 * @param {{type:"skill"|"ability"|"control", skillKeys?:string[], ability?:string}} criteria
 * @returns {Array<{name:string, value:number}>}
 */
/**
 * 効果一覧を「変更キーの述語 predicate」で集計し、重複排除して寄与一覧を返す共通処理。
 * 判定バフ・ダメージ対象バフで共用(同一効果=identity 単位で最大1回・別効果はスタック・
 * stackable は常に列挙)。
 * @param {Array<object>} effects
 * @param {(key:string)=>boolean} predicate
 * @returns {Array<{name:string, value:number}>}
 */
function _gatherBonusSources(effects, predicate, { pick = "max" } = {}) {
  // 禁止されるのは「同名効果の二重適用」(2026-07-17 ユーザー裁定で是正)——
  // 1つの効果が持つ該当行は**すべてその効果の内容として合算**する(行の畳み込みはしない。
  // 旧実装の「効果内で最有利1行」は Code の過大一般化で誤り)。同一 identity(同名効果)の
  // インスタンスが複数あるときだけ「最も効果の大きい」1つを採る——pick はその方向
  // (攻撃側バフ=max・受け手側の damage.taken 系=min=最も負)。stackable(重複可)は例外で、
  // 「この効果は重複する」と明記された重ねがけ型＝付与された分だけ累積する。
  const byIdentity = new Map();
  const stackables = [];
  const better = (a, b) => (pick === "min" ? a < b : a > b);
  for (const eff of (effects ?? [])) {
    if (eff.active === false) continue;
    let total = null;
    for (const change of (eff.changes ?? [])) {
      if (!predicate(change.key)) continue;
      total = (total ?? 0) + (Number(change.value) || 0);
    }
    if (total === null) continue;
    const entry = { name: eff.name || "(無名効果)", value: total };
    if (eff.stackable) {
      stackables.push(entry);
    } else {
      const prev = byIdentity.get(eff.identity);
      if (!prev || better(total, prev.value)) byIdentity.set(eff.identity, entry);
    }
  }
  return [...byIdentity.values(), ...stackables];
}

export function gatherCheckBonusSources(effects, criteria) {
  return _gatherBonusSources(effects, (key) => checkChangeMatches(key, criteria));
}

/**
 * 判定バフの合計ボーナスを算出する(フェーズ9-3 v2)。{@link gatherCheckBonusSources} の値の総和。
 *
 * @param {Array<object>} effects
 * @param {{type:"skill"|"ability"|"control", skillKeys?:string[], ability?:string}} criteria
 * @returns {number}
 */
export function computeCheckBonus(effects, criteria) {
  return gatherCheckBonusSources(effects, criteria).reduce((sum, e) => sum + e.value, 0);
}

/**
 * ダメージ対象バフ(`damage.vsStyle.*` / `damage.vsWorks.*`)の変更キーが、
 * 攻撃対象のスタイル/ワークスに合致するか(2026-07-10)。値バフでなくダメージ算出時に評価する。
 * @param {string} key  change.key
 * @param {{styles?:string[], works?:string[]}} criteria  攻撃対象が持つスタイル識別キー/組織識別キー
 * @returns {boolean}
 */
export function damageVsChangeMatches(key, criteria) {
  const p = parseEffectTargetKey(key);
  if (!p || p.scope !== "damageVs" || !criteria) return false;
  if (p.group === "style") return (criteria.styles ?? []).includes(p.selector);
  if (p.group === "works") return (criteria.works ?? []).includes(p.selector);
  return false;
}

/**
 * ダメージ対象バフの寄与一覧(重複排除済み)。攻撃対象のスタイル/ワークスで照合する。
 * チャット台帳の内訳表示(効果名＋値)に用いる。判定バフと同じ重複規約。
 * @param {Array<object>} effects  攻撃者の effects(正規形・{@link collectActorEffectBuffs})
 * @param {{styles?:string[], works?:string[]}} criteria  攻撃対象の持つスタイル/組織
 * @returns {Array<{name:string, value:number}>}
 */
export function gatherDamageVsSources(effects, criteria) {
  return _gatherBonusSources(effects, (key) => damageVsChangeMatches(key, criteria));
}

/**
 * 与えるダメージバフ(`damage.dealt[.<系統>]`)の変更キーが、攻撃の系統に合致するか(2026-07-11)。
 * 系統なしの `damage.dealt` は全系統に合致する。
 * @param {string} key  change.key
 * @param {"physical"|"mental"|"social"} category  攻撃の系統
 * @returns {boolean}
 */
export function damageDealtChangeMatches(key, category) {
  const p = parseEffectTargetKey(key);
  if (!p || p.scope !== "damageDealt") return false;
  return p.category === null || p.category === category;
}

/**
 * 与えるダメージバフの寄与一覧(重複排除済み)。ダメージ算出時に攻撃者の effects から集計する。
 * チャット台帳の内訳表示(効果名＋値)に用いる。判定バフと同じ重複規約。
 * @param {Array<object>} effects  攻撃者の effects(正規形・{@link collectActorEffectBuffs})
 * @param {"physical"|"mental"|"social"} category  攻撃の系統
 * @returns {Array<{name:string, value:number}>}
 */
export function gatherDamageDealtSources(effects, category) {
  return _gatherBonusSources(effects, (key) => damageDealtChangeMatches(key, category));
}

/**
 * 受けるダメージ軽減 AE(`damage.taken[.<系統|種別>]`・`damage.fromStyle/fromWorks.*`・2026-07-17)の
 * 変更キーが、この攻撃(系統・ダメージ種別・攻撃者のスタイル/ワークス)に合致するか。
 * 値=受けるダメージへの加算(負=軽減)。恒久軽減としてダメージ算出時(10上限の前)に効く。
 * @param {string} key  change.key
 * @param {{category:string, damageType?:string, attackerStyles?:string[], attackerWorks?:string[]}} criteria
 * @returns {boolean}
 */
export function damageTakenChangeMatches(key, criteria) {
  const p = parseEffectTargetKey(key);
  if (!p || !criteria) return false;
  if (p.scope === "damageTaken") {
    if (p.category !== null && p.category !== criteria.category) return false;
    if (p.damageType !== null && p.damageType !== (criteria.damageType || "")) return false;
    return true;
  }
  if (p.scope === "damageFrom") {
    if (p.group === "style") return (criteria.attackerStyles ?? []).includes(p.selector);
    if (p.group === "works") return (criteria.attackerWorks ?? []).includes(p.selector);
  }
  return false;
}

/**
 * 受けるダメージ軽減の寄与一覧。ダメージ算出時に**受け手(対象)の effects** から集計する。
 * taken と from* を1回の走査で照合するため、同一効果に両キーが併記されていても**効果の内容として
 * 合算した1行**になる(同名効果のインスタンスが複数あるときの「最も効果の大きい」採用も
 * インスタンスの合算値どうしで比較できる)。採用方向は受け手基準=**最小値**(最も負=最も軽減)。
 * @param {Array<object>} effects  受け手の effects(正規形・{@link collectActorEffectBuffs})
 * @param {{category:string, damageType?:string, attackerStyles?:string[], attackerWorks?:string[]}} criteria
 * @returns {Array<{name:string, value:number}>}
 */
export function gatherDamageTakenSources(effects, criteria) {
  return _gatherBonusSources(effects, (key) => damageTakenChangeMatches(key, criteria), { pick: "min" });
}

/**
 * アクター自身＋全所有アイテムの effects を、バフ集計用の正規形にして返す。
 * 判定バフ(判定時)・ダメージ対象バフ(ダメージ時)で共用する。
 * @param {Actor} actor
 * @param {string} scope  フラグスコープ(パッケージID)
 * @returns {Array<{identity:string, name:string, stackable:boolean, active:boolean, changes:Array}>}
 */
/**
 * アクター(攻撃対象)が持つスタイル/ワークスの識別キー一覧を返す。ダメージ対象バフの照合
 * (`damage.vs*`)と、ダメージ式の `@target.style.*` / `@target.works.*` で共用する。
 * スタイル＝`type:"style"` アイテムの識別キー。ワークス＝ワークス技能(styleSkill)の組織。
 * @param {Actor} target
 * @returns {{styles:string[], works:string[]}}
 */
export function targetStyleWorksKeys(target) {
  const items = target?.items?.contents ?? target?.items ?? [];
  const styles = [...new Set([...items]
    .filter(i => i.type === "style")
    .map(i => i.system?.identificationKey).filter(Boolean))];
  const works = [...new Set([...items]
    .filter(i => i.type === "styleSkill")
    .map(i => i.system?.special?.works?.organization)
    .filter(o => o && o !== "-"))];
  return { styles, works };
}

/**
 * ダメージタグ改変 AE(damage.replaceTag/addTag・2026-07-12)を対象アクターから収集する。
 * 値=CONDITION_KINDS のタグキー(文字列・妥当性は適用側 applyDamageTagMods が検証)。
 * replace は同一元タグにつき先勝ち1つ・add は重複排除で蓄積する。
 * @param {Actor} actor ダメージを受ける側
 * @returns {{replace: Map<string,string>, add: Map<string,string[]>}}
 */
export function gatherDamageTagMods(actor) {
  const replace = new Map();
  const add = new Map();
  for (const e of collectActorEffectBuffs(actor)) {
    if (!e.active) continue;
    for (const c of (e.changes ?? [])) {
      const p = parseEffectTargetKey(c.key);
      if (p?.scope !== "damageTag") continue;
      const to = String(c.value ?? "").trim();
      if (!to) continue;
      if (p.mode === "replace") {
        if (!replace.has(p.tag)) replace.set(p.tag, to);
      } else {
        const arr = add.get(p.tag) ?? [];
        if (!arr.includes(to)) { arr.push(to); add.set(p.tag, arr); }
      }
    }
  }
  return { replace, add };
}

/** 疑似分類(2026-07-13 再設計): 分類キーの名前空間で技能をアイテムタイプごと束ねる予約語。 */
const PSEUDO_CATEGORY_TYPES = Object.freeze(["generalSkill", "styleSkill"]);

/**
 * アイテム狙いの変更(スコープ skill/category)がこのアイテムに向くか(純関数)。
 * 準備先(旧 parent スコープ)はキーでなく AE 設定「準備先(親アイテム)に適用」で表すため、ここでは扱わない。
 * @param {object} parsed parseEffectTargetKey の結果
 * @param {Item} item 対象候補
 * @returns {boolean}
 */
export function itemChangeTargets(parsed, item) {
  if (!parsed?.path) return false;
  if (parsed.scope === "skill") {
    return parsed.prefix
      ? !!item.system?.identificationKey?.startsWith?.(parsed.selector)
      : item.system?.identificationKey === parsed.selector;
  }
  if (parsed.scope === "category") {
    // 疑似分類: 一般技能/スタイル技能はアウトフィット分類を持たないためアイテムタイプで照合する
    if (PSEUDO_CATEGORY_TYPES.includes(parsed.selector)) return item.type === parsed.selector;
    return item.system?.minorCategory === parsed.selector || item.system?.majorCategory === parsed.selector;
  }
  return false;
}

/**
 * 自動適用 AE の**物理転送**(2026-07-13 再設計)のコピーデータを組み立てる:
 * - アイテム狙いの変更(識別キー item.<キー>/分類 system.category.<キー>)のうち対象アイテムに
 *   向くものを、**素のパラメータキー(system.<パス>)に書き換えた実体コピー**として対象上に作る。
 * - 「準備先(親アイテム)に適用」フラグ付きの効果は、素のパラメータキーの変更を準備先ホスト
 *   (bearer.system.parentItemId === targetItem.id)へそのまま転送する(混在非対応=素のキーのみ有効)。
 * コピーは対象アイテムの通常の効果=**無条件でそのアイテムに効く**(遠隔の再照合なし)。
 * 同期は**供給元が正の片方向**(2026-07-12): 供給元の更新でコピーは本データで上書きされ、
 * 供給元の削除・狙い外れでコピーは除去される(tnx.mjs のフック群)。由来は transferredFrom フラグと origin。
 * 重複排除の同一性(effectId)と重複可(stackable)は供給元から引き継ぐ。
 * @param {ActiveEffect} effect 供給元の効果
 * @param {Item} targetItem 転送先アイテム
 * @param {Document} bearer 効果の保持元
 * @returns {?object} createEmbeddedDocuments("ActiveEffect") 用データ。向く変更が無ければ null
 */
export function buildTransferredEffectData(effect, targetItem, bearer, scope = "tokyo-nova-axleration") {
  const srcFlags = effect.flags?.[scope] ?? {};
  const toParent = srcFlags.applyToParent === true;
  if (toParent && (bearer?.documentName !== "Item" || bearer.system?.parentItemId !== targetItem.id)) return null;
  const changes = [];
  for (const c of (effect.changes ?? [])) {
    const parsed = parseEffectTargetKey(c.key);
    if (!parsed) continue;
    if (toParent) {
      // 準備先転送は素のキーのみ(混在非対応)。partAdd(system.part.<キー>)と name も素のキー形
      if (!["self", "partAdd", "itemName"].includes(parsed.scope)) continue;
    } else if (!itemChangeTargets(parsed, targetItem)) continue;
    // 名前装飾はドキュメント直下の `name` へ(フェーズ12)。それ以外は素の system.<パス>
    changes.push({ ...c, key: (parsed.scope === "itemName" || parsed.path === "name") ? "name" : `system.${parsed.path}` });
  }
  if (!changes.length) return null;
  return {
    name: effect.name,
    img: effect.img,
    disabled: effect.disabled === true,
    transfer: false,
    origin: effect.uuid,
    changes,
    flags: { [scope]: {
      transferredFrom: effect.uuid,
      // 表示用の供給元名(「転送された効果」セクションで名前に添える)。供給元の効果更新時に取り直される
      transferredSourceName: bearer?.name ?? "",
      ...(srcFlags.stackable === true ? { stackable: true } : {}),
      ...(srcFlags.effectId ? { effectId: srcFlags.effectId } : {}),
    } },
  };
}

/** カード数字の上書き値(A〜K)→N◎VA 以前の生の数字(A=1・J=11・Q=12・K=13)。 */
const CARD_LETTER_TO_NUMERIC = Object.freeze({ A: 1, J: 11, Q: 12, K: 13 });

/**
 * カード数字の上書き AE(`check.cardValue`・2026-07-13)を解決する。
 * 値は A〜K(選択式)。以降の数字規約(手札の絵札=10・A の21固定選択・山札の絵札=FUMBLE)は
 * 上書き後の数字に従う。複数あれば最初の有効値(先勝ち)。
 * @param {Actor} actor
 * @returns {?number} 生のカード数字(1〜13)。無し/不正は null
 */
export function actorCardValueOverride(actor) {
  for (const e of collectActorEffectBuffs(actor)) {
    if (!e.active) continue;
    for (const c of (e.changes ?? [])) {
      if (parseEffectTargetKey(c.key)?.scope !== "cardValue") continue;
      const raw = String(c.value ?? "").trim().toUpperCase();
      const n = CARD_LETTER_TO_NUMERIC[raw] ?? (/^([2-9]|10)$/.test(raw) ? Number(raw) : null);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * スート変更 AE(`check.suitChange`・2026-07-12)を持つか。
 * 失効は当面手動(「1回の判定」Duration の自動失効は時間管理フェーズで持続時間側に足す。
 * 持続時間と AE キーは独立=キーは今から付与できる)。
 * @param {Actor} actor
 * @returns {boolean}
 */
export function actorHasSuitChangeBuff(actor) {
  for (const e of collectActorEffectBuffs(actor)) {
    if (!e.active) continue;
    for (const c of (e.changes ?? [])) {
      if (parseEffectTargetKey(c.key)?.scope === "suitChange") return true;
    }
  }
  return false;
}

/**
 * 自動適用ゲート(2026-07-13 再設計・ユーザー確定): ネイティブ transfer チェック=
 * 「効果を対象に自動適用」。オフのアイテム上の効果は**使用時付与用ペイロード**であり、
 * 値バフ・実行時系統(判定/ダメージ)・物理転送のいずれにも自動では乗らない。
 * アクター上の効果と、実体化済みインスタンス(転送コピー transferredFrom / 付与コピー grantedFrom)
 * は常に生きる(無効化手段は disabled のみ)。
 * @param {ActiveEffect} effect
 * @returns {boolean} 自動適用の収集対象なら true
 */
export function effectAutoApplies(effect, scope = "tokyo-nova-axleration") {
  if (effect?.parent?.documentName !== "Item") return true;
  const f = effect.flags?.[scope] ?? {};
  if (f.transferredFrom !== undefined || f.grantedFrom !== undefined) return true;
  return effect.transfer !== false;
}

export function collectActorEffectBuffs(actor, scope = "tokyo-nova-axleration") {
  const out = [];
  const push = (e) => out.push({
    identity:  e.flags?.[scope]?.effectId || e.id,
    name:      e.name,
    stackable: e.flags?.[scope]?.stackable === true,
    active:    e.active,
    changes:   e.changes,
  });
  for (const e of (actor?.effects ?? [])) push(e);
  for (const item of (actor?.items ?? [])) {
    for (const e of (item.effects ?? [])) {
      if (!effectAutoApplies(e, scope)) continue; // ペイロードは自動収集しない
      push(e);
    }
  }
  return out;
}

/**
 * 使用時付与(2026-07-13 再設計)のペイロードの着地種別を changes から導く。
 * アイテム狙いキー(素の system.<パス>/分類/識別キー)が1つでもあれば**アイテム着地**で、
 * アクター向けの変更は落ちる(混在非対応=ユーザー確定)。それ以外は**アクター着地**。
 * @param {Array<object>} changes AE の changes
 * @returns {"item"|"actor"}
 */
export function analyzeGrantLanding(changes) {
  for (const c of (changes ?? [])) {
    const p = parseEffectTargetKey(c?.key);
    if (p && ["self", "skill", "category"].includes(p.scope)) return "item";
  }
  return "actor";
}

/**
 * アイテム着地ペイロードの付与先候補を絞り込む(2026-07-13 再設計・ユーザー確定)。
 * - 識別キー/分類(疑似分類含む)の変更があればそれで絞る(全変更に合致するアイテムのみ)
 * - 素のパラメータキーだけなら既定は**全アウトフィット**。対象パラメータを持たないアイテムは除く
 * @param {Iterable<Item>} items 付与先アクターの所持アイテム
 * @param {Array<object>} changes ペイロードの changes
 * @returns {Item[]}
 */
export function itemGrantCandidates(items, changes) {
  const selectors = [];
  const paramHeads = [];
  for (const c of (changes ?? [])) {
    const p = parseEffectTargetKey(c?.key);
    if (!p) continue;
    if (p.scope === "skill" || p.scope === "category") selectors.push(p);
    else if (p.scope === "self") paramHeads.push(p.path.split(".")[0]);
  }
  if (!selectors.length && !paramHeads.length) return [];
  const out = [];
  for (const item of (items ?? [])) {
    if (selectors.length) {
      if (!selectors.every(p => itemChangeTargets(p, item))) continue;
    } else if (!OUTFIT_TYPES.has(item.type)) continue;
    if (!paramHeads.every(head => item.system?.[head] !== undefined)) continue;
    out.push(item);
  }
  return out;
}

/**
 * アイテム着地ペイロードの changes を、付与先アイテム上で効く素のキーへ正規化する。
 * アクター向け・実行時系統の変更は落とす(混在非対応)。
 * @param {Array<object>} changes
 * @returns {Array<object>}
 */
export function rewriteGrantChangesForItem(changes) {
  const out = [];
  for (const c of (changes ?? [])) {
    const p = parseEffectTargetKey(c?.key);
    if (!p || !["self", "skill", "category", "partAdd", "itemName"].includes(p.scope)) continue;
    // 名前装飾はドキュメント直下の `name`(system 外)へ書き換える(フェーズ12)
    out.push({ ...c, key: (p.scope === "itemName" || p.path === "name") ? "name" : `system.${p.path}` });
  }
  return out;
}

export function parseEffectTargetKey(key) {
  if (typeof key !== "string" || !key) return null;
  // [conditions] を切り出す
  let conditions = [];
  let work = key;
  const condMatch = key.match(/^(.*?)\[([^\]]*)\](.*)$/);
  if (condMatch) {
    conditions = parseEffectConditions(condMatch[2]);
    work = condMatch[1] + condMatch[3];
  }
  const segs = work.split(".").filter(Boolean);
  // 名前装飾(フェーズ12・アイテムのみ): 素のキー `name`＝効果(またはそのコピー)が乗っている
  // アイテム自身の名前。値の `{}` は現在の名前に置換(ベタ打ちは上書き)。適用は in-memory
  // (source 不変)・priority 順の重ね掛け。ネイティブの name 適用は抑止する(tnx.mjs)。
  if (segs.length === 1 && segs[0] === "name") {
    return { scope: "itemName", conditions };
  }
  if (segs.length < 2) return null;

  // 判定バフ: check.<能力値|技能識別キー[*]|style.<スタイル識別キー>|works.<組織識別キー>> /
  //          controlCheck.<能力値>
  if (segs[0] === "check" || segs[0] === "controlCheck") {
    const x = segs[1];
    const isControl = segs[0] === "controlCheck";
    if (ABILITY_NAMES.includes(x)) {
      return { scope: isControl ? "controlCheck" : "abilityCheck", ability: x, conditions };
    }
    if (isControl) return null; // 制御判定は能力値のみ
    // 判定全般(2026-07-13 ユーザー確定): check.all＝無印「判定」(能力値判定+技能判定)すべてへの
    // 判定バフ。用語規約どおり制御判定には掛からない(controlCheck.all は現状なし=必要時に追加)。
    // ※"all" は予約語(識別キーとしては使えない)
    if (x === "all") {
      return { scope: "anyCheck", conditions };
    }
    // カード数字の上書き(2026-07-13 ユーザー確定): check.cardValue＝判定に使用したカードの
    // 数字を A〜K で上書きする(値は選択式・実行時系統=値バフ適用から除外)。
    // 無印「判定」の機構のため制御判定には効かない(判定フロー側でゲート)
    if (x === "cardValue") {
      return { scope: "cardValue", conditions };
    }
    // スート変更マーカー(2026-07-12 ユーザー確定): check.suitChange＝値不要のマーカーキー。
    // 「判定で使用できないスートのカードを使用可能なスートに変更できる」効果の AE 付与形
    // (用途の適用効果で対象へ付与=他者バフ)。判定バフと同じ実行時系統=値バフ適用からは除外。
    // 無印「判定」の機構のため制御判定には効かない(判定フロー側でゲート)
    if (x === "suitChange") {
      return { scope: "suitChange", conditions };
    }
    // グループ参照(2026-07-10): check.style.<スタイル識別キー>(そのスタイルのスタイル技能)/
    // check.works.<組織識別キー>(そのワークスのワークス技能)。識別キー前方一致(*)は据え置き。
    if ((x === "style" || x === "works") && segs.length > 2) {
      return { scope: "skillCheck", group: x, selector: segs.slice(2).join("."), conditions };
    }
    const prefix = x.endsWith("*");
    return { scope: "skillCheck", selector: prefix ? x.slice(0, -1) : x, prefix, conditions };
  }

  // ダメージバフ(実行時評価の別系統・check.* と同じく適用パスからは除外):
  // - damage.dealt[.<系統>](2026-07-11): 与えるダメージ +値(系統なし=全系統。physical/mental/social)
  // - damage.vsStyle.<スタイル識別キー> / damage.vsWorks.<組織識別キー>(2026-07-10):
  //   攻撃対象のスタイル/所属で照合する対象条件つきダメージ +値
  if (segs[0] === "damage") {
    // ダメージタグ改変(2026-07-12 ユーザー確定・支配タグ): チャート適用時にタグ(戦闘不能等)を
    // 置換/追加する**対象側** AE。damage.replaceTag.<元タグ>=新タグ / damage.addTag.<元タグ>=追加タグ
    // (値=CONDITION_KINDS のタグキー。例 damage.replaceTag.stupor=dominated・damage.addTag.erased=dominated)
    if ((segs[1] === "replaceTag" || segs[1] === "addTag") && segs.length > 2) {
      return {
        scope: "damageTag",
        mode: segs[1] === "replaceTag" ? "replace" : "add",
        tag: segs.slice(2).join("."),
        conditions,
      };
    }
    if (segs[1] === "dealt") {
      const cat = segs.length > 2 ? segs[2] : null;
      if (cat !== null && !["physical", "mental", "social"].includes(cat)) return null;
      return { scope: "damageDealt", category: cat, conditions };
    }
    if ((segs[1] === "vsStyle" || segs[1] === "vsWorks") && segs.length > 2) {
      const group = segs[1] === "vsStyle" ? "style" : "works";
      return { scope: "damageVs", group, selector: segs.slice(2).join("."), conditions };
    }
    // 受けるダメージ軽減(対象側・2026-07-17): damage.taken[.<系統|ダメージ種別>]。値=受ける
    // ダメージへの加算(負=軽減・正=増加)。恒久軽減としてダメージ算出時(10上限の前)に効く。
    // ダメージ種別(S/P/I/X)は肉体攻撃のみ持つため、種別セレクタは category=physical を含意する
    if (segs[1] === "taken") {
      const sel = segs.length > 2 ? segs.slice(2).join(".") : null;
      if (sel === null) return { scope: "damageTaken", category: null, damageType: null, conditions };
      if (["physical", "mental", "social"].includes(sel)) {
        return { scope: "damageTaken", category: sel, damageType: null, conditions };
      }
      if (["S", "P", "I", "X"].includes(sel)) {
        return { scope: "damageTaken", category: "physical", damageType: sel, conditions };
      }
      return null;
    }
    // 受けるダメージ軽減の攻撃者条件(2026-07-17): damage.fromStyle.<スタイル識別キー> /
    // damage.fromWorks.<組織識別キー>＝攻撃者がそのスタイル/ワークスを持つとき(vsStyle/vsWorks の対称)
    if ((segs[1] === "fromStyle" || segs[1] === "fromWorks") && segs.length > 2) {
      const group = segs[1] === "fromStyle" ? "style" : "works";
      return { scope: "damageFrom", group, selector: segs.slice(2).join("."), conditions };
    }
    return null;
  }

  // コンディション効果の無視ゲート(フェーズ12・ユーザー確定): 自分が受けているコンディションの
  // 効果(数値ペナルティ・行動制限の両方)を消費段階で無視する対象自己ゲート。タグ・BS・負傷は残す。
  // 値不要のマーカーキー(check.suitChange と同型)。実行時系統＝恒常の値バフ適用からは除外する。
  // - ignore.all              : あらゆる効果
  // - ignore.bs               : 全BSの効果(グループ)
  // - ignore.bs.<kind>        : 個別BS(例 ignore.bs.poison=邪毒)
  // - ignore.damage[.<系統>]  : ダメージ由来の効果すべて(系統なし=全系統)。負傷自身＋付随BS＋付随戦闘不能
  //   を woundCategory / woundSource→woundCategory で「物理/精神/社会由来か」を辿って照合(消費側)
  if (segs[0] === "ignore") {
    const x = segs[1];
    if (x === "all") return { scope: "ignore", mode: "all", conditions };
    if (x === "bs") {
      return segs.length > 2
        ? { scope: "ignore", mode: "kind", kind: segs.slice(2).join("."), conditions }
        : { scope: "ignore", mode: "group", group: "bs", conditions };
    }
    if (x === "damage") {
      const cat = segs.length > 2 ? segs[2] : null;
      if (cat !== null && !["physical", "mental", "social"].includes(cat)) return null;
      return { scope: "ignore", mode: "damage", category: cat, conditions };
    }
    return null;
  }

  // アイテム狙いの識別キー記法: item.<識別キー>.system.<パラメータ>。式(@item.<識別キー>.system.*)と
  // 同じ文法で AE キーを書く(唯一の綴り。旧同義形 system.skill.<識別キー>.* は 2026-07-13 の
  // 再設計で廃止)。self/parent セレクタも廃止: 自身は素の system.<パス>(下の default)、準備先は
  // AE 設定の「準備先(親アイテム)に適用」チェックで表す(キーは対象パラメータと絞り込みだけを語る)。
  // ※式(@item.self/@item.parent)は「値を引いてくる」参照なので self/parent が残る(キーとは別物)
  if (segs[0] === "item" && segs.length >= 4 && segs[2] === "system") {
    const sel = segs[1];
    const path = segs.slice(3).join(".");
    if (sel === "self" || sel === "parent") return null; // 廃止済みの旧綴り(死にキー)
    const prefix = sel.endsWith("*");
    return { scope: "skill", selector: prefix ? sel.slice(0, -1) : sel, prefix, path, conditions };
  }
  // 識別キー狙いの名前装飾(フェーズ12): item.<識別キー>.name。物理転送で対象アイテム上の
  // 実体コピー(素のキー `name`)になる。転送時のキー書き換えは path==="name" を特別扱いする
  if (segs[0] === "item" && segs.length === 3 && segs[2] === "name") {
    const sel = segs[1];
    if (sel === "self" || sel === "parent") return null;
    const prefix = sel.endsWith("*");
    return { scope: "skill", selector: prefix ? sel.slice(0, -1) : sel, prefix, path: "name", conditions };
  }

  // 値バフ: system.<名前空間>.…
  if (segs[0] !== "system") return null;
  const ns = segs[1];
  const after = segs.slice(2);
  switch (ns) {
    case "ability": return after.length ? { scope: "ability", path: after.join("."), conditions } : null;
    case "control": return after.length ? { scope: "control", path: after.join("."), conditions } : null;
    case "category":
      if (after.length < 2) return null;
      return { scope: "category", selector: after[0], path: after.slice(1).join("."), conditions };
    // CS の3層着地(フェーズ10-5・Active_Effects 大原則6)。仮想名前空間 "cs"——実スキーマパス
    // (system.combatSpeed.*)と分けることで、アクター自身の効果がネイティブ適用と二重に効くのを防ぐ。
    // base=CSベース実効 / value=CS実効 / current=CSカレント実効。cs.base のみ適用パスで
    // 保持アイテムの準備状態ゲート(未準備=読み飛ばし)がかかる。
    // 生身のダメージ種別上書き(2026-07-13): 実効フィールド baseAttack.damageTypeTotal へ着地
    // (設定欄=素値 baseAttack.damageType は不変)。他の baseAttack キーは従来どおりネイティブ
    case "baseAttack": {
      return after.join(".") === "damageType" ? { scope: "baseAttackType", conditions } : null;
    }
    case "cs": {
      const p = after.join(".");
      return ["base", "value", "current"].includes(p) ? { scope: "cs", path: p, conditions } : null;
    }
    // AR の着地(フェーズ11)。仮想名前空間 "ar"——max=実効付与値(actionRank.maxTotal)。
    // 高額アウトフィットの増強等の常時修正が乗る。cs.base と同じく準備状態ゲートがかかる。
    case "ar": {
      return after.join(".") === "max" ? { scope: "ar", path: "max", conditions } : null;
    }
    // アクター部位スロットの増減(フェーズ12)。仮想名前空間 "partSlot"——実フィールド
    // partSlots と綴りを分けてネイティブ二重適用を防ぐ(cs/ar と同じ流儀)。
    // 値=増減数(式も可)。着地は partSlotsEffective(base は不変)。cs.base と同じ準備ゲートあり。
    case "partSlot": {
      return after.length ? { scope: "partSlot", selector: after.join("."), conditions } : null;
    }
    // 廃止済みの旧綴り(2026-07-13 再設計): 自身は素の system.<パス>、準備先は AE 設定の
    // 「準備先(親アイテム)に適用」、識別キーは item.<識別キー>.system.* に一本化した。
    // 素のキーと紛れて誤解釈しないよう明示的に死にキーにする
    case "self":
    case "parent":
    case "skill":
      return null;
    default: {
      // 素のパラメータキー(2026-07-13 再設計・ユーザー確定): 予約名前空間以外の system.<パス>は
      // 「この効果(またはその転送/付与コピー)が乗っているアイテム自身」のパラメータを指す。
      // 旧 system.self.*/item.self.system.* の後継で、転送コピー・付与コピーもこの綴りで着地する。
      // handMaxSizeMod はネイティブ着地の特例(KI-020)のためここでは扱わない
      const path = segs.slice(1).join(".");
      if (path === "handMaxSizeMod") return null;
      // 名前は素のキー `name`(system 外)が正——system.name は誤記として無効化する
      if (path === "name") return null;
      // アイテム部位行の追加(フェーズ12): system.part.<部位キー>。値=and/or(:消費数)。
      // part は ArrayField のため素のパラメータキーとしての正当な用法が無く、予約しても衝突しない。
      // 識別キー/分類狙い(item.<キー>.system.part.<部位キー> 等)は物理転送でこの綴りのコピーになる
      if (path === "part") return null;
      if (path.startsWith("part.")) {
        const selector = path.slice("part.".length);
        return selector ? { scope: "partAdd", selector, path, conditions } : null;
      }
      return { scope: "self", path, conditions };
    }
  }
}

/**
 * 解析済み条件を対象 system に対して評価する(フェーズ9 v2)。
 * 条件パスは total 系へ解決(`hack`→`hack.total` があればそれ、無ければ素の値)。
 * @param {object} system 対象アイテムの system
 * @param {Array<{path:string, op:string, value:number}>} conditions
 * @returns {boolean} 全条件成立で true(条件なしも true)
 */
export function evalEffectConditions(system, conditions) {
  if (!conditions?.length) return true;
  for (const { path, op, value } of conditions) {
    const actual = resolveConditionValue(system, path);
    if (!Number.isFinite(actual) || !Number.isFinite(value)) return false;
    if (op === ">=" && !(actual >= value)) return false;
    if (op === "<=" && !(actual <= value)) return false;
    if (op === ">"  && !(actual >  value)) return false;
    if (op === "<"  && !(actual <  value)) return false;
    if (op === "==" && !(actual === value)) return false;
    if (op === "!=" && !(actual !== value)) return false;
  }
  return true;
}

/**
 * AE のパラメータパス(`attack` / `defence.S` / `level` 等)を、対象 system 上の
 * **total 系の実 system パス**へ解決する(v2 適用パスで effect.apply のキーに使う)。
 * - "defence.S/P/I" → "defence.{S,P,I}_total"
 * - 素の値(level/FAValue/residence stat) → "<param>Total"
 * - その他(modeValue/attack) → "<param>.total"
 * @param {string} param
 * @returns {string}
 */
export function resolveItemTotalPath(param) {
  // ダメージ種別の上書き(2026-07-13 訂正): 実効フィールド damageTypeTotal へ着地する。
  // **設定欄(素値 attack.damageType)には絶対に書かない**(base 不変の大原則)
  if (param === "attack.damageType" || param === "attack.damageTypeTotal") return "attack.damageTypeTotal";
  // フルパス正規化(2026-07-13): 統一記法(item.<識別キー>.system.*)では式と同じ綴り
  // (….value / ….total / levelTotal 等)で書かれるため、素値/実効のどちらの綴りでも
  // **必ず実効(total 系)へ**着地させる(素値を書き換えない・モード=追加/上書きは total 上で効く)
  let p = param.replace(/\.(value|total)$/, "");
  const bareTotals = {
    levelTotal: "level", FAValueTotal: "FAValue",
    appearanceTargetTotal: "appearanceTarget",
    cyberSecurityTotal: "cyberSecurity", analogSecurityTotal: "analogSecurity",
  };
  if (bareTotals[p]) p = bareTotals[p];
  // 特性フラグ(フェーズ12): 素の綴り(isFullAuto/suits.spade 等)も実効綴り(…Total)も
  // 実効フィールドへ正規化して着地する(base 不変の大原則は数値と同じ)
  if (AE_FLAG_TOTAL_PATHS.has(p)) return p;
  if (AE_FLAG_PARAMS.includes(p)) return flagTotalPath(p);
  if (p.startsWith("defence.")) {
    const k = p.split(".")[1].replace(/_(defence|total)$/, "");
    return `defence.${k}_total`;
  }
  const bare = {
    level: "levelTotal", FAValue: "FAValueTotal",
    appearanceTarget: "appearanceTargetTotal",
    cyberSecurity: "cyberSecurityTotal", analogSecurity: "analogSecurityTotal",
  };
  return bare[p] ?? `${p}.total`;
}

/** 条件パスの数値を解決する。`X.total`(派生実効値)があれば優先、無ければ `X.value` / 素の値。 */
function resolveConditionValue(system, path) {
  const field = system?.[path];
  if (field && typeof field === "object") {
    if (typeof field.total === "number") return field.total;
    if (typeof field.value === "number") return field.value;
    return NaN;
  }
  if (typeof system?.[`${path}Total`] === "number") return system[`${path}Total`];
  return typeof field === "number" ? field : NaN;
}

