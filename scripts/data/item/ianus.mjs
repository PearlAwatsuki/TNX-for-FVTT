/**
 * @fileoverview IanusDataModel - イアヌス Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.ianus
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { modeValueField } from "./helpers.mjs";

export class IanusDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      controlMod: modeValueField(["none", "value"]),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    if (typeof source.controlMod === "number") {
      const n = source.controlMod;
      source.controlMod = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    return super.migrateData(source);
  }
}
