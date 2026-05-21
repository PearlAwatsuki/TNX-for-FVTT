/**
 * @fileoverview AttributesTemplate - Actor の能力値・ダメージ・戦闘速度を定義する template クラス
 *
 * 使用 Actor type: cast / guest / troop
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.attributes
 */

import { SystemDataModel } from "../../abstract.mjs";
import { attributeField, combatSpeedField } from "../../helpers.mjs";

export class AttributesTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      reason:  attributeField(),
      passion: attributeField(),
      life:    attributeField(),
      mundane: attributeField(),
      combatSpeed: combatSpeedField(),
      // ダメージ系は max の初期値が 21(template.json 準拠)のため damageField() は使わず直接定義
      physicalDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
      mentalDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
      socialDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
    };
  }
}
