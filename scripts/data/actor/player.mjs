/**
 * @fileoverview PlayerDataModel - プレイヤー Actor の DataModel
 *
 * 使用 template: actorBase のみ(biography / attributes は含まない)
 * 固有フィールド: history / exp
 *
 * 準拠データ: template.json > Actor.player
 *
 * 注意:
 * - exp の value / spent は syncPlayerExpFromCasts() が上書きする派生値。
 * - exp.total は TnxHistoryMixin が履歴の exp 合計を算出して更新する独立管理フィールド。
 * - cast の exp と異なり additional フィールドは存在しない。
 */

import { SystemDataModel } from "../abstract.mjs";
import { ActorBaseTemplate } from "./common/actor-base.mjs";

export class PlayerDataModel extends SystemDataModel.mixin(
  ActorBaseTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      history: new fields.ObjectField(),
      exp: new fields.SchemaField({
        value: new fields.NumberField({ initial: 0 }),
        total: new fields.NumberField({ initial: 0 }),
        spent: new fields.NumberField({ initial: 0 }),
      }),
    };
  }
}
