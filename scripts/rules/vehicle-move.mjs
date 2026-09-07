/**
 * @fileoverview ヴィークル操縦移動の純ロジック(Foundry 非依存・テスト対象。フェーズ12)。
 * 正本: Outfits.md「ヴィークル操縦移動」・Combat_Flow.md。
 *
 * 操縦中はメジャーアクションでも移動でき、対応する〈操縦〉で判定する。
 * その達成値÷10(切り捨て)段階の移動が可能(端数切り捨て=2026-07-09 ユーザー確定)。
 */

/**
 * 達成値から移動段階数を求める(達成値÷10・切り捨て)。
 * 0 以下・非数は 0(移動なし。ファンブル/スート不一致は達成値 0 として渡す)。
 * @param {number} achievement 操縦判定の達成値
 * @returns {number} 移動できる段階数
 */
export function movementStagesFromAchievement(achievement) {
  const n = Number(achievement);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / 10);
}
