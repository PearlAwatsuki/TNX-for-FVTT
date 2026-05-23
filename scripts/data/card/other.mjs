/**
 * @fileoverview OtherDataModel - その他カード Card の DataModel
 *
 * 使用 template: base
 * 固有フィールド: なし
 *
 * 準拠データ: template.json > Card(types 配列の "other"、base テンプレート使用)
 */

import { SystemDataModel } from "../abstract.mjs";
import { CardBaseTemplate } from "./common/base.mjs";

export class OtherDataModel extends SystemDataModel.mixin(CardBaseTemplate) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
    };
  }
}
