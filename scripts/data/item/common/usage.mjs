/**
 * @fileoverview UsageTemplate - 用途(Action)リストを定義する template クラス
 *
 * 使用 Item type: miracle / generalSkill / styleSkill /
 *                weapon / armor / ianus / cyborg / tron / tap /
 *                vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * actions[].type の値域:
 *   "check"        - 通常の技能・能力判定
 *   "controlCheck" - 制御判定（下方判定。カード値 ≤ 制御値で成功）
 *   "attack"       - 攻撃
 *   "declaration"  - 宣言
 *   "miracle"      - 神業
 *   ※ リアクション: type ではなく timing フィールドで区別（D&D 方式）
 *
 * actions[].skillRefs: 技能組み合わせ判定のベース以外の技能 item ID リスト。
 *   空配列 = 単独判定。ベース技能はこの用途を所持するアイテム自身。
 *   フェーズ8 追加。既存データへの影響なし（空配列デフォルト）。
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
          skillRefs:   new fields.ArrayField(
            new fields.SchemaField({
              itemId: new fields.StringField({ initial: "" }),
            })
          ),
        })
      ),
    };
  }
}
