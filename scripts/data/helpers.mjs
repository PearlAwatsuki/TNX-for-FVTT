/**
 * @fileoverview DataModel 定義で使うヘルパー関数の置き場
 *
 * TNX のフィールド定義に頻出するパターンを関数化し、重複を減らす。
 * 新しいパターンが増えたらここに追加する。
 */

/**
 * ダメージ量を表す { value, min, max } の SchemaField を返す。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function damageField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value: new fields.NumberField({ initial: 0 }),
    min:   new fields.NumberField({ initial: 0 }),
    max:   new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 能力値(reason / passion / life / mundane)の14フィールド構造を返す SchemaField。
 * template.json > Actor.templates.attributes.reason 等の構造に準拠。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function attributeField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value:            new fields.NumberField({ initial: 0 }),
    control:          new fields.NumberField({ initial: 0 }),
    styleA_value:     new fields.NumberField({ initial: 0 }),
    styleA_control:   new fields.NumberField({ initial: 0 }),
    styleB_value:     new fields.NumberField({ initial: 0 }),
    styleB_control:   new fields.NumberField({ initial: 0 }),
    styleC_value:     new fields.NumberField({ initial: 0 }),
    styleC_control:   new fields.NumberField({ initial: 0 }),
    growth:           new fields.NumberField({ initial: 0 }),
    controlGrowth:    new fields.NumberField({ initial: 0 }),
    mod:              new fields.NumberField({ initial: 0 }),
    controlMod:       new fields.NumberField({ initial: 0 }),
    effectMod:        new fields.NumberField({ initial: 0 }),
    controlEffectMod: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 能力値・制御値の最終実効値(total / totalControl)を算出する純粋関数。
 *
 * 実効値 = growth + Σ(スタイル基本値 × レベル) + mod + effectMod + outfitMod。
 * 制御値も同様に control 系フィールドで算出する。
 * 最終合算後に 0clamp を適用する(全修正合算後・順序非依存。能力値/制御値とも)。
 * → llm-wiki/01_Wiki/Game_Rules/Character_Creation.md「能力値・制御値の上限と最終値clamp」
 *
 * 判定・シート表示・mundane 算出が同一式を参照するための単一の真実。
 * DataModel(prepareDerivedData)から呼ぶ。Item に依存しないよう、スタイル寄与は
 * { value, control, level } の素オブジェクト配列で受け取る(テスト容易性のため)。
 *
 * @param {object}   ability  能力値フィールド(growth/mod/effectMod/controlGrowth/controlMod/controlEffectMod)
 * @param {Array<{value:number, control:number, level:number}>} styles  スタイル寄与
 * @param {number}   [outfitMod=0]         能力値へのアウトフィット修正
 * @param {number}   [outfitControlMod=0]  制御値へのアウトフィット修正
 * @returns {{ total:number, totalControl:number }}
 */
export function computeAttributeFinal(ability, styles, outfitMod = 0, outfitControlMod = 0) {
  let styleValue = 0, styleControl = 0;
  for (const s of styles) {
    const level = s.level || 1;
    styleValue   += (s.value   ?? 0) * level;
    styleControl += (s.control ?? 0) * level;
  }
  // v2: effectMod 項は廃止(バフは適用パスが total へ直接効かせる)。0clamp は
  // バフ適用後に行うため、ここでは clamp しない素の base 合計を返す。
  return {
    total:        (ability.growth        ?? 0) + styleValue   + (ability.mod        ?? 0) + outfitMod,
    totalControl: (ability.controlGrowth ?? 0) + styleControl + (ability.controlMod ?? 0) + outfitControlMod,
  };
}

/** OutfitBaseTemplate を合成するアイテム type(キャストのアウトフィット集計対象) */
export const OUTFIT_ITEM_TYPES = new Set([
  "weapon", "armor", "ianus", "cyborg", "tron", "tap",
  "vehicle", "residence", "combiner", "general",
]);

/**
 * 携帯中アウトフィットから outfitMod(制御値修正・CS修正)と appearanceModifier(危険値合計)を
 * 集計する純粋関数(フェーズ9-2、B-2 派生化)。
 *
 * - 制御値修正: 準備済み(isPrepared)かつ携帯中のアウトフィットのみ加算。
 * - CS修正: 携帯中であれば加算(tap は常時稼働のため isPrepared 不問)。
 *   ゴースト登場中(isGhost)は物理現場不在のため無効。
 * - 危険値(appearancePenalty): 携帯中のアウトフィットを合算(登場判定用)。
 *
 * Item に依存しないよう、items は { type, system } を持つ素オブジェクト配列で受け取る。
 *
 * @param {Array<{type:string, system:object}>} items  アクターの全アイテム
 * @param {boolean} [isGhost=false]  ゴースト登場中か
 * @returns {{ control:number, combatSpeed:number, appearance:number }}
 */
export function computeOutfitAggregates(items, isGhost = false) {
  let control = 0, combatSpeed = 0, appearance = 0;
  for (const item of items) {
    if (!OUTFIT_ITEM_TYPES.has(item.type)) continue;
    const s = item.system;
    if (!s?.isCarrying) continue;
    if (s.isPrepared && s.controlMod?.mode === "value")        control     += Number(s.controlMod.value) || 0;
    if (!isGhost && s.combatSpeedMod?.mode === "value")        combatSpeed += Number(s.combatSpeedMod.value) || 0;
    if (s.appearancePenalty?.mode === "value")                appearance  += Number(s.appearancePenalty.value) || 0;
  }
  return { control, combatSpeed, appearance };
}

/**
 * 戦闘速度(combatSpeed)の5フィールド構造を返す SchemaField。
 * template.json > Actor.templates.attributes.combatSpeed 構造に準拠。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function combatSpeedField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value:   new fields.NumberField({ initial: 0 }),
    base:    new fields.NumberField({ initial: 0 }),
    current: new fields.NumberField({ initial: 0 }),
    mod:     new fields.NumberField({ initial: 0 }),
    freeMod: new fields.NumberField({ initial: 0 }),
  });
}
