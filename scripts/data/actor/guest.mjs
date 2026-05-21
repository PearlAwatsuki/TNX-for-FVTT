/**
 * @fileoverview GuestDataModel - ゲスト Actor の DataModel
 *
 * 使用 template: biography + attributes + actorBase
 * 固有フィールドなし。
 *
 * 準拠データ: template.json > Actor.guest
 */

import { SystemDataModel } from "../abstract.mjs";
import { BiographyTemplate } from "./common/biography.mjs";
import { AttributesTemplate } from "./common/attributes.mjs";
import { ActorBaseTemplate } from "./common/actor-base.mjs";

export class GuestDataModel extends SystemDataModel.mixin(
  BiographyTemplate, AttributesTemplate, ActorBaseTemplate
) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
    };
  }
}
