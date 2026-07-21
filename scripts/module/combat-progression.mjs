/**
 * @fileoverview カット進行のプロセス遷移と CS/AR 記帳の純ロジック(Foundry 非依存・テスト対象。
 * フェーズ13-3)。正本: Combat_Flow.md §2-6。
 *
 * プロセスは 戦闘準備(prep) → セットアップ(setup) → イニシアチブ(initiative) → メイン(main)
 * → イニシアチブ → メイン → …(行動可能者なし)→ クリンナップ(cleanup) → [次カット] セットアップ …
 * と進む。RL がトラッカーの操作で進め、システムは遷移の妥当性検証と、遷移に伴う CS/AR の
 * 記帳(更新オブジェクトの算出)を担う(承認済みの自動化方針＝RL駆動＋自動記帳)。
 *
 * 記帳の適用先(actor.update)は Foundry 側(TnxCombat)が行う。本モジュールは「何を書くか」だけを返す。
 */

/** プロセスの正規遷移(from → 許可される to の集合)。cleanup→setup は次カット。 */
const PROCESS_TRANSITIONS = {
  prep: ["setup"],
  setup: ["initiative"],
  initiative: ["main", "cleanup"],
  main: ["initiative"],
  cleanup: ["setup"],
};

/**
 * プロセス遷移が正規か。未開始(null/undefined)からは setup(カット開始)のみ許可。
 * @param {string|null|undefined} from
 * @param {string} to
 * @returns {boolean}
 */
export function isValidProcessTransition(from, to) {
  if (from === null || from === undefined) return to === "setup";
  return (PROCESS_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * AR を 1 減らす(下限 0)。非数は 0 扱い。
 * @param {number} value 現在AR
 * @returns {number}
 */
export function arDecrement(value) {
  return Math.max(0, (Number(value) || 0) - 1);
}

/**
 * メインプロセス終了時の記帳(§5)。メジャーを行った場合のみ **AR−1・CSカレント0**。
 * CSカレント0 は「アウトフィットやスタイル技能の効果で変更されない」(Combat_Flow §5)。
 * @param {{actionRank?:{value?:number}}} system
 * @param {{didMajor:boolean}} opts
 * @returns {Record<string, number>}
 */
export function buildEndMainUpdate(system, { didMajor } = {}) {
  if (!didMajor) return {};
  const update = { "system.combatSpeed.current": 0 };
  if (system?.actionRank) update["system.actionRank.value"] = arDecrement(system.actionRank.value);
  return update;
}

/**
 * イニシアチブプロセスで行動不能のときの記帳(§4)＝AR−1。
 * @param {{actionRank?:{value?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildCantActUpdate(system) {
  if (!system?.actionRank) return {};
  return { "system.actionRank.value": arDecrement(system.actionRank.value) };
}

/**
 * 待機の記帳(§4)＝CSカレント1。
 * @returns {Record<string, number>}
 */
export function buildWaitUpdate() {
  return { "system.combatSpeed.current": 1 };
}

/**
 * クリンナッププロセスの記帳(§6)＝AR 全回復(=付与値 maxTotal)。
 * @param {{actionRank?:{maxTotal?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildCleanupUpdate(system) {
  if (!system?.actionRank) return {};
  return { "system.actionRank.value": system.actionRank.maxTotal ?? 0 };
}

/**
 * セットアップ末の CSカレント確定(§3・2026-07-21 ユーザー確定の「一度計算して凍結」モデル)。
 * CSカレントを `CS実効値(valueTotal) ＋ CSカレントへのバフ(currentBuff)` で決定して保存 current へ焼き込む。
 * 以後 currentTotal は保存 current のみ(AE を毎回足さない)＝メジャー後0/待機1 が AE で変更されない。
 * @param {{combatSpeed?:{valueTotal?:number, currentBuff?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildSetupConfirmUpdate(system) {
  const cs = system?.combatSpeed;
  if (!cs) return {};
  return { "system.combatSpeed.current": (cs.valueTotal ?? 0) + (cs.currentBuff ?? 0) };
}
