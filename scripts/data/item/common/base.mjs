/**
 * @fileoverview BaseTemplate - 全 Item 共通の基本フィールドを定義する template クラス
 *
 * 使用 Item type: 全 17 種
 * (style / miracle / generalSkill / styleSkill / weapon / armor / ianus / cyborg /
 *  tron / tap / vehicle / residence / housingArea / combiner / general /
 *  organization / lifePath)
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * 準拠データ: template.json > Item.templates.base
 * 設計方針: docs/DESIGN_REVIEW.md B-0「論点3: 共通 template の継承戦略」参照
 */

import { SystemDataModel } from "../../abstract.mjs";

export class BaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ initial: "" }),
    };
  }
}
