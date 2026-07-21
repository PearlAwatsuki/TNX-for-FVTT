/**
 * @fileoverview TnxCombat — カット進行の Combat 派生クラス(フェーズ13-2/13-3)。
 *
 * TNX の戦闘は「カット進行」で、1 Foundry Combat ＝ 1 カット進行 ＝ 1(戦闘)シーン
 * (正本 Combat_Flow.md)。本クラスはその状態機械で、カット進行の状態(現プロセス・カット番号・
 * 手番)を **flags.tokyo-nova-axleration** に持つ(正本)。
 *
 * - 13-2: クラス新設・CONFIG 登録・カット開始シードのロジック集約。
 * - 13-3: プロセス状態機械(セットアップ/イニシアチブ/メイン/クリンナップ)と、遷移に伴う
 *   CS/AR の自動記帳。RL がトラッカーで進め、システムは記帳と手番提示を行う(RL駆動＋自動記帳)。
 *   記帳値の算出は純ロジック(combat-progression.mjs / combat-seed-logic.mjs)、本クラスは適用のみ。
 *
 * トラッカー UI(ボタン)は 13-3 のメソッドを呼ぶ 13-4 で追加する。境界イベント(カット/シーン)は 13-6。
 */

import { buildCombatSeedUpdate } from "../module/combat-seed-logic.mjs";
import {
  isValidProcessTransition,
  buildEndMainUpdate,
  buildCantActUpdate,
  buildWaitUpdate,
  buildCleanupUpdate,
  buildSetupConfirmUpdate,
} from "../module/combat-progression.mjs";
import { compareTurnOrder } from "../module/combat-turn-order.mjs";

/** 本システムのドキュメントフラグのスコープ(＝system id)。 */
const TNX_SCOPE = "tokyo-nova-axleration";

/** アクターに空でない update を適用する(呼び出し側で GM を保証)。 */
async function applyActorUpdate(actor, update) {
  if (actor && !foundry.utils.isEmpty(update)) await actor.update(update);
}

/** combatant を手番順ロジックの素データへ写像する(csCurrent=表示中の CS 実効値)。 */
function participantOf(combatant) {
  const cs = combatant.actor?.system?.combatSpeed;
  const ar = combatant.actor?.system?.actionRank;
  return {
    id: combatant.id,
    csCurrent: cs?.displayTotal ?? 0,
    csBase: cs?.baseTotal ?? 0,
    actorType: combatant.actor?.type,
    userOrder: 0, // ユーザー順の写像は後続(当面は id タイブレークに委ねる)
    ar: ar?.value ?? 0,
  };
}

export class TnxCombat extends Combat {
  // ─── カット進行の状態(正本＝flags.tokyo-nova-axleration) ───

  /** 現プロセス(prep/setup/initiative/main/cleanup)。未開始は null。 */
  get cutProcess() { return this.getFlag(TNX_SCOPE, "process") ?? null; }

  /** カット番号(1 始まり)。未開始は 0。 */
  get cutNumber() { return this.getFlag(TNX_SCOPE, "cut") ?? 0; }

  /** 現メインプロセスの combatant id(手番)。未定は null。 */
  get activeMainId() { return this.getFlag(TNX_SCOPE, "activeMainId") ?? null; }

  /** カット進行の状態フラグをまとめて更新する。 */
  async setCutState(patch) {
    const data = {};
    for (const [k, v] of Object.entries(patch)) data[`flags.${TNX_SCOPE}.${k}`] = v;
    await this.update(data);
  }

  /** id から参加アクターを引く。 */
  actorOf(combatantId) { return this.combatants.get(combatantId)?.actor ?? null; }

  /**
   * トラッカーの表示ソートを TNX の手番順に上書きする(既定は達成値降順)。
   * CSカレント降順＋同値優先順位(Combat_Flow §3)。エキストラは末尾に並ぶ(表示には残す)。
   * @override
   */
  _sortCombatants(a, b) {
    return compareTurnOrder(participantOf(a), participantOf(b));
  }

  // ─── プロセス遷移＋自動記帳(13-3・GM のみ・記帳値は純ロジックが算出) ───

  /**
   * セットアッププロセスへ入る(カット開始/次カット)。CSカレント←CS 実効値・AR←付与値を
   * 全参加アクターへ代入する(Combat_Flow の読み替え＝セットアップ開始時に代入)。
   * cleanup からの遷移はカット番号を +1、それ以外(カット開始)は 1。
   */
  async enterSetup() {
    if (!game.user.isGM) return;
    const from = this.cutProcess;
    if (!isValidProcessTransition(from, "setup")) return;
    const cut = from === "cleanup" ? this.cutNumber + 1 : 1;
    await this.setCutState({ process: "setup", cut, activeMainId: null });
    await TnxCombat.seedStartValues(this.combatants.map(c => c.actor).filter(Boolean));
  }

  /**
   * イニシアチブプロセスへ入る(セットアップ末の「確定」)。ここで CSカレントを一度決定して凍結する:
   * 各参加アクターの `current ← valueTotal + currentBuff`(CS実効値＋セットアップ起動のバフ)を焼き込む
   * (2026-07-21 ユーザー確定「一度計算して凍結」)。以後 currentTotal は current のみで AE を毎回足さない
   * ため、メジャー後0/待機1 が AE で変更されず、CS を変える効果は次セットアップの再決定まで出ない。
   */
  async enterInitiative() {
    if (!game.user.isGM) return;
    if (!isValidProcessTransition(this.cutProcess, "initiative")) return;
    for (const c of this.combatants) {
      if (c.actor) await applyActorUpdate(c.actor, buildSetupConfirmUpdate(c.actor.system));
    }
    await this.setCutState({ process: "initiative" });
  }

  /** メインプロセスを指定 combatant に割り当てる(RL 確定・提示は nextActiveMain)。 */
  async assignMain(combatantId) {
    if (!game.user.isGM) return;
    if (!isValidProcessTransition(this.cutProcess, "main")) return;
    await this.setCutState({ process: "main", activeMainId: combatantId });
  }

  /**
   * メインプロセスを終える(→イニシアチブ)。メジャーを行っていれば AR−1・CSカレント0(§5)。
   * @param {{didMajor?:boolean}} opts
   */
  async endMain({ didMajor = false } = {}) {
    if (!game.user.isGM) return;
    if (!isValidProcessTransition(this.cutProcess, "initiative")) return;
    const actor = this.actorOf(this.activeMainId);
    if (actor) await applyActorUpdate(actor, buildEndMainUpdate(actor.system, { didMajor }));
    await this.setCutState({ process: "initiative", activeMainId: null });
  }

  /** 待機(§4)＝そのアクターの CSカレントを 1 にする(手番の確認をやり直す)。 */
  async declareWait(combatantId) {
    if (!game.user.isGM) return;
    await applyActorUpdate(this.actorOf(combatantId), buildWaitUpdate());
  }

  /** イニシアチブで行動不能(§4)＝そのアクターの AR を −1 する。 */
  async declareCantAct(combatantId) {
    if (!game.user.isGM) return;
    const actor = this.actorOf(combatantId);
    if (actor) await applyActorUpdate(actor, buildCantActUpdate(actor.system));
  }

  /** クリンナッププロセスへ入る(§6)。全参加アクターの AR を全回復する。 */
  async enterCleanup() {
    if (!game.user.isGM) return;
    if (!isValidProcessTransition(this.cutProcess, "cleanup")) return;
    await this.setCutState({ process: "cleanup", activeMainId: null });
    for (const c of this.combatants) {
      if (c.actor) await applyActorUpdate(c.actor, buildCleanupUpdate(c.actor.system));
    }
  }

  // ─── カット開始シード(フェーズ10-5/11 から移設・挙動不変) ───

  /**
   * CSカレント・現在AR へ実効値を書き込む(GM のみ)。カット開始時/開始済みカットへの参加時。
   * @param {Actor[]} actors
   */
  static async seedStartValues(actors) {
    if (!game.user.isGM) return;
    for (const actor of actors) {
      if (!actor) continue;
      const update = buildCombatSeedUpdate(actor.system);
      if (foundry.utils.isEmpty(update)) continue;
      await actor.update(update);
    }
  }

  /**
   * 該当アクターの派生値を再準備し、開いているシートを再描画する(全クライアント・ローカルのみ)。
   * シートの「CS」「AR」表示は自動制御(カット進行中=カレント・現在AR／それ以外=CS・付与値)のため、
   * 戦闘の開始/終了・参加/離脱で再準備(reset)して表示を切り替える。
   * @param {Actor[]} actors
   */
  static refreshDisplays(actors) {
    for (const actor of actors) {
      if (!actor) continue;
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render(false);
    }
  }
}
