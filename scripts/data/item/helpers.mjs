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
 */

/**
 * 防御値(ストリート / フィジカル / インフォウォー)の SchemaField を返す。
 * template.json の初期値はすべて 0 のため NumberField。
 *
 * 使用 Item type: armor / cyborg
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function defenceField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    S_defence: new fields.NumberField({ initial: 0 }),
    P_defence: new fields.NumberField({ initial: 0 }),
    I_defence: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 攻撃値(ダメージ種別 / 値 / 修正)の SchemaField を返す。
 * damageType は文字列の配列(ArrayField(StringField))、value / mod は初期値 0 の NumberField。
 *
 * 使用 Item type: cyborg / weapon
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function attackField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    damageType: new fields.ArrayField(new fields.StringField()),
    value:      new fields.NumberField({ initial: 0 }),
    mod:        new fields.NumberField({ initial: 0 }),
  });
}
