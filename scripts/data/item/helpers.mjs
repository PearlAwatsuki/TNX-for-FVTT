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
 * attack フィールドは B-5b 時点では cyborg のみで使用。B-7 で weapon に
 * 同構造が出現した時点で attackField() のヘルパー化を再検討する。
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
