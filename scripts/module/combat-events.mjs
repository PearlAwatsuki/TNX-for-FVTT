/**
 * @fileoverview カット進行の境界イベント(フック)の定義と、フェーズ遷移で発火するイベント列の
 * 計画(フェーズ13-6・正本 Combat_Flow「カット境界とシーンの関係」)。
 *
 * 本フェーズは**イベントを正しいタイミング・ペイロードで発火するだけ**——効果の失効・回復・
 * カウンタのリセット等の**適用はフェーズ15 が購読して行う**(ここには一切書かない)。発火は進行を
 * 駆動する GM クライアント上(TnxCombat の advancePhase/startCombat/startInterrupt/endInterrupt/
 * endCombat はいずれも GM 側)で `Hooks.callAll(hook, combat, data)` により行う。
 *
 * プロセスイベントは**開始／終了の2エッジ**(2026-07-23 ユーザー確定)。from→to の1本では
 * 「メインA終了＋メインB開始(割り込み)」を表せないため。「メインプロセス中」効果は
 * `tnxProcessEnd`(phase:"main") で失効させられる——通常メイン・挿入メイン(割り込み)・割り込みで
 * 打ち切られた元メインのいずれの終了でも発火する(挿入/打ち切りは TnxCombat の割り込みメソッドが発火)。
 * サブターンは割り込みで**中断(サスペンド)**されるだけで終了しないため、その出入りでは終了/開始を
 * 再発火しない(サブターン中効果は割り込みを跨いで持続)。
 */

/** TNX カット進行・セッション進行イベントのフック名(シーン/アクトは14-2)。 */
export const TNX_HOOKS = Object.freeze({
  /** カット進行(＝シーン)の開始。startCombat。payload: なし。 */
  cutProgressionStart: "tnxCutProgressionStart",
  /** カット進行の終了。案1ダイアログ後。payload: {sceneEnded}。 */
  cutProgressionEnd: "tnxCutProgressionEnd",
  /** アクトの開始(自動設定の適用後)。payload: {actId}。 */
  actStart: "tnxActStart",
  /** アクトの終了。payload: {actId}。 */
  actEnd: "tnxActEnd",
  /** シーンの開始(アクト開始の先頭シーン・切替の遷移先)。payload: {sceneId, phase}。 */
  sceneStart: "tnxSceneStart",
  /** シーンの終了(カット進行終了と非連動)。切替・アクト終了・案1で発火。payload: {sceneId}。 */
  sceneEnd: "tnxSceneEnd",
  /** カットの開始(cut 1=開始時・cut N+1=次カット境界)。payload: {cut}。 */
  cutStart: "tnxCutStart",
  /** カットの終了(次カット境界・カット進行終了時の最終カット)。payload: {cut}。 */
  cutEnd: "tnxCutEnd",
  /** プロセスの開始。payload: {phase, combatantId, cut, viaInterrupt?}。 */
  processStart: "tnxProcessStart",
  /** プロセスの終了。payload: {phase, combatantId, cut, viaInterrupt?}。 */
  processEnd: "tnxProcessEnd",
  /**
   * キャラクターの退場(15-1)。payload: なし(第1引数が Actor)。
   * **退場＝そのキャラクターにとってのシーンの終わり**(2026-08-29 ユーザー裁定・一度退場したら
   * 再登場はできないため)。シーン境界の適用はこのイベントで駆動する——`tnxSceneEnd` は
   * 全員を退場させた**後**に発火するため、購読しても対象が空になる(→ Time_Management)。
   */
  actorExit: "tnxActorExit",
});

/**
 * `advancePhase` の遷移(fromPhase → plan.to)で発火するイベント列を計画する(純ロジック)。
 * combat は含めず、フック名とペイロード(combat 以外)の順序列を返す。TnxCombat が各要素を
 * `Hooks.callAll(hook, this, data)` で発火する。順序: 離脱プロセス終了 →(次カット境界)→ 遷移先開始。
 * @param {object} args
 * @param {string|null} args.fromPhase 離脱するプロセス(なければ終了イベントを出さない)
 * @param {string|null} [args.fromMainId] 離脱がメインのときの行動者 combatant id
 * @param {string} args.toPhase 遷移先プロセス
 * @param {string|null} [args.toMainId] 遷移先がメインのときの行動者 combatant id
 * @param {boolean} [args.nextCut] 次カット境界(cleanup→setup)か
 * @param {number} args.round 現在の round(cut 番号)
 * @returns {Array<{hook:string, data:object}>}
 */
export function planPhaseEvents({ fromPhase, fromMainId = null, toPhase, toMainId = null, nextCut = false, round }) {
  const events = [];
  const cut = round;
  if (fromPhase) {
    events.push({ hook: TNX_HOOKS.processEnd, data: { phase: fromPhase, combatantId: fromMainId ?? null, cut } });
  }
  if (nextCut) {
    events.push({ hook: TNX_HOOKS.cutEnd, data: { cut } });
    events.push({ hook: TNX_HOOKS.cutStart, data: { cut: cut + 1 } });
  }
  const toCut = nextCut ? cut + 1 : cut;
  events.push({ hook: TNX_HOOKS.processStart, data: { phase: toPhase, combatantId: toMainId ?? null, cut: toCut } });
  return events;
}
