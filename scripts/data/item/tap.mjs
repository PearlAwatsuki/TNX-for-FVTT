/**
 * @fileoverview TapDataModel - タップ(電子機器)Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible
 * 固有フィールド: cycle / combatSpeedMod
 *
 * 準拠データ: template.json > Item.tap
 *
 * 注意:
 * - template.json では `conbatSpeedMod`(KI-007 のタイポ)だったが、
 *   本 DataModel では正しい綴り `combatSpeedMod` で定義する。
 *   実運用前のためマイグレーションは不要。
 * - combatSpeedMod は単一の NumberField。Actor 側の combatSpeedField()
 *   (scripts/data/helpers.mjs、5 フィールド構造)とは別物。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class TapDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      cycle:          new fields.NumberField({ initial: 0 }),
      combatSpeedMod: new fields.NumberField({ initial: 0 }),
    };
  }
}
