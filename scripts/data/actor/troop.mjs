/**
 * @fileoverview TroopDataModel - トループ Actor の DataModel
 *
 * 使用 template: attributes + actorBase
 * 固有フィールド: memo
 *
 * 準拠データ: template.json > Actor.troop
 */

import { SystemDataModel } from "../abstract.mjs";
import { AttributesTemplate } from "./common/attributes.mjs";
import { ActorBaseTemplate } from "./common/actor-base.mjs";

export class TroopDataModel extends SystemDataModel.mixin(
  AttributesTemplate, ActorBaseTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      memo: new fields.StringField({ initial: "" }),
    };
  }
}
