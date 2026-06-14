/**
 * @fileoverview CastDataModel - キャスト Actor の DataModel
 *
 * 使用 template: biography + attributes + actorBase
 * 固有フィールド: ownerUserId / history / exp / lifePath
 *
 * 準拠データ: template.json > Actor.cast
 *
 * 注意:
 * - exp の value / spent / total は updateCastExp() が非同期で上書きする派生値。
 *   DataModel 内での prepareDerivedData による再計算は行わない。
 * - player_name は旧 template.json 由来のデッドフィールドだったが、フェーズ6-0 で削除確定(2026-06-12)。
 * - lifePath の各スロットは origin/experience/encounter で構成され、フェーズ 5-6 で UI 実装済み。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BiographyTemplate } from "./common/biography.mjs";
import { AttributesTemplate } from "./common/attributes.mjs";
import { ActorBaseTemplate } from "./common/actor-base.mjs";
import { ATTACK_DAMAGE_TYPES } from "../item/helpers.mjs";

export class CastDataModel extends SystemDataModel.mixin(
  BiographyTemplate, AttributesTemplate, ActorBaseTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
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
        }),
        experience: new fields.SchemaField({
          itemUuid: new fields.StringField({ initial: "" }),
          name:     new fields.StringField({ initial: "" }),
        }),
        encounter: new fields.SchemaField({
          itemUuid: new fields.StringField({ initial: "" }),
          name:     new fields.StringField({ initial: "" }),
        }),
      }),
      isGhost:    new fields.BooleanField({ initial: false }),
      bounty:     new fields.NumberField({ initial: 0, integer: true }),
      bountyBase: new fields.NumberField({ initial: 0, integer: true }),
      baseAttack: new fields.SchemaField({
        damageType: new fields.StringField({
          required: true,
          blank: true,
          initial: "I",
          choices: ATTACK_DAMAGE_TYPES,
        }),
        value: new fields.NumberField({ initial: 0 }),
        mod:   new fields.NumberField({ initial: 0 }),
      }),
      baseDefence: new fields.SchemaField({
        S_defence: new fields.NumberField({ initial: 0 }),
        P_defence: new fields.NumberField({ initial: 0 }),
        I_defence: new fields.NumberField({ initial: 0 }),
      }),
      baseGuard: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        mod:   new fields.NumberField({ initial: 0 }),
      }),
      appearanceModifier: new fields.NumberField({ initial: 0, integer: true }),
      outfitMod: new fields.SchemaField({
        control:     new fields.NumberField({ initial: 0, integer: true }),
        reason:      new fields.NumberField({ initial: 0, integer: true }),
        passion:     new fields.NumberField({ initial: 0, integer: true }),
        life:        new fields.NumberField({ initial: 0, integer: true }),
        mundane:     new fields.NumberField({ initial: 0, integer: true }),
        combatSpeed: new fields.NumberField({ initial: 0, integer: true }),
      }),
    };
  }
}
