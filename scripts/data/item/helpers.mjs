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
 * 判定バフの変更キーが、判定の条件(criteria)に合致するか(フェーズ9-3 v2)。
 * @param {string} key  change.key
 * @param {{type:"skill"|"ability"|"control", skills?:{key:string,style?:string,organization?:string}[], skillKeys?:string[], ability?:string}} criteria
 * @returns {boolean}
 */
export function checkChangeMatches(key, criteria) {
  const p = parseEffectTargetKey(key);
  if (!p || !criteria) return false;
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
function _gatherBonusSources(effects, predicate) {
  const byIdentity = new Map();
  const stackables = [];
  for (const eff of (effects ?? [])) {
    if (eff.active === false) continue;
    let matched = null;
    for (const change of (eff.changes ?? [])) {
      if (!predicate(change.key)) continue;
      const v = Number(change.value) || 0;
      matched = matched === null ? v : Math.max(matched, v);
    }
    if (matched === null) continue;
    const entry = { name: eff.name || "(無名効果)", value: matched };
    if (eff.stackable) {
      stackables.push(entry);
    } else {
      const prev = byIdentity.get(eff.identity);
      if (!prev || matched > prev.value) byIdentity.set(eff.identity, entry);
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
  for (const item of (actor?.items ?? [])) for (const e of (item.effects ?? [])) push(e);
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
    return null;
  }

  // 値バフ: system.<名前空間>.…
  if (segs[0] !== "system") return null;
  const ns = segs[1];
  const after = segs.slice(2);
  switch (ns) {
    case "ability": return after.length ? { scope: "ability", path: after.join("."), conditions } : null;
    case "control": return after.length ? { scope: "control", path: after.join("."), conditions } : null;
    case "self":    return after.length ? { scope: "self",    path: after.join("."), conditions } : null;
    case "parent":  return after.length ? { scope: "parent",  path: after.join("."), conditions } : null;
    case "category":
      if (after.length < 2) return null;
      return { scope: "category", selector: after[0], path: after.slice(1).join("."), conditions };
    case "skill": {
      if (after.length < 2) return null;
      const sel = after[0];
      const prefix = sel.endsWith("*");
      return { scope: "skill", selector: prefix ? sel.slice(0, -1) : sel, prefix, path: after.slice(1).join("."), conditions };
    }
    // CS の3層着地(フェーズ10-5・Active_Effects 大原則6)。仮想名前空間 "cs"——実スキーマパス
    // (system.combatSpeed.*)と分けることで、アクター自身の効果がネイティブ適用と二重に効くのを防ぐ。
    // base=CSベース実効 / value=CS実効 / current=CSカレント実効。cs.base のみ適用パスで
    // 保持アイテムの準備状態ゲート(未準備=読み飛ばし)がかかる。
    case "cs": {
      const p = after.join(".");
      return ["base", "value", "current"].includes(p) ? { scope: "cs", path: p, conditions } : null;
    }
    // AR の着地(フェーズ11)。仮想名前空間 "ar"——max=実効付与値(actionRank.maxTotal)。
    // 高額アウトフィットの増強等の常時修正が乗る。cs.base と同じく準備状態ゲートがかかる。
    case "ar": {
      return after.join(".") === "max" ? { scope: "ar", path: "max", conditions } : null;
    }
    default: return null; // handMaxSizeMod 等はネイティブ処理に委ねる
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
  if (param.startsWith("defence.")) return `defence.${param.split(".")[1]}_total`;
  const bare = {
    level: "levelTotal", FAValue: "FAValueTotal",
    appearanceTarget: "appearanceTargetTotal",
    cyberSecurity: "cyberSecurityTotal", analogSecurity: "analogSecurityTotal",
  };
  return bare[param] ?? `${param}.total`;
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

