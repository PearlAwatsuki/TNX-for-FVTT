/**
 * @fileoverview StyleDataModel - スタイル Item の DataModel
 *
 * 使用 template: base のみ
 * 固有フィールド: isPersona / isKey / level / miracle(name/id) /
 *               reason / passion / life / mundane(各 value/control)
 *
 * 準拠データ: template.json > Item.style
 *
 * 注意:
 * - reason / passion / life / mundane は Actor の attributes 同名フィールド(14 フィールド、
 *   scripts/data/helpers.mjs の attributeField())とは別物。style 側は {value, control} の
 *   2 フィールドのみ。attributeField() は使用しない。
 *   同構造が 4 箇所に繰り返されるため、このファイル内のローカル関数 abilityField() で
 *   定義している(scripts/data/item/helpers.mjs に出すほどではない: style 専用のため)。
 * - level の初期値は 1(template.json に忠実)。ルール上 1〜3 の範囲だが、既存ロジック
 *   (preUpdateItem フック・cast-sheet の排他制御)が範囲制御を担っているため、DataModel
 *   側では min/max 制約を入れない。制約の追加が必要になった時点で検討する。
 * - miracle.id は miracle Item の UUID。tnx-style-sheet.mjs が fromUuid() で解決する。
 * - style に結合する既存ロジック(preUpdateItem/preDeleteItem フック、cast-sheet の
 *   isPersona/isKey 排他制御)には一切触れない(B-8 / フェーズ6 で扱う)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";

/** style 固有の能力値フィールド({value, control} の 2 フィールド構造) */
function abilityField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value:   new fields.NumberField({ initial: 0 }),
    control: new fields.NumberField({ initial: 0 }),
  });
}

export class StyleDataModel extends SystemDataModel.mixin(BaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      isPersona: new fields.BooleanField({ initial: false }),
      isKey:     new fields.BooleanField({ initial: false }),
      level:     new fields.NumberField({ initial: 1 }),
      miracle: new fields.SchemaField({
        name: new fields.StringField({ initial: "" }),
        id:   new fields.StringField({ initial: "" }),
      }),
      reason:  abilityField(),
      passion: abilityField(),
      life:    abilityField(),
      mundane: abilityField(),
    };
  }
}
