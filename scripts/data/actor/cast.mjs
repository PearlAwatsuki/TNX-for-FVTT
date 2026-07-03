/**
 * @fileoverview CastDataModel - キャスト Actor の DataModel
 *
 * フェーズ11-3 で共通基底化: 共有フィールド(lifePath・partSlots・報酬点・生身・weaponRefs・
 * handMaxSizeMod・outfitMod 等)と派生値パイプライン(prepareDerivedData・AE 適用)は
 * CharacterBaseDataModel(common/character-base.mjs)にある。
 * 本クラスは cast 固有＝セッション履歴クラスタ(ownerUserId / syncWithOwner / history / exp)のみを
 * 追加する(ゲストは持たない＝guest.mjs)。
 *
 * 注意:
 * - exp の value / spent / total は updateCastExp() が非同期で上書きする派生値。
 *   DataModel 内での prepareDerivedData による再計算は行わない。
 */

import { CharacterBaseDataModel } from "./common/character-base.mjs";

export class CastDataModel extends CharacterBaseDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      ownerUserId:   new fields.StringField({ initial: "" }),
      syncWithOwner: new fields.BooleanField({ initial: true }),
      history:     new fields.ObjectField(),
      exp: new fields.SchemaField({
        value:      new fields.NumberField({ initial: 170 }),
        spent:      new fields.NumberField({ initial: -170 }),
        total:      new fields.NumberField({ initial: 0 }),
        additional: new fields.NumberField({ initial: 0 }),
      }),
    };
  }
}
