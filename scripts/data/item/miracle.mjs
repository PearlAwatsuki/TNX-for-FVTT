/**
 * @fileoverview MiracleDataModel - 神業 Item の DataModel
 *
 * 使用 template: base + usage
 * 固有フィールド: furigana / usageCondition / isKill / isDefence / isAll / isUsed /
 *               usageCount(value / total / mod)
 *
 * 準拠データ: template.json > Item.miracle
 *
 * 注意:
 * - usageCount は神業の母数管理に使われ、tnx.mjs の preUpdateItem / preDeleteItem フックが
 *   参照する。DataModel は構造を template.json に忠実に定義するのみ。ロジックには触れない。
 * - usageCount.value / total の初期値は 1(0 ではない)。template.json に忠実に従う。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { UsageTemplate } from "./common/usage.mjs";

export class MiracleDataModel extends SystemDataModel.mixin(BaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      furigana:       new fields.StringField({ initial: "" }),
      usageCondition: new fields.StringField({ initial: "" }),
      isKill:         new fields.BooleanField({ initial: false }),
      isDefence:      new fields.BooleanField({ initial: false }),
      isAll:          new fields.BooleanField({ initial: false }),
      isUsed:         new fields.BooleanField({ initial: false }),
      usageCount: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1 }),
        total: new fields.NumberField({ initial: 1 }),
        mod:   new fields.NumberField({ initial: 0 }),
      }),
    };
  }
}
