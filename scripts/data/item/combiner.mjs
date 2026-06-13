/**
 * @fileoverview CombinerDataModel - コンバイナ Item の DataModel
 *
 * 使用 template: base + outfitBase + usage
 * 固有フィールド: combine(source1 / source2 / appearance) / identificationKey
 *
 * 準拠データ: template.json > Item.combiner
 *
 * コンバイナーは指定された二つのアウトフィットを組み合わせて一つとして扱う(2026-06-13 ユーザー確定)。
 * - combine.source1 / source2: コンバイン元アウトフィットの UUID。
 * - combine.appearance: 見た目に採用する元("1" = source1 / "2" = source2)。
 * - コンバイナー本体のパラメータ(outfitBase)は完全に一般アウトフィットのもの。
 * - 合成結果(部位は両方を占有、分類は両方を継承、電制は高い方、隠は X(Y))の算出と表示は
 *   シート側の「コンバインプレビュー」で行う。パラメータの取捨選択 UI は設計確認後に拡張する。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";

export class CombinerDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      combine: new fields.SchemaField({
        source1:    new fields.StringField({ initial: "" }),
        source2:    new fields.StringField({ initial: "" }),
        appearance: new fields.StringField({
          required: true,
          blank: false,
          initial: "1",
          choices: ["1", "2"],
        }),
        // 両方の元に存在し値が食い違うパラメータの取捨選択("1" = source1 / "2" = source2)
        params: new fields.SchemaField({
          appearancePenalty: new fields.StringField({ initial: "1" }),
          controlMod:        new fields.StringField({ initial: "1" }),
          attack:            new fields.StringField({ initial: "1" }),
          defence:           new fields.StringField({ initial: "1" }),
          guardValue:        new fields.StringField({ initial: "1" }),
          range:             new fields.StringField({ initial: "1" }),
          speedFactor:       new fields.StringField({ initial: "1" }),
          passenger:         new fields.StringField({ initial: "1" }),
        }),
      }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
