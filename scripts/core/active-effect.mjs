/**
 * @fileoverview TokyoNovaActiveEffect - TNX の独自適用と Foundry 標準の適用を調停する。
 *
 * 本システムは全バフを DataModel の _applyEffectBuffs で自前適用する(CONFIG.ActiveEffect.
 * legacyTransferral=false)。カスタムキー(check.* / system.category.* 等)は実在しないパスへ
 * 向くため、ネイティブの applyActiveEffects がアクターへ適用しても無害なゴミになる。
 *
 * ただし名前装飾(フェーズ12・キー `name`)だけは例外: `name` はドキュメントの実在フィールドで、
 * 自動適用オン(transfer:true)のアイテム効果がネイティブ適用パスでアクターに乗ると **actor.name を
 * 破壊**する(アイテム名の装飾は _applyEffectBuffs が bearer アイテムへ直接行うため、ネイティブ側の
 * アクター適用は不要かつ有害)。そこで **Actor への `name` 変更だけ** apply を無効化する。
 * 数値/文字列/真偽の自前適用は effect.apply を `system.<パス>` で呼ぶため影響しない。
 * v14 では標準適用が静的 applyChange に移ったため、shouldApplyChange で TNX のキーを
 * 除外する。独自適用からの apply は新しい静的 API へ橋渡しする。
 */
import { parseEffectTargetKey } from "../data/item/helpers.mjs";

export class TokyoNovaActiveEffect extends ActiveEffect {
  /**
   * v14 の標準適用は apply() を通らない。TNX のキーは派生値の確定後に
   * _applyEffectBuffs / 判定処理が評価するため、標準処理では適用しない。
   * ここで評価すると @item の参照がなく、素値の変更や二重適用も起こる。
   */
  shouldApplyChange(change, options) {
    if (parseEffectTargetKey(change?.key)) return false;
    return super.shouldApplyChange(change, options);
  }

  /** @override — Actor ドキュメントへの `name` 変更(名前装飾)はネイティブ適用しない(フェーズ12)。 */
  apply(document, change) {
    if (document instanceof Actor && change?.key === "name") return {};
    // v14 では instance.apply が廃止された。TNX が評価済みの値は静的 API に渡す。
    if (typeof super.apply !== "function") {
      return this.constructor.applyChange(document, { ...change, effect: this });
    }
    return super.apply(document, change);
  }
}
