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
    };
  }
}
