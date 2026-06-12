/**
 * @fileoverview OutfitBaseTemplate - 装備品共通フィールドを定義する template クラス
 *
 * 使用 Item type: weapon / armor / ianus / cyborg / tron / tap /
 *                 vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md(フェーズ6-0 で確定)
 * 設計方針: llm-wiki/02_System/Design_Review_Entries.md B-0「論点3: 共通 template の継承戦略」参照
 *
 * フィールド型の判断(フェーズ6-0 で刷新):
 * - buy(購入値)/ hide(隠匿値)は「なし / 数値 / 解説参照」の 3 状態を持つため
 *   { mode, value } の SchemaField。mode が "value" のときのみ value を使う。
 * - preserveExp(常備化経験点)/ appearancePenalty(危険値)は必ず数値が入るため NumberField。
 * - majorCategory / minorCategory は choices 付き StringField(outfit-categories.mjs が正本)。
 *   未選択を許すため blank: true。
 * - hack / part / timing / exclusive は引き続き StringField(初期値 "-")。
 *   形式の確定は実装サブフェーズ着手時に行う(Phase_6_Tasks_Detail.md 残課題)。
 * - "isPre-play" はハイフンを含むため JavaScript の識別子として使えない。
 *   defineSchema の戻り値オブジェクトでは文字列キーとして定義し、
 *   アクセス時は system["isPre-play"] 記法を使う。
 * - isCarrying はフェーズ6-0 で追加(携帯中かどうか)。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices } from "../outfit-categories.mjs";

/**
 * 「なし / 数値 / 解説参照」の 3 状態を持つ値(buy / hide 共用)。
 * @returns {foundry.data.fields.SchemaField}
 */
function threeStateValueField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    mode:  new fields.StringField({
      required: true,
      blank: false,
      initial: "none",
      choices: ["none", "value", "reference"],
    }),
    value: new fields.NumberField({ initial: 0 }),
  });
}

export class OutfitBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isPrepared:        new fields.BooleanField({ initial: true }),
      isOption:          new fields.BooleanField({ initial: false }),
      "isPre-play":      new fields.BooleanField({ initial: false }),
      isCyber:           new fields.BooleanField({ initial: false }),
      isCarrying:        new fields.BooleanField({ initial: false }),
      majorCategory:     new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: getMajorCategoryChoices,
      }),
      minorCategory:     new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: getMinorCategoryChoices,
      }),
      buy:               threeStateValueField(),
      preserveExp:       new fields.NumberField({ initial: 0 }),
      hide:              threeStateValueField(),
      appearancePenalty: new fields.NumberField({ initial: 0 }),
      hack:              new fields.StringField({ initial: "-" }),
      part:              new fields.StringField({ initial: "-" }),
      timing:            new fields.StringField({ initial: "-" }),
      exclusive:         new fields.StringField({ initial: "-" }),
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        max:     new fields.NumberField({ initial: 0 }),
        value:   new fields.NumberField({ initial: 0 }),
      }),
    };
  }
}
