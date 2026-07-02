/**
 * @fileoverview AttributesTemplate - Actor の能力値・ダメージ・戦闘速度を定義する template クラス
 *
 * 使用 Actor type: cast / guest / troop
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.attributes
 */

import { SystemDataModel } from "../../abstract.mjs";
import { attributeField, combatSpeedField, resolveCombatSpeedDisplayTotal, isActorInStartedCombat } from "../../helpers.mjs";

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
   * CS 3層の素の実効値(フェーズ10-5)。決定値＋freeMod のみのフォールバックで、
   * initiative 式(@system.combatSpeed.valueTotal)が cast 以外(guest/troop)でも解決できるよう
   * 共通側に置く。cast は CastDataModel._prepareCombatSpeedTotals がアウトフィット修正・
   * ゴースト読み飛ばし込みで上書きする。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    const cs = this.combatSpeed;
    if (!cs) return;
    cs.baseTotal      = (cs.base ?? 0) + (cs.freeMod ?? 0);
    cs.valueTotal     = cs.value ?? 0;
    cs.currentTotal   = cs.current ?? 0;
    cs.ghostIgnorable = 0;
    cs.inCombat       = isActorInStartedCombat(this.parent);
    cs.displayTotal   = resolveCombatSpeedDisplayTotal(cs, cs.inCombat);
  }
}
