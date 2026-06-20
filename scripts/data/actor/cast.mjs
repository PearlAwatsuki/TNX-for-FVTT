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
import { computeAttributeFinal, computeOutfitAggregates } from "../helpers.mjs";
import { ATTACK_DAMAGE_TYPES, matchesAeTarget, addToItemTotal } from "../item/helpers.mjs";

/** モードB(アクター→アイテム横断バフ)の AE flag スコープ・キー */
const AE_TARGET_SCOPE = "tokyo-nova-axleration";
const AE_TARGET_KEY   = "aeTarget";

/** 能力値キー(♠理性 / ♣感情 / ♥生命 / ♦外界) */
const ABILITY_KEYS = ["reason", "passion", "life", "mundane"];

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

  /**
   * @override
   * 能力値・制御値の最終実効値(total / totalControl)を派生計算で一本化する。
   * これまでシート表示・判定・mundane 算出が各自で同じ式を再計算しており(うち判定は
   * 実在しない system.equipped フィルタでスタイル基本値が欠落していた、KI-021)、
   * ここを単一の真実とする。各消費箇所は system.<key>.total / .totalControl を読む。
   *
   * outfitMod / appearanceModifier はフックでの DB 書き戻し(syncing)をやめ、ここで
   * 携帯中アウトフィットから都度算出する(B-2)。能力値 total が outfitMod を読むため先に計算する。
   * AE は effectMod / controlEffectMod に着地して合算される(フェーズ9-3)。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    this._prepareOutfitAggregates();
    const styleItems = this.parent?.items?.filter(i => i.type === "style") ?? [];
    const outfitMod  = this.outfitMod ?? {};
    for (const key of ABILITY_KEYS) {
      const styles = styleItems.map(s => ({
        value:   s.system[key]?.value,
        control: s.system[key]?.control,
        level:   s.system.level,
      }));
      const { total, totalControl } = computeAttributeFinal(
        this[key], styles, outfitMod[key] ?? 0, outfitMod.control ?? 0
      );
      this[key].total        = total;
      this[key].totalControl = totalControl;
    }
    this._applyCrossTargetEffects();
  }

  /**
   * モードB: アクターに乗る AE(flag aeTarget)を、所有アイテムへ横断適用する(フェーズ9-3)。
   * アイテム自身の prepareDerivedData は既に走り `.total` が算出済みのため、ここでは
   * 一致アイテムの total に加算注入する(base は触らない)。アイテム横断は素の Foundry AE
   * changes では解決できないため、flag ＋ カスタム照合で表現する(→ Active_Effects.md)。
   */
  _applyCrossTargetEffects() {
    const actor = this.parent;
    if (!actor?.effects || !actor.items) return;
    const specs = [];
    for (const effect of actor.effects) {
      if (effect.disabled) continue;
      const spec = effect.flags?.[AE_TARGET_SCOPE]?.[AE_TARGET_KEY];
      if (spec && spec.param) specs.push(spec);
    }
    if (!specs.length) return;
    for (const item of actor.items) {
      for (const spec of specs) {
        if (matchesAeTarget(item, spec)) addToItemTotal(item.system, spec.param, Number(spec.value) || 0);
      }
    }
  }

  /**
   * 携帯中アウトフィットから outfitMod(制御値修正・CS修正)・appearanceModifier(危険値合計)を
   * 派生算出する(B-2)。派生値は永続化せず prepareDerivedData で都度算出するため、
   * 旧来のフック書き戻し(updateCastOutfitMods / updateCastAppearanceModifier)は撤去した。
   * 能力値の reason/passion/life/mundane への outfitMod は常に 0(現行ルール上、
   * アウトフィットは制御値・CS のみ修正する)。
   */
  _prepareOutfitAggregates() {
    const { control, combatSpeed, appearance } =
      computeOutfitAggregates(this.parent?.items ?? [], this.isGhost);
    this.outfitMod.control     = control;
    this.outfitMod.combatSpeed = combatSpeed;
    this.outfitMod.reason  = 0;
    this.outfitMod.passion = 0;
    this.outfitMod.life    = 0;
    this.outfitMod.mundane = 0;
    this.appearanceModifier = appearance;
  }
}
