/**
 * @fileoverview ExtensibleTemplate - 拡張スロット(slot)フィールドを定義する template クラス
 *
 * 使用 Item type: weapon / ianus / tron / tap / vehicle / residence / combiner
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * 準拠データ: template.json > Item.templates.extensible
 * 設計方針: docs/DESIGN_REVIEW.md B-0「論点3: 共通 template の継承戦略」参照
 *
 * フィールド型の判断:
 * - slot[].value は template.json の初期値が 0(数値)のため NumberField。
 * - slot[].optionId は文字列 ID の配列のため ArrayField(StringField)。
 * - slot の初期値: template.json では要素 1 つ入りだが DataModel では [] とし、
 *   初期スロット追加はシート側に委ねる。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class ExtensibleTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      slot: new fields.ArrayField(
        new fields.SchemaField({
          label:    new fields.StringField({ initial: "" }),
          value:    new fields.NumberField({ initial: 0 }),
          optionId: new fields.ArrayField(new fields.StringField()),
        })
      ),
    };
  }
}
