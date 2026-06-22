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
import { ATTACK_DAMAGE_TYPES, parseEffectTargetKey, resolveItemTotalPath, evalEffectConditions } from "../item/helpers.mjs";
import { readConditions, gatherConditionControlPenalty } from "../../module/conditions.mjs";

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
   * 値バフ(AE)は _applyEffectBuffs が total へ直接適用する(フェーズ9-3 v2、effectMod 着地は廃止)。
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
    // バフ(ActiveEffect)を total へ直接適用 → コンディション(衰弱・酩酊)の全制御値減 → 0clamp
    this._applyEffectBuffs();
    this._applyConditionControlPenalty();
    for (const key of ABILITY_KEYS) {
      this[key].total        = Math.max(0, this[key].total);
      this[key].totalControl = Math.max(0, this[key].totalControl);
    }
  }

  /**
   * コンディション(BS)による全制御値の減少を totalControl に適用する(フェーズ9-4)。
   * 衰弱・酩酊。アクター自身＋全所有アイテムの effects から condition を読む。0clamp は呼び出し側。
   */
  _applyConditionControlPenalty() {
    const actor = this.parent;
    if (!actor) return;
    const conditions = [];
    for (const e of (actor.effects ?? [])) conditions.push(...readConditions(e));
    for (const item of (actor.items ?? [])) {
      for (const e of (item.effects ?? [])) conditions.push(...readConditions(e));
    }
    const penalty = gatherConditionControlPenalty(conditions);
    if (!penalty) return;
    for (const key of ABILITY_KEYS) this[key].totalControl -= penalty;
  }

  /**
   * 値バフ(ActiveEffect)を v2 キー文法で解決して**実効値 total へ直接適用**する(フェーズ9-3 v2)。
   * 対象スコープ: ability/control(キャラ値)・self(効果の親アイテム)・parent(その親アウトフィット)・
   *   category:<小分類/大分類キー>・skill:<識別キー[*]>(レベル等)。条件 [path op value] も評価する。
   * モード(ADD/OVERRIDE/MULTIPLY 等)は effect.apply でネイティブ処理し、priority 順に適用。
   *
   * - **判定バフ(check./controlCheck.)は判定実行時に評価する別系統**のためここでは扱わない。
   * - アクター自身＋全所有アイテムの effects を走査(transfer 非依存)。アイテム/能力値の base→total は
   *   既に算出済みで、ここで total を改変する(base は不変)。0clamp は呼び出し側で適用後に行う。
   */
  _applyEffectBuffs() {
    const actor = this.parent;
    if (!actor?.items) return;
    const CHECK_SCOPES = new Set(["abilityCheck", "controlCheck", "skillCheck"]);

    const entries = [];
    const collect = (effects, bearer) => {
      for (const effect of (effects ?? [])) {
        if (!effect.active) continue;
        for (const change of (effect.changes ?? [])) {
          const parsed = parseEffectTargetKey(change.key);
          if (!parsed || CHECK_SCOPES.has(parsed.scope)) continue;
          entries.push({ effect, change, parsed, bearer });
        }
      }
    };
    collect(actor.effects, actor);
    for (const item of actor.items) collect(item.effects, item);
    if (!entries.length) return;
    const SCOPE = "tokyo-nova-axleration";

    // 適用先へ展開(条件評価込み)
    const apps = [];
    for (const { effect, change, parsed, bearer } of entries) {
      const identity  = effect.flags?.[SCOPE]?.effectId || effect.id;
      const stackable = effect.flags?.[SCOPE]?.stackable === true;
      for (const { doc, totalPath } of this._resolveBuffApplications(parsed, bearer)) {
        if (!evalEffectConditions(doc.system, parsed.conditions)) continue;
        apps.push({ effect, change, doc, totalPath, identity, stackable });
      }
    }

    // 同一効果の重複適用不可: 非 stackable は (対象, パス, モード, identity)ごとに最大値1つだけ。
    // stackable は重複排除しない。
    const best = new Map();
    const finalApps = [];
    for (const app of apps) {
      if (app.stackable) { finalApps.push(app); continue; }
      const k = `${app.doc.id}|${app.totalPath}|${app.change.mode}|${app.identity}`;
      const prev = best.get(k);
      if (!prev || (Number(app.change.value) || 0) > (Number(prev.change.value) || 0)) best.set(k, app);
    }
    for (const app of best.values()) finalApps.push(app);

    // Foundry 既定の優先度(mode×10)で安定適用する
    finalApps.sort((a, b) =>
      ((a.change.priority ?? a.change.mode * 10) - (b.change.priority ?? b.change.mode * 10)));
    for (const { effect, change, doc, totalPath } of finalApps) {
      effect.apply(doc, { ...change, key: `system.${totalPath}` });
    }
  }

  /** v2 セレクタを {適用先ドキュメント, total系systemパス} の配列へ解決する。 */
  _resolveBuffApplications(parsed, bearer) {
    const actor = this.parent;
    const items = actor?.items;
    if (!items) return [];
    const itemApp = (item) => ({ doc: item, totalPath: resolveItemTotalPath(parsed.path) });
    switch (parsed.scope) {
      case "ability": return [{ doc: actor, totalPath: `${parsed.path}.total` }];
      case "control": return [{ doc: actor, totalPath: `${parsed.path}.totalControl` }];
      case "self":
        return bearer?.documentName === "Item" ? [itemApp(bearer)] : [];
      case "parent": {
        const pid = bearer?.system?.parentItemId;
        const p = pid ? items.get(pid) : null;
        return p ? [itemApp(p)] : [];
      }
      case "category":
        return [...items].filter(i =>
          i.system?.minorCategory === parsed.selector || i.system?.majorCategory === parsed.selector).map(itemApp);
      case "skill":
        return [...items].filter(i => parsed.prefix
          ? i.system?.identificationKey?.startsWith?.(parsed.selector)
          : i.system?.identificationKey === parsed.selector).map(itemApp);
      default:
        return [];
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
