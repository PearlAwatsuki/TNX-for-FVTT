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
import { ATTACK_DAMAGE_TYPES, matchesAeTarget, addToItemEffectMod, parseCrossTargetKey, computeItemEffectiveValues } from "../item/helpers.mjs";

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
      // 手札上限への AE 修正(KI-020・層③)。手札上限の権威は User flag にあるが User は
      // DataModel/AE を持てないため、所有 cast の AE がここに着地し(ADD)、
      // resolveEffectiveHandMaxSize が所有ユーザーの cast から合算する。
      handMaxSizeMod: new fields.NumberField({ initial: 0, integer: true }),
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
   * モードB: 横断バフ(アクター/アイテムに乗る AE)を所有アイテムへ適用する(フェーズ9-3)。
   * 2つの指定方法を扱う:
   * 1. **changes キー `<識別キー>.<systemパス>`**（例 "hisho-geki.attack.effectMod"）。
   *    その識別キーを持つアイテムの該当パスへ `effect.apply` で適用(mode/value はネイティブ処理)。
   * 2. **flag `aeTarget`**（型/大分類/小分類/識別キーで対象指定 ＋ param/value）。effectMod へ加算。
   *
   * アクター自身＋全所有アイテムの effects を走査する(transfer の有無に依らない)。アイテム横断は
   * 素の Foundry change.key では別アイテムに解決できないため、ここでカスタム適用する。
   * 着地点 effectMod に積んだ後、触れたアイテムの実効値(total)を再計算する。
   */
  _applyCrossTargetEffects() {
    const actor = this.parent;
    if (!actor?.items) return;
    const effects = [...(actor.effects ?? [])];
    for (const item of actor.items) for (const e of (item.effects ?? [])) effects.push(e);

    const touched = new Set();
    for (const effect of effects) {
      if (!effect.active) continue;
      // 1. changes キー <識別キー>.<パス>
      for (const change of (effect.changes ?? [])) {
        const parsed = parseCrossTargetKey(change.key);
        if (!parsed) continue;
        for (const item of actor.items) {
          if (item.system?.identificationKey && item.system.identificationKey === parsed.identKey) {
            effect.apply(item, { ...change, key: `system.${parsed.path}` });
            touched.add(item);
          }
        }
      }
      // 2. flag aeTarget(型/分類/識別キー指定)
      const spec = effect.flags?.[AE_TARGET_SCOPE]?.[AE_TARGET_KEY];
      if (spec?.param) {
        for (const item of actor.items) {
          if (matchesAeTarget(item, spec)) {
            addToItemEffectMod(item.system, spec.param, Number(spec.value) || 0);
            touched.add(item);
          }
        }
      }
    }
    for (const item of touched) computeItemEffectiveValues(item.system);
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
