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
 * - buy(購入値)は「なし / 数値 / 解説参照」の 3 状態、hide(隠匿値)は「なし / 数値 / 解説参照 / 制御値」の 4 状態を持つため
 *   { mode, value } の SchemaField。mode が "value" のときのみ value を使う。
 * - preserveExp(常備化経験点)は必ず数値が入るため NumberField。
 * - appearancePenalty(危険値)は「なし / 数値」の 2 状態。buy / hide / hack と同様の {mode, value} 構造
 *   (mode は none / value のみ)(フェーズ6-4 にて変更)。
 * - majorCategory / minorCategory は choices 付き StringField(outfit-categories.mjs が正本)。
 *   未選択を許すため blank: true。
 * - hack(電脳制御値)は「なし / 数値」の 2 状態。buy / hide と同様の {mode, value} 構造
 *   (mode は none / value のみ)。
 * - timing はスタイル技能と共通の選択肢({value, actionName, processName, timingOther})だが、
 *   スタイル技能と違って**一つしかあり得ない**ため単一の SchemaField(2026-06-13 ユーザー確定)。
 *   選択肢マップは TnxSkillUtils.getSkillOptions()(timing / actions / processes)を共用する。
 * - part(部位)は**配列**。フェーズ10(2026-06-26)で種別(kind)ベースへ拡張した。
 *   kind = none/bodyPart/option/reference/other の5択。value/slots は維持(後方互換)。
 *   旧 {value,slots} データは kind 既定 "other" で自由記入扱いへ移行する(§4.2)。
 *   結合は兄弟フィールド partRelation(and/or)、or 時の装備先は partOrChoice。
 *   表示・占有ルールの正本は Outfits.md「部位管理(フェーズ10)」。
 * - exclusive は自由記述の StringField(空欄はシート閲覧時に "-" 表示)。
 * - uses.type は使用回数の種別(アクト/シーン/カット。スタイル技能の usesType と共通)。
 * - isConsumption(消費アイテム)はフェーズ6-2 で weapon の isthrow を置き換えて全種別に
 *   一般化したフラグ(2026-06-12 ユーザー確定)。true のアイテムは個数(quantity)を持つ。
 * - quantity は {value: 現在個数, max: 常備化個数}。消費で value を減らし、0 でそのセッション中は
 *   使用不可。セッション終了で value は max に戻る。常備化経験点は max(個数分)を基準とし、
 *   消費しても経験点は復活しない。
 * - "isPre-play" はハイフンを含むため JavaScript の識別子として使えない。
 *   defineSchema の戻り値オブジェクトでは文字列キーとして定義し、
 *   アクセス時は system["isPre-play"] 記法を使う。
 * - isCarrying はフェーズ6-0 で追加(携帯中かどうか)。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices, LEGACY_CATEGORY_MAP } from "../outfit-categories.mjs";
import { modeValueField, migrateUsesValueToSpent, computeItemEffectiveValues } from "../helpers.mjs";

/**
 * 部位行の種別(フェーズ10・2026-06-26 確定)。公式の「部位」指定を自由入力 + フラグで表現する。
 * - none      : 「-」部位なし(非消費)
 * - bodyPart  : 身体部位。value にプリセット由来の部位名、slots に消費数
 * - option    : オプション。装備先ホストを hostMajor/hostMinor(+hostMinorExclude)/hostFeature/hostName で指定
 * - reference : 解説参照。表示は常に「解説参照」。refSubKind の実部位で占有計算する
 * - other     : その他(自由記入)。value に自由記入文字列。占有計算対象外
 * 正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md「部位管理(フェーズ10)」
 */
export const PART_KINDS = Object.freeze({
  none:      "-",
  bodyPart:  "身体部位",
  option:    "オプション",
  reference: "解説参照",
  other:     "その他",
});

/** 解説参照(reference)の入れ子で選べる実部位種別(解説参照の入れ子は不可) */
export const PART_REFERENCE_SUB_KINDS = Object.freeze({
  none:     "-",
  bodyPart: "身体部位",
  option:   "オプション",
  other:    "その他",
});

/** part 全体の結合(2行以上のとき)。and=全部占有 / or=択一 */
export const PART_RELATIONS = Object.freeze({
  and: "かつ",
  or:  "または",
});

export class OutfitBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isPrepared:        new fields.BooleanField({ initial: true }),
      isOption:          new fields.BooleanField({ initial: false }),
      "isPre-play":      new fields.BooleanField({ initial: false }),
      isCheckAcquired:   new fields.BooleanField({ initial: false }),
      isCyber:           new fields.BooleanField({ initial: false }),
      isCarrying:        new fields.BooleanField({ initial: true }),
      isConsumption:     new fields.BooleanField({ initial: false }),
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
      preserveExp:       modeValueField(["none", "value"]),
      hide:              modeValueField(["none", "value", "reference", "control"]),
      appearancePenalty: modeValueField(["none", "value"]),
      hack:              modeValueField(["none", "value"]),
      // 部位行(フェーズ10 で種別ベースへ拡張)。value/slots は維持。kind 既定 "other" は
      // 旧 {value,slots} データを「その他(自由記入)」へ移行する(§4.2: 文字列から種別を推測しない)。
      part: new fields.ArrayField(
        new fields.SchemaField({
          kind:             new fields.StringField({ initial: "other", choices: PART_KINDS }),
          value:            new fields.StringField({ initial: "" }),
          slots:            new fields.NumberField({ initial: 1, min: 0, integer: true }),
          hostMajor:        new fields.StringField({ initial: "" }),
          hostMinor:        new fields.StringField({ initial: "" }),
          hostMinorExclude: new fields.BooleanField({ initial: false }),
          hostFeature:      new fields.StringField({ initial: "" }),
          hostName:         new fields.StringField({ initial: "" }),
          refSubKind:       new fields.StringField({ initial: "none", choices: PART_REFERENCE_SUB_KINDS }),
        })
      ),
      // part 全体の結合(2行以上で意味を持つ)と、or 時の装備先(占有する行 index。表示には不影響)。
      // partOptional=任意は**部位全体**に効く(重複可・占有非カウント。行ごとではない)。
      partRelation: new fields.StringField({ initial: "and", choices: PART_RELATIONS }),
      partOrChoice: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      partOptional: new fields.BooleanField({ initial: false }),
      // 部位「-」品など、準備していなくても使用可能な例外フラグ(2026-06-26)
      noPrepareRequired: new fields.BooleanField({ initial: false }),
      timing: new fields.SchemaField({
        value:       new fields.StringField({ initial: "blank" }),
        actionName:  new fields.StringField({ initial: "blank" }),
        processName: new fields.StringField({ initial: "blank" }),
        timingOther: new fields.StringField({ initial: "" }),
      }),
      exclusive:         new fields.StringField({ initial: "" }),
      // spent = 消費済み回数（D&D 方式）。残り = max - spent
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        type:    new fields.StringField({ initial: "" }),
        max:     new fields.NumberField({ initial: 0 }),
        spent:   new fields.NumberField({ initial: 0 }),
      }),
      parentItemId:   new fields.StringField({ initial: "" }),
      parentSlotKind: new fields.StringField({ initial: "" }),
      combineGroupId: new fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行・uses.value→spent 移行・分類の日本語名→キー移行 */
  static migrateData(source) {
    // 分類: 旧データは日本語名を格納していたためコードキーへ移行(フェーズ9)
    if (source.majorCategory && LEGACY_CATEGORY_MAP[source.majorCategory]) {
      source.majorCategory = LEGACY_CATEGORY_MAP[source.majorCategory];
    }
    if (source.minorCategory && LEGACY_CATEGORY_MAP[source.minorCategory]) {
      source.minorCategory = LEGACY_CATEGORY_MAP[source.minorCategory];
    }
    if (typeof source.appearancePenalty === "number") {
      const n = source.appearancePenalty;
      source.appearancePenalty = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    if (typeof source.preserveExp === "number") {
      const n = source.preserveExp;
      source.preserveExp = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    migrateUsesValueToSpent(source);
    return super.migrateData(source);
  }

  /**
   * @override
   * アウトフィット実効値(AE 着地点 effectMod 込みの `.total` 系)を派生算出する(フェーズ9-3)。
   * 全アウトフィット type が OutfitBaseTemplate を合成するため、ここに置けば一括で適用される
   * (各 concrete モデルは prepareDerivedData を未定義のため本メソッドを継承する)。
   * attack / defence 等の concrete 固有パラメータも同一 system 上にあるため computeItemEffectiveValues が拾う。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    computeItemEffectiveValues(this);
  }
}
