/**
 * @fileoverview WeaponDataModel - 武器 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible
 * 固有フィールド: attack / guardValue / range / isthrow / isLaser / isBiological /
 *               isFullAuto / FAValue / identificationKey
 *
 * 準拠データ: template.json > Item.weapon
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { attackField } from "./helpers.mjs";

export class WeaponDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      attack:      attackField(),
      guardValue:  new fields.NumberField({ initial: 0 }),
      range:       new fields.StringField({ initial: "-" }),
      isthrow:     new fields.BooleanField({ initial: false }),
      isLaser:     new fields.BooleanField({ initial: false }),
      isBiological: new fields.BooleanField({ initial: false }),
      isFullAuto:  new fields.BooleanField({ initial: false }),
      FAValue:     new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
