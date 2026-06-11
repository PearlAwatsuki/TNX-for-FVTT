/**
 * @fileoverview CastDataModel - キャスト Actor の DataModel
 *
 * 使用 template: biography + attributes + actorBase
 * 固有フィールド: player_name / ownerUserId / history / exp / lifePath
 *
 * 準拠データ: template.json > Actor.cast
 *
 * 注意:
 * - exp の value / spent / total は updateCastExp() が非同期で上書きする派生値。
 *   DataModel 内での prepareDerivedData による再計算は行わない。
 * - player_name は template.json に定義されているが実コードでは未使用(デッドフィールド)。
 * - lifePath の各スロットは origin/experience/encounter で構成され、フェーズ 5-6 で UI 実装済み。
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
      player_name:   new fields.StringField({ initial: "" }),
      ownerUserId:   new fields.StringField({ initial: "" }),
      syncWithOwner: new fields.BooleanField({ initial: true }),
      history:     new fields.ObjectField(),
      exp: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 170 }),
        spent:      new fields.NumberField({ initial: -170 }),
        total:      new fields.NumberField({ initial: 0 }),
        additional: new fields.NumberField({ initial: 0 }),
      }),
      lifePath: new fields.SchemaField({
        origin: new fields.SchemaField({
          itemUuid: new fields.StringField({ initial: "" }),
          name:     new fields.StringField({ initial: "" }),
          summary:  new fields.StringField({ initial: "" }),
        }),
        experience: new fields.SchemaField({
          itemUuid: new fields.StringField({ initial: "" }),
          name:     new fields.StringField({ initial: "" }),
          summary:  new fields.StringField({ initial: "" }),
        }),
        encounter: new fields.SchemaField({
          itemUuid: new fields.StringField({ initial: "" }),
          name:     new fields.StringField({ initial: "" }),
          summary:  new fields.StringField({ initial: "" }),
        }),
      }),
      bounty: new fields.NumberField({ initial: 0, min: 0, integer: true }),
    };
  }
}
