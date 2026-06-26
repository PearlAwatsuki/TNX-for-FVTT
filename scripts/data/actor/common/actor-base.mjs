/**
 * @fileoverview ActorBaseTemplate - Actor 共通 template クラス（現在フィールドなし）
 *
 * 使用 Actor type: cast / guest / troop / extra
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 注意: 手札・切り札の所有(handPileId / trumpCardPileId)および手札上限(handMaxSize)は
 * User flag の権威へ一本化済み（フェーズ2 積み残し解消）。Actor フィールドでは持たない。
 * 実効上限は resolveEffectiveHandMaxSize(user) で取得する。現状この template はフィールドを持たない。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class ActorBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    return {};
  }
}
