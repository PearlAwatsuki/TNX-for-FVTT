/**
 * @fileoverview ActorBaseTemplate - Actor のカード管理フィールドを定義する template クラス
 *
 * 使用 Actor type: cast / guest / troop / player
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.actorBase
 */

import { SystemDataModel } from "../../abstract.mjs";

export class ActorBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      handMaxSize:     new fields.NumberField({ initial: 4 }),
      handPileId:      new fields.StringField({ initial: "" }),
      trumpCardPileId: new fields.StringField({ initial: "" }),
    };
  }
}
