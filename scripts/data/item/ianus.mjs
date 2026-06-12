/**
 * @fileoverview IanusDataModel - イアヌス Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible
 * 固有フィールド: controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.ianus
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class IanusDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      controlMod: new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
