/**
 * @fileoverview HousingAreaDataModel - 居住区 Item の DataModel
 *
 * 使用 template: base
 * 固有フィールド: area / buyRatingMod / preserveExpMod / appearanceTargetMod /
 *               cyberSecurityMod / analogSecurityMod / slotMod / identificationKey
 *
 * 準拠データ: template.json > Item.housingArea
 *
 * 住宅エリアは厳密にはアウトフィットではなく、住宅施設(residence)に対する修正値の集合
 * (2026-06-13 ユーザー確定)。住宅施設は取得時に必ず住宅エリアと組み合わせる(組み合わせは自由)。
 * - area(エリア): 住宅エリアが属するセキュリティ・ランク。なし/レッド/イエロー/グリーン/ホワイト/サンクチュアリ。
 * - 各 *Mod は住宅施設の対応する値への修正値:
 *   buyRatingMod(購入値)/ preserveExpMod(常備化経験点)/
 *   appearanceTargetMod(登場判定目標値)/ cyberSecurityMod(電脳セキュリティ)/
 *   analogSecurityMod(アナログセキュリティ)/ slotMod(スロット)。
 * 実効値の算出(住宅施設 + 住宅エリア)はフェーズ6-6 で扱う。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";

/**
 * 住宅エリアのセキュリティ・ランク(2026-06-13 ユーザー確定)。
 * @type {Readonly<Record<string, string>>}
 */
export const HOUSING_AREA_RANKS = Object.freeze({
  none:       "なし",
  red:        "レッド",
  yellow:     "イエロー",
  green:      "グリーン",
  white:      "ホワイト",
  sanctuary:  "サンクチュアリ",
});

/**
 * 住宅エリアが住宅施設に供給する修正値フィールドの順序とラベル。
 * 住宅エリアシートの編集 UI と、住宅施設シートの供給値表示で共用する。
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const HOUSING_AREA_MOD_FIELDS = Object.freeze([
  { key: "buyRatingMod",        label: "購入値" },
  { key: "preserveExpMod",      label: "常備化経験点" },
  { key: "appearanceTargetMod", label: "登場判定目標値" },
  { key: "cyberSecurityMod",    label: "電脳セキュリティ" },
  { key: "analogSecurityMod",   label: "アナログセキュリティ" },
  { key: "slotMod",             label: "スロット" },
]);

export class HousingAreaDataModel extends SystemDataModel.mixin(BaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      area: new fields.StringField({
        required: true,
        blank: false,
        initial: "none",
        choices: HOUSING_AREA_RANKS,
      }),
      buyRatingMod:        new fields.NumberField({ initial: 0 }),
      preserveExpMod:      new fields.NumberField({ initial: 0 }),
      appearanceTargetMod: new fields.NumberField({ initial: 0 }),
      cyberSecurityMod:    new fields.NumberField({ initial: 0 }),
      analogSecurityMod:   new fields.NumberField({ initial: 0 }),
      slotMod:             new fields.NumberField({ initial: 0 }),
      identificationKey:   new fields.StringField({ initial: "" }),
    };
  }
}
