/**
 * @fileoverview NeuroCardsDataModel - ニューロカード Card の DataModel
 *
 * 使用 template: base
 * 固有フィールド: なし
 * suit / value / face 等は Foundry Card document のコアフィールドであり system 側には持たせない。
 *
 * 準拠データ: template.json > Card(types 配列の "neuroCards"、base テンプレート使用)
 */

import { SystemDataModel } from "../abstract.mjs";
import { CardBaseTemplate } from "./common/base.mjs";

export class NeuroCardsDataModel extends SystemDataModel.mixin(CardBaseTemplate) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
    };
  }
}
