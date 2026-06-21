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
 * @param {{type:"skill"|"ability"|"control", skillKeys?:string[], ability?:string}} criteria
 * @returns {boolean}
 */
export function checkChangeMatches(key, criteria) {
  const p = parseEffectTargetKey(key);
  if (!p || !criteria) return false;
  if (criteria.type === "ability") return p.scope === "abilityCheck" && p.ability === criteria.ability;
  if (criteria.type === "control") return p.scope === "controlCheck" && p.ability === criteria.ability;
  if (criteria.type === "skill") {
    if (p.scope !== "skillCheck") return false;
    return (criteria.skillKeys ?? []).some(k =>
      p.prefix ? !!k?.startsWith?.(p.selector) : k === p.selector);
  }
  return false;
}

/**
 * 判定バフの合計ボーナスを算出する(フェーズ9-3 v2)。
 * **同一効果の重複適用不可**: 各効果(identity)につき最大1回。同一効果内で複数の変更が合致しても
 * 最も有利な値を1回。別効果はスタック。`stackable` の効果は重複排除せず常に加算。
 *
 * @param {Array<{identity:string, stackable?:boolean, active?:boolean, changes?:Array<{key:string,value:any}>}>} effects
 * @param {{type:"skill"|"ability"|"control", skillKeys?:string[], ability?:string}} criteria
 * @returns {number}
 */
export function computeCheckBonus(effects, criteria) {
  const byIdentity = new Map();
  let stackableSum = 0;
  for (const eff of (effects ?? [])) {
    if (eff.active === false) continue;
    let matched = null;
    for (const change of (eff.changes ?? [])) {
      if (!checkChangeMatches(change.key, criteria)) continue;
      const v = Number(change.value) || 0;
      matched = matched === null ? v : Math.max(matched, v);
    }
    if (matched === null) continue;
    if (eff.stackable) {
      stackableSum += matched;
    } else {
      const id = eff.identity;
      byIdentity.set(id, Math.max(byIdentity.get(id) ?? -Infinity, matched));
    }
  }
  let sum = stackableSum;
  for (const v of byIdentity.values()) sum += v;
  return sum;
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

  // 判定バフ: check.<能力値|技能識別キー[*]> / controlCheck.<能力値>
  if (segs[0] === "check" || segs[0] === "controlCheck") {
    const x = segs[1];
    const isControl = segs[0] === "controlCheck";
    if (ABILITY_NAMES.includes(x)) {
      return { scope: isControl ? "controlCheck" : "abilityCheck", ability: x, conditions };
    }
    if (isControl) return null; // 制御判定は能力値のみ
    const prefix = x.endsWith("*");
    return { scope: "skillCheck", selector: prefix ? x.slice(0, -1) : x, prefix, conditions };
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

