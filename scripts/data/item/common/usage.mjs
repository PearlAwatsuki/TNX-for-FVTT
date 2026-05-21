/**
 * @fileoverview UsageTemplate - 用途(Action)リストを定義する template クラス
 *
 * 使用 Item type: miracle / generalSkill / styleSkill
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * 準拠データ: template.json > Item.templates.usage
 * 設計方針: docs/DESIGN_REVIEW.md B-0「論点3: 共通 template の継承戦略」参照
 *
 * actions 配列要素の構造は scripts/item/tnx-item-sheet.mjs の _onActionCreate() から読み取った:
 *   { type: string, name: string, description: string }
 * type の値域は "check" / "declaration" / "miracle" (TokyoNovaItemSheet.usageTypes 参照)。
 * 将来的に type を StringField ではなく選択肢付きの型に変更する可能性があるが、
 * B-2 ではまず忠実に再現する。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class UsageTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      actions: new fields.ArrayField(
        new fields.SchemaField({
          type:        new fields.StringField({ initial: "" }),
          name:        new fields.StringField({ initial: "" }),
          description: new fields.StringField({ initial: "" }),
        })
      ),
    };
  }
}
