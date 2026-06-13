/**
 * @fileoverview ArmorDataModel - 防具 Item の DataModel
 *
 * 使用 template: base + outfitBase + usage
 * 固有フィールド: defence(mode/S/P/I) / controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.armor
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { defenceField, modeValueField } from "./helpers.mjs";

export class ArmorDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      defence:    defenceField(),
      controlMod: modeValueField(["none", "value"]),
      identificationKey: new foundry.data.fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    if (typeof source.controlMod === "number") {
      const n = source.controlMod;
      source.controlMod = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
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
