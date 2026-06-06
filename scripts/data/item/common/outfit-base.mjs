/**
 * @fileoverview OutfitBaseTemplate - 装備品共通フィールドを定義する template クラス
 *
 * 使用 Item type: weapon / armor / ianus / cyborg / tron / tap /
 *                 vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * 準拠データ: template.json > Item.templates.outfitBase
 * 設計方針: llm-wiki/02_System/Design_Review_Entries.md B-0「論点3: 共通 template の継承戦略」参照
 *
 * フィールド型の判断:
 * - buy / preserveExp / hide / appearancePenalty / hack / part / timing / exclusive は
 *   template.json の初期値が "-"(文字列)のため StringField。数値でなく
 *   「N/A または選択肢コードを表す文字列」として設計されている。
 * - "isPre-play" はハイフンを含むためJavaScript の識別子として使えない。
 *   defineSchema の戻り値オブジェクトでは文字列キーとして定義し、
 *   アクセス時は system["isPre-play"] 記法を使う。
 * - uses の inline 定義: styleSkill 等でも同構造が出るが B-2 スコープでは 1 箇所のみ。
 *   B-5/B-6 で再利用が必要になった時点で helpers.mjs に切り出す。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class OutfitBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isPrepared:        new fields.BooleanField({ initial: true }),
      isOption:          new fields.BooleanField({ initial: false }),
      "isPre-play":      new fields.BooleanField({ initial: false }),
      isCyber:           new fields.BooleanField({ initial: false }),
      majorCategory:     new fields.StringField({ initial: "-" }),
      minorCategory:     new fields.StringField({ initial: "-" }),
      buy:               new fields.StringField({ initial: "-" }),
      preserveExp:       new fields.StringField({ initial: "-" }),
      hide:              new fields.StringField({ initial: "-" }),
      appearancePenalty: new fields.StringField({ initial: "-" }),
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
