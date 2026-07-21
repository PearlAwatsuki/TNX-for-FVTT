/**
 * @fileoverview カット開始シードの算出(Foundry 非依存・テスト対象。フェーズ13-2)。
 * 正本: Combat_Flow.md「コンバットスピード」「アクションランク」。
 *
 * カット開始時(および開始済みカットへの参加時)に、CSカレントへ CS 実効値を、
 * 現在AR へ付与値(実効)を焼き込む(CS=「セットアップ末に決定・初期値は CS」の近似、
 * AR=「カット進行のシーン開始時に付与」の近似)。セットアップ末修正・メジャー後の消費・
 * クリンナップ全回復等の自動管理はフェーズ13-3。
 */

/**
 * アクターの system から、カット開始シードの update オブジェクトを組み立てる。
 * 該当層(combatSpeed / actionRank)がある層だけ書き込む。どちらも無ければ空。
 * @param {{combatSpeed?:{valueTotal?:number}, actionRank?:{maxTotal?:number}}|null} system
 * @returns {Record<string, number>} actor.update に渡す差分
 */
export function buildCombatSeedUpdate(system) {
  const update = {};
  const cs = system?.combatSpeed;
  if (cs) update["system.combatSpeed.current"] = cs.valueTotal ?? 0;
  const ar = system?.actionRank;
  if (ar) update["system.actionRank.value"] = ar.maxTotal ?? 0;
  return update;
}
