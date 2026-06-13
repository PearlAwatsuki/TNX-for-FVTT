/**
 * @fileoverview ExtensibleTemplate - 拡張スロット(slots)フィールドを定義する template クラス
 *
 * 使用 Item type: weapon / ianus / tron / tap / vehicle / residence
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * フェーズ6-2 で旧 slot[]({label, value, optionId[]})からプール方式に再設計
 * (2026-06-12 ユーザー確定)。ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md
 *
 * - 装備される側のスロットに名前は基本的にない(一律「スロット」= kind: normal)。
 *   例外は IANUS の意識スロット 3 種(表層意識/深層意識/無意識)と、
 *   タップのソフトウェアスロット・ハードウェアスロットのみ。
 * - スロットを持つアイテム側は**スロット数のみ**を設定する。オプションの装備連携
 *   (どのオプションがどのスロットを使っているか)はシート側で扱い、本フィールドには持たない。
 * - 型ごとの既定プール(weapon 等は normal のみ、ianus は normal + 意識 3 種、
 *   tap は software + hardware)の生成はシート側に委ねる。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { modeValueField } from "../helpers.mjs";

/**
 * スロット種別(2026-06-12 ユーザー確定)。
 * @type {Readonly<Record<string, string>>}
 */
export const SLOT_KINDS = Object.freeze({
  normal:      "スロット",
  surface:     "表層意識",
  deep:        "深層意識",
  unconscious: "無意識",
  software:    "ソフトウェア",
  hardware:    "ハードウェア",
});

export class ExtensibleTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      slots: new fields.ArrayField(
        new fields.SchemaField({
          kind: new fields.StringField({
            required: true,
            blank: false,
            initial: "normal",
            choices: SLOT_KINDS,
          }),
          count: modeValueField(["none", "value"]),
        })
      ),
    };
  }

  /** @override — slots[].count を旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    if (Array.isArray(source.slots)) {
      for (const slot of source.slots) {
        if (slot && typeof slot.count === "number") {
          const n = slot.count;
          slot.count = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
        }
      }
    }
    return super.migrateData(source);
  }
}
