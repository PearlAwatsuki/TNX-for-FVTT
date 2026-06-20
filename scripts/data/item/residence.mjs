/**
 * @fileoverview ResidenceDataModel - 住居 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: appearanceTarget / cyberSecurity / analogSecurity / housingArea /
 *               identificationKey
 *
 * 準拠データ: template.json > Item.residence
 *
 * フェーズ6-4 の変更(2026-06-13 ユーザー確定):
 * - 修正値(*Mod)フィールドは住宅エリア(HousingAreaDataModel)の役割のため residence から除去。
 *   住宅施設は基本値(登場判定目標値 / 電脳セキュリティ / アナログセキュリティ)を持ち、
 *   住宅エリアの修正値を組み合わせた実効値の算出はフェーズ6-6(キャストシート)で扱う。
 * - 概要表記順は 購/隠/登場/セ(電／ア)/ス/部位。**危険値(appearancePenalty)と電制(hack)は表示しない**
 *   (危険値は他種別では隠匿値とセットだが住宅施設にはない)。隠は隠匿値のみを表示する。
 *
 * 注意:
 * - appearanceTarget(登場判定目標値)は、その住宅施設を舞台としたシーンの登場判定目標値となる。
 * - housingArea フィールドは組み合わせる住宅エリア Item の ID(文字列)を格納する。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";

export class ResidenceDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      appearanceTarget:    new fields.NumberField({ initial: 0 }),
      cyberSecurity:       new fields.NumberField({ initial: 0 }),
      analogSecurity:      new fields.NumberField({ initial: 0 }),
      // AE 着地点(フェーズ9-3)。実効値 = base + 住宅エリア供給値 + effectMod は消費側で算出。
      appearanceTargetEffectMod: new fields.NumberField({ initial: 0 }),
      cyberSecurityEffectMod:    new fields.NumberField({ initial: 0 }),
      analogSecurityEffectMod:   new fields.NumberField({ initial: 0 }),
      housingArea:         new fields.StringField({ initial: "" }),
      useHousingAreaDrop:  new fields.BooleanField({ initial: false }),
      identificationKey:   new fields.StringField({ initial: "" }),
    };
  }
}
