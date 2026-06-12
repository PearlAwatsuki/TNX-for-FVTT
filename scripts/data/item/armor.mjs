/**
 * @fileoverview ArmorDataModel - 防具 Item の DataModel
 *
 * 使用 template: base + outfitBase
 * 固有フィールド: defence(S/P/I) / controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.armor
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { defenceField } from "./helpers.mjs";

export class ArmorDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      defence:    defenceField(),
      controlMod: new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
