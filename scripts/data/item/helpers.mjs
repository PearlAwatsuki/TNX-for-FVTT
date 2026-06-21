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
    mode:      new fields.StringField({ required: true, blank: false, initial: "none", choices }),
    value:     new fields.NumberField({ initial: 0 }),
    effectMod: new fields.NumberField({ initial: 0 }),
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
    // ActiveEffect 着地点(フェーズ9-3)。S/P/I それぞれに ADD。実効防御力 = X_defence + X_effectMod は消費側で算出。
    S_effectMod: new fields.NumberField({ initial: 0 }),
    P_effectMod: new fields.NumberField({ initial: 0 }),
    I_effectMod: new fields.NumberField({ initial: 0 }),
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
    effectMod: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * アイテムの実効値(`.total` 系)を AE 着地点(effectMod)込みで算出する(フェーズ9-3)。
 * **base 値(value / X_defence 等)は書き換えず**、別キー(`.total`)に実効値を派生する。
 * これにより編集 UI は base を、表示・消費側は total を読める(入力に total が漏れない)。
 *
 * - {value, effectMod} 形(modeValueField / attackField): mode があれば mode==="value" 時のみ
 *   effectMod を加算。`field.total` に格納。
 * - defence(S/P/I): `defence.{S,P,I}_total`。
 * - slots[].count(modeValueField): 各 `count.total`。
 * - 素の値(FAValue / residence の各 stat): `<base>Total`。
 * - clamp はしない(controlMod / combatSpeedMod 等は負の修正がありうる。0clamp は消費側の責務)。
 *
 * @param {object} system アイテムの system データ(prepareDerivedData の this)
 */
export function computeItemEffectiveValues(system) {
  // {value, ...} 形(modeValueField の各種・attackField): total は base のみ。
  // バフはアクターの適用パスが total へ直接効かせる(v2、effectMod は廃止予定の死蔵)。
  for (const field of Object.values(system)) {
    if (field && typeof field === "object"
        && typeof field.value === "number" && typeof field.effectMod === "number") {
      field.total = field.value;
    }
  }
  // defence(S/P/I)
  const def = system.defence;
  if (def && typeof def === "object" && typeof def.S_effectMod === "number") {
    for (const k of ["S", "P", "I"]) def[`${k}_total`] = def[`${k}_defence`] ?? 0;
  }
  // slots[].count
  if (Array.isArray(system.slots)) {
    for (const slot of system.slots) {
      const c = slot?.count;
      if (c && typeof c.value === "number" && typeof c.effectMod === "number") c.total = c.value;
    }
  }
  // 素の値(FAValue / residence stats)
  if (typeof system.FAValueEffectMod === "number") {
    system.FAValueTotal = system.FAValue ?? 0;
  }
  for (const base of ["appearanceTarget", "cyberSecurity", "analogSecurity"]) {
    if (typeof system[`${base}EffectMod`] === "number") {
      system[`${base}Total`] = system[base] ?? 0;
    }
  }
}

/**
 * モードB(アクター→他アイテム横断バフ)の対象判定(フェーズ9-3)。
 * AE が flag(`flags["tokyo-nova-axleration"].aeTarget`)に持つ target spec とアイテムを照合する。
 *
 * spec のフィルタ次元(指定された次元のみ AND で評価。各次元はリスト内 OR):
 * - byItemType:        ["weapon", ...]            アイテム type
 * - byMajorCategory:   ["weapon", ...]           大分類キー
 * - byMinorCategory:   ["melee", ...]            小分類キー
 * - byIdentificationKey: ["...", ...]             identificationKey 名指し
 * 少なくとも1つのフィルタが必要(無条件全件マッチを防ぐ)。
 *
 * @param {{type:string, system:object}} item
 * @param {object} spec
 * @returns {boolean}
 */
export function matchesAeTarget(item, spec) {
  if (!spec || !item) return false;
  const sys = item.system ?? {};
  const dims = [
    ["byItemType",          item.type],
    ["byMajorCategory",     sys.majorCategory],
    ["byMinorCategory",     sys.minorCategory],
    ["byIdentificationKey", sys.identificationKey],
  ];
  let hasFilter = false;
  for (const [key, actual] of dims) {
    const list = spec[key];
    if (Array.isArray(list) && list.length) {
      hasFilter = true;
      if (!list.includes(actual)) return false;
    }
  }
  return hasFilter;
}

/**
 * モードB の加算注入: アイテムの **AE 着地点 effectMod** に delta を加える(フェーズ9-3)。
 * base は触らない。注入後にアクター側で computeItemEffectiveValues を再実行して total に反映する。
 *
 * param の指定:
 * - "defence.S" / "defence.P" / "defence.I" → defence.{S,P,I}_effectMod
 * - "level" / "FAValue" / "appearanceTarget" / "cyberSecurity" / "analogSecurity" → <param>EffectMod
 * - その他(modeValueField / attack 等) → system[param].effectMod
 *
 * @param {object} system アイテムの system
 * @param {string} param  対象パラメータ
 * @param {number} delta  加算量
 */
export function addToItemEffectMod(system, param, delta) {
  if (!system || !param || !Number.isFinite(delta)) return;
  if (param.startsWith("defence.")) {
    const key = `${param.split(".")[1]}_effectMod`;
    if (system.defence && typeof system.defence[key] === "number") system.defence[key] += delta;
    return;
  }
  const bareEffectMods = {
    level: "levelEffectMod", FAValue: "FAValueEffectMod",
    appearanceTarget: "appearanceTargetEffectMod",
    cyberSecurity: "cyberSecurityEffectMod", analogSecurity: "analogSecurityEffectMod",
  };
  if (bareEffectMods[param]) {
    const key = bareEffectMods[param];
    if (typeof system[key] === "number") system[key] += delta;
    return;
  }
  const field = system[param];
  if (field && typeof field === "object" && typeof field.effectMod === "number") field.effectMod += delta;
}

/**
 * モードB の changes キー `<識別キー>.<systemパス>` を解析する(フェーズ9-3)。
 * 例: "hisho-geki.attack.effectMod" → { identKey: "hisho-geki", path: "attack.effectMod" }。
 * system. / flags. で始まる通常キー(自己適用・キャラ適用)は対象外で null を返す。
 *
 * @param {string} key  ActiveEffect change のキー
 * @returns {{identKey:string, path:string}|null}
 */
export function parseCrossTargetKey(key) {
  if (typeof key !== "string" || !key) return null;
  if (key.startsWith("system.") || key.startsWith("flags.")) return null;
  const dot = key.indexOf(".");
  if (dot <= 0) return null;
  return { identKey: key.slice(0, dot), path: key.slice(dot + 1) };
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
export function parseEffectTargetKey(key) {
  if (typeof key !== "string" || !key) return null;
  let head, rest, conditions = [];
  const condMatch = key.match(/^([^.[]+)\[([^\]]*)\](.*)$/);
  if (condMatch) {
    head = condMatch[1];
    conditions = parseEffectConditions(condMatch[2]);
    rest = condMatch[3];
  } else {
    const dot = key.indexOf(".");
    if (dot <= 0) return null;
    head = key.slice(0, dot);
    rest = key.slice(dot);
  }
  if (!rest.startsWith(".")) return null;
  const path = rest.slice(1);
  if (!head || !path) return null;

  if (head === "system") return { scope: "system", path, conditions };
  if (head === "self")   return { scope: "self", path, conditions };
  if (head === "parent") return { scope: "parent", path, conditions };
  if (head.startsWith("cat:")) {
    const sel = head.slice(4);
    return sel ? { scope: "cat", selector: sel, path, conditions } : null;
  }
  if (head.endsWith("*")) {
    const sel = head.slice(0, -1);
    return sel ? { scope: "prefix", selector: sel, path, conditions } : null;
  }
  return { scope: "key", selector: head, path, conditions };
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

/**
 * 旧 attack.mod(手動修正・実質未使用)→ attack.effectMod(AE 着地点)へのリネーム移行。
 * weapon / cyborg / vehicle の migrateData から呼ぶ。source を破壊的に書き換える。
 * @param {object} source DataModel の生ソース
 */
export function migrateAttackModToEffectMod(source) {
  const attack = source?.attack;
  if (attack && typeof attack.mod === "number" && attack.effectMod === undefined) {
    attack.effectMod = attack.mod;
    delete attack.mod;
  }
}
