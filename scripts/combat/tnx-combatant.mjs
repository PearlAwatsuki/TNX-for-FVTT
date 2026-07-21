/**
 * @fileoverview TnxCombatant — カット進行の Combatant 派生クラス(フェーズ13-2)。
 *
 * カット進行の参加者。イニシアチブは system.json で CSカレント(表示中の CS 実効値
 * ＝`@system.combatSpeed.displayTotal`)に設定済みのため、13-2 では上書きしない。
 *
 * 13-2 の範囲: クラスの新設・CONFIG 登録(「器」)のみ。手番順への写像(combat-turn-order.mjs
 * が使う素データ化)・`_sortCombatants` の適用・手番判定は 13-3/13-4 で追加する。
 */

export class TnxCombatant extends Combatant {
}
