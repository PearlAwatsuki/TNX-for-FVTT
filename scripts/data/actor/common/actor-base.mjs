/**
 * @fileoverview ActorBaseTemplate - Actor のカード管理フィールドを定義する template クラス
 *
 * 使用 Actor type: cast / guest / troop / extra
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.actorBase
 *
 * 注意: 手札上限(handMaxSize)は User flag の権威とし、Actor フィールドでは持たない。
 * 実効上限は resolveEffectiveHandMaxSize(user) で取得する。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class ActorBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      handPileId:      new fields.StringField({ initial: "" }),
      trumpCardPileId: new fields.StringField({ initial: "" }),
    };
  }
}
