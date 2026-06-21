/**
 * @fileoverview SkillBaseTemplate - スキル共通フィールドを定義する template クラス
 *
 * 使用 Item type: generalSkill / styleSkill
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * 準拠データ: template.json > Item.templates.skillBase
 * 設計方針: llm-wiki/02_System/Design_Review_Entries.md B-0「論点3: 共通 template の継承戦略」参照
 */

import { SystemDataModel } from "../../abstract.mjs";

export class SkillBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      level: new fields.NumberField({ initial: 0 }),
      // 技能レベルの AE 着地点(フェーズ9-3)。実効レベル = level + levelEffectMod は消費側で算出。
      levelEffectMod: new fields.NumberField({ initial: 0 }),
      suits: new fields.SchemaField({
        spade:   new fields.BooleanField({ initial: false }),
        heart:   new fields.BooleanField({ initial: false }),
        diamond: new fields.BooleanField({ initial: false }),
        club:    new fields.BooleanField({ initial: false }),
      }),
      isAction: new fields.BooleanField({ initial: false }),
    };
  }

  /**
   * @override
   * 技能レベルの実効値 `levelTotal` を base(level)で派生算出する(フェーズ9-3 v2)。
   * バフはアクターの適用パスが total へ直接効かせる。level(base)は書き換えない。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    this.levelTotal = this.level ?? 0;
  }
}
