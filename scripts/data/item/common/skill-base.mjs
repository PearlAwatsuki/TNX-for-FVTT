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
import { computeFlagEffectiveValues } from "../helpers.mjs";

export class SkillBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      level: new fields.NumberField({ initial: 0 }),
      suits: new fields.SchemaField({
        spade:   new fields.BooleanField({ initial: false }),
        heart:   new fields.BooleanField({ initial: false }),
        diamond: new fields.BooleanField({ initial: false }),
        club:    new fields.BooleanField({ initial: false }),
      }),
      isAction: new fields.BooleanField({ initial: false }),
      // 役割(2026-07-09 新設計): この技能が担う既定行動(治療/ドッジ/パリー/各リアクション/各攻撃)。
      // 名前一致でなく役割で検出する。スタイル技能は「規定以外の技能をベースに所定の行動が行える」
      // ことを、そのスタイル技能自身がこの役割を持つことで表す(skill-roles.mjs の SKILL_ROLES)。
      skillRoles: new fields.ArrayField(new fields.StringField({ initial: "" })),
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
    // 特性フラグの実効値(フェーズ12): suits.*Total / isActionTotal / usesBountyTotal / noComboTotal 等。
    // AE のオン/オフ上書きはアクターの適用パスが実効側へ効かせる(base 不変)
    computeFlagEffectiveValues(this);
  }
}
