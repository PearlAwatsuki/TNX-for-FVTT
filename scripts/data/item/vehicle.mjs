/**
 * @fileoverview VehicleDataModel - 乗り物 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible
 * 固有フィールド: speedFactor / passenger / controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.vehicle
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class VehicleDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      speedFactor: new fields.NumberField({ initial: 0 }),
      passenger:   new fields.NumberField({ initial: 0 }),
      controlMod:  new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
