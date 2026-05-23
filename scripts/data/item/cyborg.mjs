/**
 * @fileoverview CyborgDataModel - サイバーウェア Item の DataModel
 *
 * 使用 template: base + outfitBase
 * 固有フィールド: defence(S/P/I) / attack / guardValue
 *
 * 準拠データ: template.json > Item.cyborg
 *
 * 注意:
 * - attack フィールドは B-6a で attackField() ヘルパーに切り出し済み(cyborg / weapon 共用)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { defenceField, attackField } from "./helpers.mjs";

export class CyborgDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      defence:    defenceField(),
      attack:     attackField(),
      guardValue: new foundry.data.fields.NumberField({ initial: 0 }),
    };
  }
}
