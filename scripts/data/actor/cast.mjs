/**
 * @fileoverview CastDataModel - キャスト Actor の DataModel
 *
 * 使用 template: biography + attributes + actorBase
 * 固有フィールド: player_name / playerId / history / exp / lifePath
 *
 * 準拠データ: template.json > Actor.cast
 *
 * 注意:
 * - exp の value / spent / total は updateCastExp() が非同期で上書きする派生値。
 *   DataModel 内での prepareDerivedData による再計算は行わない。
 * - player_name は template.json に定義されているが実コードでは未使用(デッドフィールド)。
 * - lifePath は UI 未実装(B-4 では template.json 準拠で定義のみ)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BiographyTemplate } from "./common/biography.mjs";
import { AttributesTemplate } from "./common/attributes.mjs";
import { ActorBaseTemplate } from "./common/actor-base.mjs";

export class CastDataModel extends SystemDataModel.mixin(
  BiographyTemplate, AttributesTemplate, ActorBaseTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      player_name: new fields.StringField({ initial: "" }),
      playerId:    new fields.StringField({ initial: "" }),
      history:     new fields.ObjectField(),
      exp: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 170 }),
        spent:      new fields.NumberField({ initial: -170 }),
        total:      new fields.NumberField({ initial: 0 }),
        additional: new fields.NumberField({ initial: 0 }),
      }),
      lifePath: new fields.SchemaField({
        origin:     new fields.StringField({ initial: "" }),
        experience: new fields.StringField({ initial: "" }),
        encounter:  new fields.StringField({ initial: "" }),
      }),
    };
  }
}
