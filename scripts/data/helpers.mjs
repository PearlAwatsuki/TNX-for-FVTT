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
