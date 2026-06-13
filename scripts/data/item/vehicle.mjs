/**
 * @fileoverview VehicleDataModel - 乗り物 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: attack / defence / speedFactor / passenger / controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.vehicle
 *
 * フェーズ6-4 の変更(2026-06-13 ユーザー確定):
 * - attack(攻撃力)/ defence(防御値)を追加。概要表記順は 購/隠/攻/SF/防/制/乗員/ス/電制/部位。
 * - speedFactor(SF、移動力): 数字分の段階移動ができる。
 * - passenger(乗員): 操縦者を含む乗車可能人数。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { attackField, defenceField } from "./helpers.mjs";

export class VehicleDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      attack:      attackField(),
      defence:     defenceField(),
      speedFactor: new fields.NumberField({ initial: 0 }),
      passenger:   new fields.NumberField({ initial: 0 }),
      controlMod:  new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
