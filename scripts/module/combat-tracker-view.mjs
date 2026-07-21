/**
 * @fileoverview コンバットトラッカー(カット進行)の表示用の純ロジック(Foundry 非依存・テスト対象。
 * フェーズ13-4)。正本: Combat_Flow.md §2-6。
 *
 * トラッカーは進行の制御と表示に徹する(行動の起動・自動化はしない=2026-07-21〜22 ユーザー確定)。
 * ここではプロセスのラベルと、プロセスごとの RL 操作ボタン(進行)・行操作(待機/行動不能/メイン割当)を
 * 純粋に導出する。実際の起動先は TnxCombat のメソッド(13-3)。
 */

/** プロセスキー → 表示ラベル。 */
export const PROCESS_LABELS = {
  prep: "戦闘準備",
  setup: "セットアップ",
  initiative: "イニシアチブ",
  main: "メイン",
  cleanup: "クリンナップ",
};

/** プロセスの日本語ラベル(未開始/不明は「—」)。 */
export function processLabel(process) {
  return PROCESS_LABELS[process] ?? "—";
}

/**
 * プロセスごとの進行ボタン(RL 操作・フッター)。action は TnxCombatTracker の登録アクション名。
 * @param {string|null} process
 * @returns {Array<{action:string, label:string}>}
 */
export function processActions(process) {
  switch (process) {
    case "setup":      return [{ action: "tnxToInitiative", label: "イニシアチブへ" }];
    case "initiative": return [{ action: "tnxToCleanup", label: "クリンナップへ" }];
    case "main":       return [
      { action: "tnxEndMainMajor", label: "メジャーで終了" },
      { action: "tnxEndMainMinor", label: "メジャーなしで終了" },
    ];
    case "cleanup":    return [{ action: "tnxNextCut", label: "次カットへ" }];
    default:           return [];
  }
}

/**
 * combatant 行の操作ボタン。イニシアチブプロセスで行動可能なキャラのみ、メイン割当/待機/行動不能。
 * @param {string|null} process
 * @param {boolean} isActable 手番を持てるか(エキストラは false)
 * @returns {Array<{action:string, label:string}>}
 */
export function rowActions(process, isActable) {
  if (process !== "initiative" || !isActable) return [];
  return [
    { action: "tnxAssignMain", label: "メイン" },
    { action: "tnxWait", label: "待機" },
    { action: "tnxCantAct", label: "行動不能" },
  ];
}
