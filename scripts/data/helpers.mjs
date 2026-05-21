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
