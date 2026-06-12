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
 * - hack(電脳制御値)は「なし / 数値」の 2 状態。buy / hide と同様の {mode, value} 構造
 *   (mode は none / value のみ)。
 * - timing はスタイル技能と共通の選択肢・構造(フェーズ6-1 でユーザー確定)。
 *   {value, actionName, processName, timingOther} の配列で、選択肢マップは
 *   TnxSkillUtils.getSkillOptions()(timing / actions / processes)を共用する。
 * - part(部位)は文字列 + スロット数の {value, slots} 構造。slots が 1 のときは部位名のみ、
 *   0 または 2 以上のときは「武器2」のように部位名 + 数値で表記する(2026-06-12 ユーザー確定)。
 * - exclusive は自由記述の StringField(空欄はシート閲覧時に "-" 表示)。
 * - uses.type は使用回数の種別(アクト/シーン/カット。スタイル技能の usesType と共通)。
 * - isConsumption(消費アイテム)はフェーズ6-2 で weapon の isthrow を置き換えて全種別に
 *   一般化したフラグ(2026-06-12 ユーザー確定)。true のアイテムは個数(quantity)を持つ。
 * - isBiological(生体武器・生体装備)もフェーズ6-2 で weapon から全種別へ一般化
 *   (武器・防具のどちらでもない生体装備があるため)。
 * - quantity は {value: 現在個数, max: 常備化個数}。消費で value を減らし、0 でそのセッション中は
 *   使用不可。セッション終了で value は max に戻る。常備化経験点は max(個数分)を基準とし、
 *   消費しても経験点は復活しない。
 * - "isPre-play" はハイフンを含むため JavaScript の識別子として使えない。
 *   defineSchema の戻り値オブジェクトでは文字列キーとして定義し、
 *   アクセス時は system["isPre-play"] 記法を使う。
 * - isCarrying はフェーズ6-0 で追加(携帯中かどうか)。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices } from "../outfit-categories.mjs";

/**
 * モード選択付きの数値(buy / hide / hack 共用)。
 * @param {string[]} choices mode の選択肢(例: ["none", "value", "reference"])
 * @returns {foundry.data.fields.SchemaField}
 */
function modeValueField(choices) {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    mode:  new fields.StringField({
      required: true,
      blank: false,
      initial: "none",
      choices,
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
      isConsumption:     new fields.BooleanField({ initial: false }),
      isBiological:      new fields.BooleanField({ initial: false }),
      quantity: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
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
      buy:               modeValueField(["none", "value", "reference"]),
      preserveExp:       new fields.NumberField({ initial: 0 }),
      hide:              modeValueField(["none", "value", "reference"]),
      appearancePenalty: new fields.NumberField({ initial: 0 }),
      hack:              modeValueField(["none", "value"]),
      part: new fields.SchemaField({
        value: new fields.StringField({ initial: "" }),
        slots: new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
      timing: new fields.ArrayField(
        new fields.SchemaField({
          value:       new fields.StringField({ initial: "blank" }),
          actionName:  new fields.StringField({ initial: "blank" }),
          processName: new fields.StringField({ initial: "blank" }),
          timingOther: new fields.StringField({ initial: "" }),
        })
      ),
      exclusive:         new fields.StringField({ initial: "" }),
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        type:    new fields.StringField({ initial: "" }),
        max:     new fields.NumberField({ initial: 0 }),
        value:   new fields.NumberField({ initial: 0 }),
      }),
    };
  }
}
