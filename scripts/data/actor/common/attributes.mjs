/**
 * @fileoverview AttributesTemplate - Actor の能力値・ダメージ・戦闘速度を定義する template クラス
 *
 * 使用 Actor type: cast / guest / troop
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.attributes
 */

import { SystemDataModel } from "../../abstract.mjs";
import {
  attributeField, combatSpeedField, resolveCombatSpeedDisplayTotal,
  actionRankField, ACTION_RANK_GRANT,
  isActorInStartedCombat,
} from "../../helpers.mjs";

export class AttributesTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      reason:  attributeField(),
      passion: attributeField(),
      life:    attributeField(),
      mundane: attributeField(),
      combatSpeed: combatSpeedField(),
      actionRank:  actionRankField(),
      // フォーカスシステム(FS判定)関連の実値。progressBonus＝次に行う進行判定の獲得進行値への加算
      // (2026-08-05)。素値は常に0で、支援判定成功で対象へ付与される支援 AE がネイティブ適用で加算する
      // (change: system.focus.progressBonus +1)。進行判定時に読み取って加算し、その AE を除去して消費する。
      // アクター上の素の system.* 効果はカスタム適用パス(_applyEffectBuffs の self 分岐)では空返しのため、
      // ネイティブ適用のみが効く=二重加算なし。カット終了での自動失効はフェーズ15。
      focus: new fields.SchemaField({
        progressBonus: new fields.NumberField({ initial: 0, integer: true }),
      }),
      // ダメージ系は max の初期値が 21(template.json 準拠)のため damageField() は使わず直接定義
      physicalDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
      mentalDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
      socialDamage: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        min:   new fields.NumberField({ initial: 0 }),
        max:   new fields.NumberField({ initial: 21 }),
      }),
    };
  }

  /**
   * @override
   * CS 3層・AR の素の実効値(フェーズ10-5 / 11)。決定値＋freeMod のみのフォールバックで、
   * initiative 式(@system.combatSpeed.valueTotal)が cast 以外(guest/troop)でも解決できるよう
   * 共通側に置く。cast は CastDataModel._prepareCombatSpeedTotals がアウトフィット修正・
   * ゴースト読み飛ばし込みで上書きし、AR も AE(ar.max)適用後に 0clamp し直す。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    const inCombat = isActorInStartedCombat(this.parent);
    // AR は付与型(Combat_Flow.md「アクションランク」): 基準の入力欄を持たず、定数＋修正で派生する。
    // カット進行外は AR の値を持たない(表示「なし」・2026-07-03 裁定)——表示分岐はテンプレート側。
    const ar = this.actionRank;
    if (ar) {
      ar.grantBase = ACTION_RANK_GRANT; // シート表示用(定数の単一ソース)
      ar.maxTotal  = Math.max(0, ACTION_RANK_GRANT + (ar.freeMod ?? 0));
      ar.inCombat  = inCombat;
    }
    const cs = this.combatSpeed;
    if (!cs) return;
    cs.baseTotal      = (cs.base ?? 0) + (cs.freeMod ?? 0);
    cs.valueTotal     = cs.value ?? 0;
    cs.currentTotal   = cs.current ?? 0;
    cs.currentBuff    = 0; // CSカレントへのバフ(cs.current の AE)の蓄積先。currentTotal には足さない。
    cs.ghostIgnorable = 0;
    cs.inCombat       = inCombat;
    cs.displayTotal   = resolveCombatSpeedDisplayTotal(cs, cs.inCombat);
  }
}
