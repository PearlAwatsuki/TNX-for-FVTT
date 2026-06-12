/**
 * @fileoverview GeneralDataModel - 一般装備 Item の DataModel
 *
 * 使用 template: base + outfitBase
 * 固有フィールド: identificationKey
 *
 * 準拠データ: template.json > Item.general
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";

export class GeneralDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
