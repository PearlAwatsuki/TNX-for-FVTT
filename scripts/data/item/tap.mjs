/**
 * @fileoverview TapDataModel - タップ(電子機器)Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: cycle / combatSpeedMod / identificationKey
 *
 * 準拠データ: template.json > Item.tap
 *
 * 注意:
 * - template.json では `conbatSpeedMod`(KI-007 のタイポ)だったが、
 *   本 DataModel では正しい綴り `combatSpeedMod` で定義する。
 *   実運用前のためマイグレーションは不要。
 * - combatSpeedMod は単一の {mode,value}。Actor 側の combatSpeedField()
 *   (scripts/data/helpers.mjs、5 フィールド構造)とは別物。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { modeValueField } from "./helpers.mjs";

export class TapDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      cycle:          modeValueField(["none", "value"]),
      combatSpeedMod: modeValueField(["none", "value"]),
      // 「ゴースト時は適用しない」(フェーズ10-5・2026-07-02 裁定): CS 修正の適用を一元化するフラグ。
      // OFF(既定)=一般原則どおり準備起点・ゴースト無関係(オリジナルデータ基準)。
      // ON=携帯起点・ゴースト登場中は読み飛ばし・説明タブの CS 表示を（）で囲む(原作の括弧書き表記)。
      combatSpeedModGhostIgnore: new foundry.data.fields.BooleanField({ initial: false }),
      identificationKey: new foundry.data.fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    for (const key of ["cycle", "combatSpeedMod"]) {
      if (typeof source[key] === "number") {
        const n = source[key];
        source[key] = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
      }
    }
    return super.migrateData(source);
  }
}
