/**
 * @fileoverview カット進行トラッカーの表示用の純ロジック(Foundry 非依存・テスト対象。フェーズ13-4)。
 * 正本: Combat_Flow.md「トラッカー上の表現＝サブターンモデル」。
 *
 * トラッカーが持つのは**進行と宣言だけ**(行動の起動・自動化は置かない=2026-07-22 ユーザー確定):
 * - フッター: 前進(nextTurn 相当=tnxAdvance)・メジャーなし終了・カット進行の開始/終了
 * - 行: 待機(候補の操作者)・行動不能 AR−1(RL)
 * 実際の起動先は TnxCombat のメソッド。
 */

/** フェーズキー → 表示ラベル。 */
export const PROCESS_LABELS = {
  setup: "セットアップ",
  initiative: "イニシアチブ",
  main: "メイン",
  cleanup: "クリンナップ",
};

/** フェーズの日本語ラベル(未開始/不明は「—」)。 */
export function processLabel(phase) {
  return PROCESS_LABELS[phase] ?? "—";
}

/**
 * フッターの進行ボタン計画。
 * - 「次へ」(tnxAdvance)＝形を変えた「次のターンへ」: サブターン内はスポット(プロセスの行動権)を
 *   次のキャラへ渡し、走査を終えていればフェーズが進む。メイン中は「手番終了」。
 * - フェーズ送り(tnxPhase)＝RL が残りの走査を飛ばしてフェーズを進める(イニシアチブへ/
 *   メインプロセスへ(候補)/クリンナップへ/次カットへ)。
 * - スポットの操作者(非GM)には「次へ」、手番キャラの操作者(非GM)には「手番終了」を出す。
 * @param {{hasCombat:boolean, started:boolean, phase:string|null, isGM:boolean,
 *          isMainOwner:boolean, isSpotOwner:boolean, candidateName:string|null}} state
 * @returns {Array<{action:string, label:string, primary?:boolean}>}
 */
export function footerPlan({ hasCombat, started, phase, isGM, isMainOwner, isSpotOwner, candidateName }) {
  if (!hasCombat) return [];
  if (!started) {
    return isGM ? [{ action: "tnxStartCombat", label: "カット進行の開始", primary: true }] : [];
  }
  // メイン終了は1本(メジャー未実行も「メジャーで何もしなかった」扱い=AR−1・CS0・2026-07-22 裁定)
  const nextButton = { action: "tnxAdvance", label: "次へ", primary: true };
  const endMainButtons = [{ action: "tnxAdvance", label: "手番終了", primary: true }];
  if (!isGM) {
    if (phase === "main") return isMainOwner ? endMainButtons : [];
    return isSpotOwner ? [nextButton] : [];
  }
  const phaseJumpLabel = {
    setup: "イニシアチブへ",
    initiative: candidateName ? `メインプロセスへ（${candidateName}）` : "クリンナップへ",
    cleanup: "次カットへ",
  }[phase];
  const buttons = phase === "main"
    ? endMainButtons
    : [nextButton, ...(phaseJumpLabel ? [{ action: "tnxPhase", label: phaseJumpLabel }] : [])];
  return [...buttons, { action: "tnxEndCombat", label: "カット進行の終了" }];
}

/**
 * combatant 行の宣言操作。イニシアチブ中の候補(次のメイン行動者と確認されたキャラ)の行のみ:
 * 待機=その操作者(所有者)か RL(Combat_Flow §4)。
 * 行動不能の AR−1 は手動ボタンにしない——戦闘不能系タグ/脱落マークの読み取りで
 * イニシアチブの確認時に自動記帳する(confirmMain・2026-07-22 ユーザー指摘=脱落切替と機能が被る)。
 * @param {{phase:string|null, isCandidate:boolean, isOwner:boolean, isGM:boolean}} state
 * @returns {Array<{action:string, label:string}>}
 */
export function rowActions({ phase, isCandidate, isOwner, isGM }) {
  if (phase !== "initiative" || !isCandidate) return [];
  return (isOwner || isGM) ? [{ action: "tnxWait", label: "待機" }] : [];
}
