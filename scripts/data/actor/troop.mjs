/**
 * @fileoverview TroopDataModel - トループ Actor の DataModel
 *
 * 使用 template: attributes + actorBase
 * 固有フィールド: memo / heads
 *
 * 準拠データ: template.json > Actor.troop
 *
 * 注意:
 * - heads(人数)はトループにおいて HP のように機能する(フェーズ6-0 で追加)。
 *   トークンのリソースバーに割り当てるため {value, max} 構造とする。
 *   バー割り当ての UI 連携はフェーズ6-8(troop シート)で行う。
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
      heads: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
    };
  }
}
