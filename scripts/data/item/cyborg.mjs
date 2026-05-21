/**
 * @fileoverview CyborgDataModel - サイバーウェア Item の DataModel
 *
 * 使用 template: base + outfitBase
 * 固有フィールド: defence(S/P/I) / attack / guardValue
 *
 * 準拠データ: template.json > Item.cyborg
 *
 * 注意:
 * - attack フィールドは B-5b 時点では cyborg のみ。B-7(weapon)でも同構造が出るため、
 *   weapon 着手時に attackField() ヘルパーへの切り出しを再検討すること。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { defenceField } from "./helpers.mjs";

export class CyborgDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      defence: defenceField(),
      attack: new fields.SchemaField({
        damageType: new fields.ArrayField(new fields.StringField()),
        value:      new fields.NumberField({ initial: 0 }),
        mod:        new fields.NumberField({ initial: 0 }),
      }),
      guardValue: new fields.NumberField({ initial: 0 }),
    };
  }
}
