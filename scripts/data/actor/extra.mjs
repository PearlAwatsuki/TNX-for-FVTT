/**
 * @fileoverview ExtraDataModel - エキストラ Actor の DataModel
 *
 * 使用 template: biography のみ
 * 固有フィールドなし。
 *
 * 準拠データ: template.json > Actor.extra
 */

import { SystemDataModel } from "../abstract.mjs";
import { BiographyTemplate } from "./common/biography.mjs";

export class ExtraDataModel extends SystemDataModel.mixin(
  BiographyTemplate
) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
    };
  }
}
