/**
 * @fileoverview CyborgDataModel - サイバーウェア Item の DataModel
 *
 * 使用 template: base + outfitBase + usage
 * 固有フィールド: defence(mode/S/P/I) / attack / guardValue / identificationKey
 *
 * 準拠データ: template.json > Item.cyborg
 *
 * 注意:
 * - attack フィールドは B-6a で attackField() ヘルパーに切り出し済み(cyborg / weapon 共用)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { defenceField, attackField, modeValueField, migrateAttackModToEffectMod } from "./helpers.mjs";

export class CyborgDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      defence:    defenceField(),
      attack:     attackField(),
      guardValue: modeValueField(["none", "value"]),
      identificationKey: new foundry.data.fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    migrateAttackModToEffectMod(source);
    if (typeof source.guardValue === "number") {
      const n = source.guardValue;
      source.guardValue = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    if (source.defence && source.defence.mode === undefined) {
      const hasVal = (source.defence.S_defence || 0) !== 0
                  || (source.defence.P_defence || 0) !== 0
                  || (source.defence.I_defence || 0) !== 0;
      source.defence.mode = hasVal ? "value" : "none";
    }
    return super.migrateData(source);
  }
}
