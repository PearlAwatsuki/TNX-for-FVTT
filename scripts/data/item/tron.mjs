/**
 * @fileoverview TronDataModel - トロン Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible
 * 固有フィールド: identificationKey
 *
 * 準拠データ: template.json > Item.tron
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class TronDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
