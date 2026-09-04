/**
 * @fileoverview カット進行のフェーズ遷移と CS/AR 記帳の純ロジック(Foundry 非依存・テスト対象。
 * フェーズ13-3/13-4)。正本: Combat_Flow.md §2-6・「トラッカー上の表現＝サブターンモデル」。
 *
 * サブターンモデル(2026-07-22 ユーザー確定): メインプロセス＝キャラクターのターン、セットアップ/
 * イニシアチブ/クリンナップ＝特定キャラに紐づかない全体の場(サブターン)。1カット＝FVTT の1ラウンド。
 * イニシアチブは「次のメインで誰が行動するか」を状態(CSカレント最大かつ AR≥1)から**確認する場**で
 * あり、RL が行動者を指名するのではない。進行は nextTurn 1本(planAdvance が次の一手を計画する)。
 *
 * 記帳の適用先(actor.update)は Foundry 側(TnxCombat)が行う。本モジュールは「何を書くか」だけを返す。
 */

import { confirmMain } from "./combat-turn-order.mjs";

/** フェーズの正規遷移(from → 許可される to の集合)。cleanup→setup は次カット。 */
const PROCESS_TRANSITIONS = {
  setup: ["initiative"],
  initiative: ["main", "cleanup"],
  main: ["initiative"],
  cleanup: ["setup"],
};

/**
 * フェーズ遷移が正規か。未開始(null/undefined)からは setup(カット進行の開始)のみ許可。
 * @param {string|null|undefined} from
 * @param {string} to
 * @returns {boolean}
 */
export function isValidProcessTransition(from, to) {
  if (from === null || from === undefined) return to === "setup";
  return (PROCESS_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * 「次へ」(nextTurn)1本の前進計画。現フェーズと参加者の状態から、次に起こることを返す。
 * - setup      → { to:"initiative", confirmSetup:true }   セットアップ末の CSカレント確定を伴う
 * - initiative → { to:"main", mainId, penalizedIds }      確認(CSカレント最大かつAR≥1・行動不能は
 *                { to:"cleanup", penalizedIds }            AR−1 の対象=penalizedIds)。行動可能者が
 *                                                          いなければクリンナップへ
 * - main       → { to:"initiative", endMain:true }        メイン終了の記帳を伴う
 * - cleanup    → { to:"setup", nextCut:true }             次カット(再シード=AR全回復を含む)
 * @param {string|null} phase 現フェーズ
 * @param {Array} participants combat-turn-order の素データ配列
 * @returns {object|null} 前進計画(未開始・不明フェーズは null)
 */
export function planAdvance(phase, participants) {
  switch (phase) {
    case "setup":
      return { to: "initiative" };
    case "initiative": {
      const { mainId, penalizedIds } = confirmMain(participants);
      return mainId ? { to: "main", mainId, penalizedIds } : { to: "cleanup", penalizedIds };
    }
    case "main":
      return { to: "initiative" };
    case "cleanup":
      return { to: "setup", nextCut: true };
    default:
      return null;
  }
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
 * AR を1消費した記帳＝**AR−1 かつ CSカレント0**(2026-07-26 全面改訂の一般則。Combat_Flow
 * 「AR・メジャーアクション・プロセス所有の一般則」)。AR 減少 ⟺ CS→0(カット終了まで・復帰は
 * 次カットのセットアップ再シード)。用途は共通:
 *   ・メジャーを行ったプロセス終了時の各行動者(majorActed)。
 *   ・イニシアチブで行動不能(RL 判断)のときのペナルティ。
 * CSカレント0 は凍結モデルにより AE で持ち上がらない。AR を持たないアクター(消費対象でない)は
 * 記帳しない(AR 減少が無いので CS0 もない)。
 * @param {{actionRank?:{value?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildArDecrementUpdate(system) {
  if (!system?.actionRank) return {};
  return {
    "system.combatSpeed.current": 0,
    "system.actionRank.value": arDecrement(system.actionRank.value),
  };
}

/**
 * メジャー実行者の記帳。通常は AR−1＋CSカレント0(buildArDecrementUpdate)。《不可知》の行動
 * (arFree・17-6「カット進行中の場合、この行動はアクションランクを消費しない」)は AR を減らさず、
 * プロセスの終了(CSカレント0)だけ記帳する。AR を持たないアクターは記帳しない。
 * @param {{actionRank?:{value?:number}}} system
 * @param {{arFree?: boolean}} [opts]
 * @returns {Record<string, number>}
 */
export function buildMajorChargeUpdate(system, { arFree = false } = {}) {
  if (!system?.actionRank) return {};
  if (arFree) return { "system.combatSpeed.current": 0 };
  return buildArDecrementUpdate(system);
}

/**
 * 待機の記帳(§4)＝CSカレント1。宣言者はそのキャストの操作者(ゲストは RL)。
 * @returns {Record<string, number>}
 */
export function buildWaitUpdate() {
  return { "system.combatSpeed.current": 1 };
}

/**
 * セットアップ末の CSカレント確定(§3・「一度計算して凍結」モデル)。
 * `current ← CS実効値(valueTotal) ＋ CSカレントへのバフ(currentBuff)` を焼き込む。
 * @param {{combatSpeed?:{valueTotal?:number, currentBuff?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildSetupConfirmUpdate(system) {
  const cs = system?.combatSpeed;
  if (!cs) return {};
  return { "system.combatSpeed.current": (cs.valueTotal ?? 0) + (cs.currentBuff ?? 0) };
}

// ─── 割り込み(挿入メイン)＝サスペンド／レジューム＋consumesAr(2026-07-26 全面改訂) ─────────
// 正本: Combat_Flow「AR・メジャーアクション・プロセス所有の一般則」。イニシアチブでの割り込み(自分の
// メインを順番外で行う=自己割り込み)と追加行動技能(別キャラに順番外のメインを与える)は、同じ「指定
// キャラに順番外のメインを挿入する」プリミティブに還元される。起点は宣言/判定用途が対象に立てる
// 「割り込み許可フラグ」で、トラッカー入口はそのフラグでゲートされる(=手動・完全自動化しない)。
//
// **メインプロセス中の割り込みは、元のメインを終了せず退避(サスペンド)する**(2026-07-26 全面改訂で
// 旧「終了・戻らない」を撤回)。挿入メイン終了で退避位置へ復帰(レジューム)する。退避はスタックで行い、
// 入れ子(挿入メイン中の割り込み)にも対応する。挿入メインが AR を消費するか否かは、割り込みを生じ
// させた用途が宣言する `consumesAr` で決まる(自己割り込み=既定=消費・追加行動=無償=肩代わり)。
// **戻り(サスペンド／レジューム)は AR 消費とは独立**——復帰は常に退避フレームを厳密に復元する。
// 記帳(AR−1＋CS0)は一般則の buildArDecrementUpdate を流用し、consumesAr のときだけ挿入メインの
// majorActed に適用する(Foundry 側)。

/**
 * 割り込み(挿入メイン)開始: 現在の進行状態を退避フレームにし、挿入メインの新状態を返す。元のプロセス
 * (メイン/サブターンいずれも)は終了せず、そのまま frame に退避され、後で厳密に復元される。
 * @param {{phase, mainCombatantId, spotCombatantId, majorActed, interruptConsumesAr}} current 現在の進行状態
 * @param {string} insertId 挿入メインに据える combatant id
 * @param {boolean} consumesAr この挿入メインが AR を消費するか(用途宣言・自己割り込み=真/追加行動=偽)
 * @returns {{frame: object, next: object}} frame=退避フレーム(スタックへ push)・next=挿入メインの新状態
 */
export function pushInterruptFrame(current, insertId, consumesAr) {
  const frame = {
    phase:           current?.phase ?? null,
    mainCombatantId: current?.mainCombatantId ?? null,
    spotCombatantId: current?.spotCombatantId ?? null,
    majorActed:      current?.majorActed ?? [],
    // 親が挿入メインならその consumesAr を保存(復帰時に interruptConsumesAr を戻す)。素のプロセスは null
    consumesAr:      current?.interruptConsumesAr ?? null,
  };
  const next = {
    phase:              "main",
    mainCombatantId:    insertId,
    spotCombatantId:    null,
    majorActed:         [],                 // 挿入メインのメジャーは新規に集計する
    interruptConsumesAr: consumesAr === true, // 既定(真)の解決は combat 側。ここは厳密ブール化のみ
  };
  return { frame, next };
}

/**
 * 割り込み(挿入メイン)終了: スタック先頭(最後に積んだフレーム)を取り出し、復元すべき進行状態を返す。
 * 退避時に完全な位置(spot 含む)を保存しているため再算出はしない(サスペンド／レジューム)。入力配列は
 * 破壊しない。空スタック(頑健性)は全 null・空 majorActed を返す。
 * @param {Array<object>} stack 退避フレームのスタック(末尾=先頭)
 * @returns {{restore: object, remaining: Array<object>}} restore=復元する状態・remaining=残りのスタック
 */
export function popInterruptFrame(stack) {
  const s = Array.isArray(stack) ? stack.slice() : [];
  const frame = s.pop() ?? null;
  const restore = {
    phase:               frame?.phase ?? null,
    mainCombatantId:     frame?.mainCombatantId ?? null,
    spotCombatantId:     frame?.spotCombatantId ?? null,
    majorActed:          frame?.majorActed ?? [],
    interruptConsumesAr: frame?.consumesAr ?? null,
  };
  return { restore, remaining: s };
}
