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
      return { to: "initiative", confirmSetup: true };
    case "initiative": {
      const { mainId, penalizedIds } = confirmMain(participants);
      return mainId ? { to: "main", mainId, penalizedIds } : { to: "cleanup", penalizedIds };
    }
    case "main":
      return { to: "initiative", endMain: true };
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
 * メインプロセス終了時の記帳(§5)＝**常に AR−1・CSカレント0**。
 * メジャーを行わなかった場合も「メジャーアクションで何もしなかった」と扱う(2026-07-22 ユーザー裁定
 * ——消費されないならムーブ/マイナーの無限反復が可能になるため)。
 * CSカレント0 は「アウトフィットやスタイル技能の効果で変更されない」——凍結モデルにより
 * 保存 current がそのまま実効値のため、書き込んだ 0 は AE で持ち上がらない。
 * @param {{actionRank?:{value?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildEndMainUpdate(system) {
  const update = { "system.combatSpeed.current": 0 };
  if (system?.actionRank) update["system.actionRank.value"] = arDecrement(system.actionRank.value);
  return update;
}

/**
 * イニシアチブプロセスで行動不能(RL 判断)のときの記帳(§4)＝AR−1。
 * @param {{actionRank?:{value?:number}}} system
 * @returns {Record<string, number>}
 */
export function buildCantActUpdate(system) {
  if (!system?.actionRank) return {};
  return { "system.actionRank.value": arDecrement(system.actionRank.value) };
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

// ─── 割り込み(挿入メイン)＝メインプロセスの割り込み・追加行動(フェーズ13-5) ──────────────
// 正本: Combat_Flow「割り込み(挿入メイン)」。イニシアチブでの割り込み(自分のメインを順番外で行う)
// と追加行動技能(別キャラに順番外のメインを与える)は、同じ「指定キャラに順番外のメインを挿入する」
// プリミティブに還元される。割り込みの起点は宣言/判定用途が対象に立てる「割り込み許可フラグ」で、
// トラッカーの入口はそのフラグでゲートされる(=手動・完全自動化しない)。
//
// **メインプロセス中の割り込みは、その時点でそのメインを終了する**(2026-07-22 ユーザー確定)——
// 割り込みのメインが終わっても、終了した元のメインには戻らない。ゆえに戻り先は常にサブターン。
// 通常メイン中の割り込みなら戻り先は「そのメイン終了後＝イニシアチブ」(追加行動技能=Aのメジャーを
// 犠牲に別キャラが行動する形と一致)。挿入メイン中の割り込みは、現在の挿入メインを終了しつつ元の
// 戻り先(サブターン)を引き継ぐ。挿入メインは通常メインと違い CS には触れず、終了時の AR−1 は
// 専用ボタンで**任意**に行う。

/** 割り込みの戻り先(サブターン)判定用のフェーズ集合。 */
const INTERRUPT_WALK = new Set(["setup", "initiative", "cleanup"]);

/**
 * 割り込み(挿入メイン)開始の計画。メイン中(通常/挿入いずれも phase==="main")の割り込みは、その
 * メインを終了する(endMainId=終了する行動者・記帳は Foundry 側)。挿入メインへの遷移フラグ自体は
 * 呼び出し側で固定(phase="main"・mainCombatantId=insertId・spot=null)するため、ここでは終了対象と
 * 戻り先だけを計画する。
 * @param {{phase, mainCombatantId, spotCombatantId, interruptMainId, interruptReturn}} current 現在の進行状態
 * @param {string} insertId 挿入メインに据える combatant id
 * @returns {{endMainId: string|null, interruptMainId: string,
 *            interruptReturn: {phase:string|null, spotId:string|null}|null}}
 */
export function planInterruptStart(current, insertId) {
  const inMain = current?.phase === "main";
  const inInterrupt = (current?.interruptMainId ?? null) !== null;
  // メイン中(通常メインは mainCombatantId・挿入メインは interruptMainId)なら、そのメインを終了する
  const endMainId = inMain ? (current.interruptMainId ?? current.mainCombatantId ?? null) : null;
  let interruptReturn;
  if (inInterrupt) {
    interruptReturn = current.interruptReturn ?? null;         // 元のサブターンへ戻る(引き継ぎ)
  } else if (inMain) {
    interruptReturn = { phase: "initiative", spotId: null };   // 通常メイン終了後=イニシアチブ(spot 再算出)
  } else {
    interruptReturn = { phase: current?.phase ?? null, spotId: current?.spotCombatantId ?? null };
  }
  return { endMainId, interruptMainId: insertId, interruptReturn };
}

/**
 * 割り込み(挿入メイン)終了の計画=退避したサブターン位置へ戻る。spotId が null のサブターン
 * (通常メイン終了後のイニシアチブ等)は spot を再算出する(recomputeSpot=true)。
 * @param {{phase:string|null, spotId:string|null}|null} interruptReturn
 * @returns {{phase:string|null, spotId:string|null, recomputeSpot:boolean}}
 */
export function planInterruptEnd(interruptReturn) {
  const phase = interruptReturn?.phase ?? null;
  const spotId = interruptReturn?.spotId ?? null;
  return { phase, spotId, recomputeSpot: spotId === null && INTERRUPT_WALK.has(phase) };
}

/**
 * 挿入メイン終了の記帳(アクター側)。**CS には触れない**(通常メインの CS→0 は挿入メインには
 * 適用しない=2026-07-22 ユーザー確定。指定されたのは AR のみ)。`decrementAr` のときだけ AR−1
 * (「AR を−1して終了」ボタン)。「終了」ボタン(AR 据え置き)は記帳なし=空を返す。
 * @param {{actionRank?:{value?:number}}} system
 * @param {{decrementAr?:boolean}} [opts]
 * @returns {Record<string, number>}
 */
export function buildInterruptEndUpdate(system, { decrementAr = false } = {}) {
  if (!decrementAr || !system?.actionRank) return {};
  return { "system.actionRank.value": arDecrement(system.actionRank.value) };
}
