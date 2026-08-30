/**
 * @fileoverview GeneralSkillDataModel - 一般技能 Item の DataModel
 *
 * 使用 template: base + usage + skillBase
 * 固有フィールド: generalSkillCategory / initialSkill(initialSuit / expCost) /
 *               onomasticSkill(isInitial / expCost)
 *
 * 準拠データ: template.json > Item.generalSkill
 *
 * 注意:
 * - generalSkillCategory は実質的に enum("initialSkill" / "onomasticSkill" 等)だが、
 *   B-5a の lifePathType と同じ判断で StringField のままとする。将来シートを実装する際に
 *   選択肢付きフィールドへのリファクタを検討すること。
 * - level / suits / isAction は SkillBaseTemplate の mixin で供給される。重複定義しない。
 * - tnx-general-skill-sheet.mjs の initialSuit ↔ suits ↔ level 連動ロジックは DataModel
 *   化の対象外。シートには B-8 / フェーズ6 まで触れない。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { SkillBaseTemplate } from "./common/skill-base.mjs";

export class GeneralSkillDataModel extends SystemDataModel.mixin(
  BaseTemplate, UsageTemplate, SkillBaseTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      generalSkillCategory: new fields.StringField({ initial: "initialSkill" }),
      initialSkill: new fields.SchemaField({
        initialSuit: new fields.StringField({ initial: "" }),
        expCost:     new fields.NumberField({ initial: 10 }),
      }),
      onomasticSkill: new fields.SchemaField({
        isInitial: new fields.BooleanField({ initial: false }),
        expCost:   new fields.NumberField({ initial: 5 }),
      }),
      identificationKey: new fields.StringField({ initial: "" }),
      // 固有名詞技能の区分(2026-08-26 裁定=切り替え時に明示選択)。値は ONOMASTIC_TYPES の
      // キー(society/craft/operate/art/contact)。空は旧データ=識別キーのプレフィックスから
      // 導出する(onomasticTypeOf)。読み手は必ず onomasticTypeOf を通す(フィールド優先)
      onomasticType: new fields.StringField({ initial: "" }),
      // 社会技能の下位区分(2026-08-26 裁定・SOCIETY_CLASSES のキー)。区分=society のときのみ
      // 意味を持つ。空=未分類(「あらゆる社会」にのみ合致し、下位区分の条件には乗らない)
      societyClass: new fields.StringField({ initial: "" }),
      // 製作技能の対応分類(フェーズ16-1・2026-08-30 裁定)。製作技能はそもそも分類を指定して
      // 取得する技能のため、societyClass と同形で区分=craft のときのみ意味を持つ。値は
      // アウトフィット分類の大分類キーまたは小分類キー(全体一意=repairableCategories と同じ
      // キー空間)。サービス大分類とその配下は選択肢に存在しない(サービスの製作技能は無い)。
      // 読み手は改造判定(16-4)・辞典ブラウザのフィルタ(16-2)
      craftCategory: new fields.StringField({ initial: "" }),
      usesBounty: new fields.BooleanField({ initial: false }),
      // アクト限定(フェーズ14-7・2026-08-08 ユーザー裁定)。アクトコネクション等、そのアクト
      // 限りの技能の印。アクト終了時に自動削除される(session-state.endAct)。アクトコネクション
      // 専用の名前を避けた汎用名(他のアクト限定要素にも流用できる)
      isActLimited: new fields.BooleanField({ initial: false }),
    };
  }
}
