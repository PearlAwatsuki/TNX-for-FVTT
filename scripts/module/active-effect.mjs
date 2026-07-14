/**
 * @fileoverview TokyoNovaActiveEffect - ネイティブ AE 適用の一点だけを抑止する薄い派生クラス。
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
 */
export class TokyoNovaActiveEffect extends ActiveEffect {
  /** @override — Actor ドキュメントへの `name` 変更(名前装飾)はネイティブ適用しない(フェーズ12)。 */
  apply(document, change) {
    if (document instanceof Actor && change?.key === "name") return {};
    return super.apply(document, change);
  }
}
