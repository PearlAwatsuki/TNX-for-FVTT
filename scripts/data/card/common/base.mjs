/**
 * @fileoverview CardBaseTemplate - 全 Card 共通の基本フィールドを定義する template クラス
 *
 * 使用 Card type: 全 3 種(playingCards / neuroCards / other)
 * SystemDataModel.mixin() の引数として各 Card DataModel に合成して使う。
 *
 * 準拠データ: template.json > Card.templates.base
 * 設計方針: Item.BaseTemplate と同じ description フィールドを持つが、
 *           data/card → data/item の層またぎを避けるため Card 用に独立定義する。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class CardBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.StringField({ initial: "" }),
    };
  }
}
