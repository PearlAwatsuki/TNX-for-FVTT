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
  // {value, effectMod} 形(modeValueField の各種・attackField)
  for (const field of Object.values(system)) {
    if (field && typeof field === "object"
        && typeof field.value === "number" && typeof field.effectMod === "number") {
      const active = field.mode === undefined || field.mode === "value";
      field.total = active ? field.value + field.effectMod : field.value;
    }
  }
  // defence(S/P/I)
  const def = system.defence;
  if (def && typeof def === "object" && typeof def.S_effectMod === "number") {
    const active = def.mode === "value";
    for (const k of ["S", "P", "I"]) {
      const base = def[`${k}_defence`] ?? 0;
      def[`${k}_total`] = active ? base + (def[`${k}_effectMod`] ?? 0) : base;
    }
  }
  // slots[].count
  if (Array.isArray(system.slots)) {
    for (const slot of system.slots) {
      const c = slot?.count;
      if (c && typeof c.value === "number" && typeof c.effectMod === "number") {
        c.total = c.mode === "value" ? c.value + c.effectMod : c.value;
      }
    }
  }
  // 素の値(FAValue / residence stats)
  if (typeof system.FAValueEffectMod === "number") {
    system.FAValueTotal = (system.FAValue ?? 0) + system.FAValueEffectMod;
  }
  for (const base of ["appearanceTarget", "cyberSecurity", "analogSecurity"]) {
    if (typeof system[`${base}EffectMod`] === "number") {
      system[`${base}Total`] = (system[base] ?? 0) + system[`${base}EffectMod`];
    }
  }
}

/**
 * モードB(アクター→他アイテム横断バフ)の対象判定(フェーズ9-3)。
 * AE が flag(`flags["tokyo-nova-axleration"].aeTarget`)に持つ target spec とアイテムを照合する。
 *
 * spec のフィルタ次元(指定された次元のみ AND で評価。各次元はリスト内 OR):
 * - byItemType:        ["weapon", ...]            アイテム type
 * - byMajorCategory:   ["武器", ...]              大分類
 * - byMinorCategory:   ["白兵武器", ...]          小分類
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
 * モードB の加算注入: アイテムの実効値(`.total` 系)に delta を加える(フェーズ9-3)。
 * base は触らず total のみ調整する(アクター prepareDerivedData の後処理で呼ぶ。
 * アイテム自身の prepareDerivedData は既に走り total が算出済みのため)。
 *
 * param の指定:
 * - "defence.S" / "defence.P" / "defence.I" → defence.{S,P,I}_total
 * - "level" / "FAValue" / "appearanceTarget" / "cyberSecurity" / "analogSecurity" → <param>Total
 * - その他(modeValueField / attack 等) → system[param].total
 *
 * @param {object} system アイテムの system
 * @param {string} param  対象パラメータ
 * @param {number} delta  加算量
 */
export function addToItemTotal(system, param, delta) {
  if (!system || !param || !Number.isFinite(delta)) return;
  if (param.startsWith("defence.")) {
    const key = `${param.split(".")[1]}_total`;
    if (system.defence && typeof system.defence[key] === "number") system.defence[key] += delta;
    return;
  }
  const bareTotals = {
    level: "levelTotal", FAValue: "FAValueTotal",
    appearanceTarget: "appearanceTargetTotal",
    cyberSecurity: "cyberSecurityTotal", analogSecurity: "analogSecurityTotal",
  };
  if (bareTotals[param]) {
    const key = bareTotals[param];
    if (typeof system[key] === "number") system[key] += delta;
    return;
  }
  const field = system[param];
  if (field && typeof field === "object" && typeof field.total === "number") field.total += delta;
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
