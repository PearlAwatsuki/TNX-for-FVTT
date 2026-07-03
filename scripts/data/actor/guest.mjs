/**
 * @fileoverview GuestDataModel - ゲスト Actor の DataModel
 *
 * ゲスト＝キャストから**セッション履歴クラスタ(ownerUserId / syncWithOwner / history / exp)のみ**を
 * 除いたもの(2026-07-03 確定。報酬点・ライフパス・部位・生身・handMaxSizeMod はキャストと同一)。
 * 共有フィールドと派生値パイプラインは CharacterBaseDataModel(common/character-base.mjs)が持つため、
 * 固有定義はない。
 * ゲストの handMaxSizeMod は GM ユーザーの実効手札上限へ合算される(user-flag-schema.mjs・
 * 正本 Card_Operations.md「手札上限」)。
 */

import { CharacterBaseDataModel } from "./common/character-base.mjs";

export class GuestDataModel extends CharacterBaseDataModel {}
