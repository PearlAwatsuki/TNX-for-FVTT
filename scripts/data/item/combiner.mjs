/**
 * @fileoverview CombinerDataModel - コンバイナ Item の DataModel
 *
 * 使用 template: base + outfitBase + usage
 * 固有フィールド: combinedOutfitID(装備 Item ID の配列) / identificationKey
 *
 * 準拠データ: template.json > Item.combiner
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";

export class CombinerDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      combinedOutfitID: new fields.ArrayField(new fields.StringField()),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
