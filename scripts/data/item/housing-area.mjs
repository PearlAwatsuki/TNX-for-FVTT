/**
 * @fileoverview HousingAreaDataModel - 居住区 Item の DataModel
 *
 * 使用 template: base
 * 固有フィールド: buyRatingMod / preserveExpMod / appearanceTargetMod /
 *               cyberSecurityMod / analogSecurityMod
 *
 * 準拠データ: template.json > Item.housingArea
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";

export class HousingAreaDataModel extends SystemDataModel.mixin(BaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      buyRatingMod:        new fields.NumberField({ initial: 0 }),
      preserveExpMod:      new fields.NumberField({ initial: 0 }),
      appearanceTargetMod: new fields.NumberField({ initial: 0 }),
      cyberSecurityMod:    new fields.NumberField({ initial: 0 }),
      analogSecurityMod:   new fields.NumberField({ initial: 0 }),
    };
  }
}
