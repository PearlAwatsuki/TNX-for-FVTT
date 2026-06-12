/**
 * @fileoverview ResidenceDataModel - 住居 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: appearanceTarget / cyberSecurity / analogSecurity / housingArea /
 *               buyRatingMod / preserveExpMod / appearanceTargetMod /
 *               cyberSecurityMod / analogSecurityMod / identificationKey
 *
 * 準拠データ: template.json > Item.residence
 *
 * 注意:
 * - *Mod フィールドは housingArea Item(HousingAreaDataModel)にも同名・同型のフィールドが
 *   存在するが、単一 NumberField のためヘルパー化はしない。
 * - housingArea フィールドは housingArea Item の ID(文字列)を格納する。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class ResidenceDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      appearanceTarget:    new fields.NumberField({ initial: 0 }),
      cyberSecurity:       new fields.NumberField({ initial: 0 }),
      analogSecurity:      new fields.NumberField({ initial: 0 }),
      housingArea:         new fields.StringField({ initial: "" }),
      buyRatingMod:        new fields.NumberField({ initial: 0 }),
      preserveExpMod:      new fields.NumberField({ initial: 0 }),
      appearanceTargetMod: new fields.NumberField({ initial: 0 }),
      cyberSecurityMod:    new fields.NumberField({ initial: 0 }),
      analogSecurityMod:   new fields.NumberField({ initial: 0 }),
      identificationKey:   new fields.StringField({ initial: "" }),
    };
  }
}
