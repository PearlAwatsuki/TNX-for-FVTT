/**
 * @fileoverview TnxCombat — カット進行の Combat 派生クラス(フェーズ13-2/13-3/13-4)。
 *
 * TNX の戦闘は「カット進行」で、1 Foundry Combat ＝ 1 カット進行 ＝ 1(戦闘)シーン、
 * **1 カット ＝ 1 ラウンド**(正本 Combat_Flow.md「トラッカー上の表現＝サブターンモデル」)。
 *
 * サブターンモデル(2026-07-22 ユーザー確定):
 * - メインプロセス＝キャラクターのターン。セットアップ/イニシアチブ/クリンナップ＝特定キャラに
 *   紐づかない全体の場(サブターン)。フェーズは flags に滞在状態として持つ。
 * - イニシアチブは次のメイン行動者(CSカレント最大かつ AR≥1)を**状態から確認する場**。RL は指名しない。
 * - 進行は nextTurn 1本(advanceCut)。行動そのものはアイテムロール等で行い、トラッカーは進行と宣言のみ。
 * - 宣言: 待機=候補の操作者(CSカレント→1)・行動不能=RL(AR−1)。
 *
 * 記帳値の算出は純ロジック(combat-progression.mjs / combat-seed-logic.mjs / combat-turn-order.mjs)、
 * 本クラスは適用のみ。プレイヤーの「手番終了」は GM へソケット委譲(cutAdvance)する。
 */

import { buildCombatSeedUpdate } from "../module/combat-seed-logic.mjs";
import {
  planAdvance,
  buildEndMainUpdate,
  buildCantActUpdate,
  buildWaitUpdate,
  buildSetupConfirmUpdate,
  planInterruptStart,
  planInterruptEnd,
  buildInterruptEndUpdate,
} from "../module/combat-progression.mjs";
import { compareTurnOrder, nextActiveMain, firstSpotId, nextSpotId, PHASE_TIMING_KEY } from "../module/combat-turn-order.mjs";
import { resolveConsumeRowsForActor, isConsumptionDepleted } from "../module/usage-consumption.mjs";
import { actorCannotMainProcess } from "../module/conditions.mjs";
import { TnxSocketHandler } from "../module/tnx-socket-handler.mjs";

/** スポット走査(プロセスごとの行動権の巡回)を持つサブターンのフェーズ。 */
const WALK_PHASES = new Set(["setup", "initiative", "cleanup"]);

/** 本システムのドキュメントフラグのスコープ(＝system id)。 */
const TNX_SCOPE = "tokyo-nova-axleration";

/** アクターに空でない update を適用する(呼び出し側で権限を保証)。 */
async function applyActorUpdate(actor, update) {
  if (actor && !foundry.utils.isEmpty(update)) await actor.update(update);
}

/** combatant を手番順ロジックの素データへ写像する(csCurrent=表示中の CS 実効値)。
 *  cantAct=メインプロセスを行えない: 戦闘不能系タグ(blocksMainProcess・無視ゲート済み)の読み取り
 *  または Foundry 基本機能の脱落マーク(combatant.defeated)。専用の手動ボタンは置かない
 *  (脱落切替と機能が被るため=2026-07-22 ユーザー指摘)。 */
export function participantOf(combatant) {
  const cs = combatant.actor?.system?.combatSpeed;
  const ar = combatant.actor?.system?.actionRank;
  return {
    id: combatant.id,
    csCurrent: cs?.displayTotal ?? 0,
    csBase: cs?.baseTotal ?? 0,
    actorType: combatant.actor?.type,
    userOrder: 0, // ユーザー順の写像は後続(当面は id タイブレークに委ねる)
    ar: ar?.value ?? 0,
    cantAct: combatant.isDefeated || (combatant.actor ? actorCannotMainProcess(combatant.actor) : false),
  };
}

export class TnxCombat extends Combat {
  // ─── カット進行の状態(正本＝flags。カット番号は round そのもの) ───

  /** 現フェーズ(setup/initiative/main/cleanup)。未開始は null。 */
  get cutPhase() { return this.getFlag(TNX_SCOPE, "phase") ?? null; }

  /** 現メインプロセスの combatant id(メインターン中のみ)。 */
  get mainCombatantId() { return this.getFlag(TNX_SCOPE, "mainCombatantId") ?? null; }

  /** 挿入メイン(割り込み・追加行動)の行動者 id。通常状態は null(13-5)。 */
  get interruptMainId() { return this.getFlag(TNX_SCOPE, "interruptMainId") ?? null; }

  /** 割り込み終了時に戻るサブターン位置 {phase, spotId}。通常状態は null。 */
  get interruptReturn() { return this.getFlag(TNX_SCOPE, "interruptReturn") ?? null; }

  /**
   * サブターン内で今プロセスの行動権(スポット)を持つ combatant id。
   * セットアップ/イニシアチブ/クリンナップ中のみ。走査を終えていれば null。
   */
  get spotCombatantId() {
    if (!WALK_PHASES.has(this.cutPhase)) return null;
    return this.getFlag(TNX_SCOPE, "spotCombatantId") ?? null;
  }

  /** 参加者の素データ(手番順ロジック用)。 */
  get cutParticipants() { return this.combatants.map(participantOf); }

  /**
   * イニシアチブで確認される「次のメイン行動者」候補の combatant id。
   * イニシアチブフェーズ以外は null(確認はイニシアチブの場で行う)。
   */
  get candidateMainId() {
    if (this.cutPhase !== "initiative") return null;
    return nextActiveMain(this.cutParticipants)?.id ?? null;
  }

  /** id から参加アクターを引く。 */
  actorOf(combatantId) { return this.combatants.get(combatantId)?.actor ?? null; }

  /**
   * サブターンのプロセスで手番が回る combatant id の集合(13-6)。そのプロセスのタイミング
   * (process:<key>)の用途を「使える」形(消費が枯渇していない)で持つ参加者だけにスポットが止まり、
   * それ以外は「次へ」で自動的に飛ばす。**プロセス自体は自動通過しない**——手番が回る者が居なければ
   * スポットは立たない(手番なし)が、その場合も「次へ」を押して初めて既定処理が走り次プロセスへ進む
   * (誰にも手番を渡さず既定処理だけ、の形)。非サブターン(main 等)は絞り込みなし=null を返す。
   * @param {string} phase
   * @returns {Set<string>|null}
   */
  _eligibleSpotIds(phase) {
    const timingKey = PHASE_TIMING_KEY[phase];
    if (!timingKey) return null;
    const ids = new Set();
    for (const c of this.combatants) {
      if (c.actor && TnxCombat._actorHasProcessAction(c.actor, timingKey)) ids.add(c.id);
    }
    return ids;
  }

  /**
   * アクターが指定プロセスのタイミングの用途を「使える」形で持つか。
   * - タイミングが process:<timingKey> の用途で、戦闘タブに表示する(hideInCombatTab でない)もの。
   * - かつ消費リソースが枯渇していない(消費設定が無い用途は常に使える=ユーザー厳命)。
   * @param {Actor} actor
   * @param {string} timingKey timing.processName の値(setup/initiative/clean-up)
   * @returns {boolean}
   */
  static _actorHasProcessAction(actor, timingKey) {
    for (const item of actor.items) {
      for (const usage of (item.system?.actions ?? [])) {
        if (usage.hideInCombatTab === true) continue;
        if (usage.timing?.value !== "process" || usage.timing?.processName !== timingKey) continue;
        const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
        if (!isConsumptionDepleted(rows)) return true;
      }
    }
    return false;
  }

  /** combatant id → turns 配列の位置(core の turn 同期用)。不在・null は null。 */
  _turnIndexOf(combatantId) {
    if (!combatantId) return null;
    const i = this.turns.findIndex(c => c.id === combatantId);
    return i >= 0 ? i : null;
  }

  /**
   * トラッカーの表示ソートを TNX の手番順に上書きする(既定は達成値降順)。
   * CSカレント降順＋同値優先順位(Combat_Flow §3)。エキストラは末尾に並ぶ(表示には残す)。
   * @override
   */
  _sortCombatants(a, b) {
    return compareTurnOrder(participantOf(a), participantOf(b));
  }

  // ─── 進行(サブターンモデル・nextTurn 1本) ───

  /**
   * @override カット進行の開始。core は「combatStart フック発火→ {round:1, turn:0} を update」の
   * 順で、フック内から別 update を投げると本体更新に上書きされ・競合する(実機で発覚: turn が
   * turns[0] に固定・AR シードが届かない)。そこで core の型(フックに updateData を渡してから
   * 1回で update)を踏襲し、round・turn(スポット位置)・フェーズ flags を**単一の update** にまとめ、
   * その後にシード(CSカレント←CS 実効値・AR←付与値=セットアップ開始時の代入)を行う。
   */
  async startCombat() {
    this._playCombatSound("startEncounter");
    // シードを combat 更新より**先**に行う: セットアップに入った時点で AR/CSカレントが
    // 付与済みでなければならない(2026-07-22 ユーザー指摘。AR は「カット進行のシーン開始時に付与」)。
    // 表示の派生(inCombat)は round 変更の updateCombat フック(全クライアント reset)が追随させる
    await TnxCombat.seedStartValues(this.combatants.map(c => c.actor).filter(Boolean));
    // セットアップに手番が回る参加者(そのタイミングの用途を持つ者)だけスポットを立てる(13-6)
    const spotId = firstSpotId(this.cutParticipants, this._eligibleSpotIds("setup"));
    const updateData = {
      round: 1,
      turn: this._turnIndexOf(spotId),
      [`flags.${TNX_SCOPE}.phase`]: "setup",
      [`flags.${TNX_SCOPE}.mainCombatantId`]: null,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: spotId,
      // 割り込み状態は開始時にクリア(前回のカット進行の残骸を持ち越さない・13-5)
      [`flags.${TNX_SCOPE}.interruptMainId`]: null,
      [`flags.${TNX_SCOPE}.interruptReturn`]: null,
    };
    Hooks.callAll("combatStart", this, updateData);
    await this.update(updateData);
    return this;
  }

  /**
   * 「次へ」＝形を変えた「次のターンへ」(nextTurn 1本)。
   * - サブターン(setup/initiative/cleanup)中: スポット(プロセスの行動権)を CS順の次のキャラへ渡す。
   *   走査を終えていればフェーズ送り(advancePhase)。
   * - メインターン中: 手番終了(常に AR−1・CSカレント0)→ イニシアチブへ戻る。
   */
  async advanceCut() {
    if (!game.user.isGM) return this;
    // 挿入メイン(割り込み)中は通常の前進を行わない——終了は専用ボタン(endInterrupt)。core の
    // キーバインド等から nextTurn が来ても記帳(通常メイン終了=AR−1・CS0)で退避を壊さないためのガード。
    if (this.interruptMainId) return this;
    const phase = this.cutPhase;
    if (WALK_PHASES.has(phase)) {
      const spot = this.getFlag(TNX_SCOPE, "spotCombatantId") ?? null;
      if (spot === null) return this.advancePhase(); // 走査済み(または対象なし)
      // 手番はそのプロセスの用途を持つ参加者にだけ回す(用途なし・消費枯渇は飛ばす・13-6)
      const next = nextSpotId(this.cutParticipants, spot, this._eligibleSpotIds(phase));
      if (next === null) return this.advancePhase(); // 最後のキャラまで渡し終えた
      // core の turn(ターンプレイヤー)もスポットに同期して進める
      await this.update({
        turn: this._turnIndexOf(next),
        [`flags.${TNX_SCOPE}.spotCombatantId`]: next,
      });
      return this;
    }
    if (phase === "main") return this.advancePhase();
    return this;
  }

  /**
   * フェーズ送り(GM のみ・計画は planAdvance)。RL が残りのスポット走査を飛ばす場合もこれ。
   * - setup→initiative: セットアップ末確定(current ← valueTotal+currentBuff を全員へ焼き込み)
   * - initiative→main: 候補(CSカレント最大かつAR≥1)を確認してメインターンへ(turn も同期)
   * - initiative→cleanup: 行動可能者なし
   * - main→initiative: メイン終了の記帳(常に AR−1・CSカレント0＝「何もしないメジャー」も消費)
   * - cleanup→setup: 次カット(round+1・再シード=AR全回復を含む)
   */
  async advancePhase() {
    if (!game.user.isGM) return this;
    const plan = planAdvance(this.cutPhase, this.cutParticipants);
    if (!plan) return this;

    // フェーズ離脱時の記帳(アクター側)
    if (plan.confirmSetup) {
      for (const c of this.combatants) {
        if (c.actor) await applyActorUpdate(c.actor, buildSetupConfirmUpdate(c.actor.system));
      }
    }
    if (plan.endMain) {
      const actor = this.actorOf(this.mainCombatantId);
      if (actor) await applyActorUpdate(actor, buildEndMainUpdate(actor.system));
    }
    // イニシアチブの確認: 行動できないのに CS 最上位に来た者の AR−1(Combat_Flow §4・自動記帳)
    for (const id of (plan.penalizedIds ?? [])) {
      const actor = this.actorOf(id);
      if (actor) await applyActorUpdate(actor, buildCantActUpdate(actor.system));
    }

    // 次カットのセットアップ開始＝再シード(CSカレント←CS・AR←付与値=クリンナップの AR 全回復を
    // 含む)。combat 更新より**先**に行う(セットアップに入る時点で付与済み・2026-07-22 ユーザー指摘)
    if (plan.nextCut) {
      await TnxCombat.seedStartValues(this.combatants.map(c => c.actor).filter(Boolean));
    }

    // フェーズ遷移(combat 側)。core の turn(ターンプレイヤー)は常に「今の番」——メインターン中は
    // メイン行動者・サブターン中はスポット——へ同期する(正本はあくまで flags)。
    // 遷移先がサブターンなら、そのプロセスの用途を持つ参加者の先頭にスポットを置く(記帳・再シード後の値で算出)。
    const spotId = WALK_PHASES.has(plan.to)
      ? firstSpotId(this.cutParticipants, this._eligibleSpotIds(plan.to)) : null;
    const update = {
      turn: this._turnIndexOf(plan.to === "main" ? plan.mainId : spotId),
      [`flags.${TNX_SCOPE}.phase`]: plan.to,
      [`flags.${TNX_SCOPE}.mainCombatantId`]: plan.mainId ?? null,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: spotId,
    };
    if (plan.nextCut) update.round = this.round + 1;
    await this.update(update);
    return this;
  }

  /**
   * @override 行動権・進行を次へ渡す(FVTT 既定機構)。GM は直接前進、
   * スポット/手番プレイヤーの「次へ」「手番終了」は GM へソケット委譲する。
   */
  async nextTurn() {
    if (game.user.isGM) return this.advanceCut();
    TnxSocketHandler.emitCutAdvance({ combatId: this.id });
    return this;
  }

  /** @override 次カットへ(クリンナップからのみ)。それ以外は通常の前進を促す。 */
  async nextRound() {
    if (this.cutPhase !== "cleanup") {
      ui.notifications.warn("次カットへはクリンナッププロセスから進みます。");
      return this;
    }
    return this.advancePhase();
  }

  /** @override カット進行に「戻る」操作はない(記帳の巻き戻しが定義できないため)。 */
  async previousTurn() {
    ui.notifications.warn("カット進行では手番を戻す操作はありません。");
    return this;
  }

  /** @override 同上。 */
  async previousRound() {
    ui.notifications.warn("カット進行ではカットを戻す操作はありません。");
    return this;
  }

  // ─── 宣言(トラッカーが持つのは進行と宣言だけ) ───

  /**
   * 待機(§4)。イニシアチブで確認された候補本人の操作者(所有者)か RL が宣言し、
   * CSカレントを 1 にして確認し直す(自アクター更新のため所有者はローカルで完結)。
   */
  async declareWait(combatantId) {
    if (this.cutPhase !== "initiative" || combatantId !== this.candidateMainId) {
      ui.notifications.warn("待機はイニシアチブプロセスで、直後にメインプロセスを行えるキャラクターだけが宣言できます。");
      return;
    }
    const actor = this.actorOf(combatantId);
    if (!actor) return;
    if (!actor.isOwner) {
      ui.notifications.warn("待機はそのキャラクターの操作者が宣言します。");
      return;
    }
    await applyActorUpdate(actor, buildWaitUpdate());
  }

  // ─── 割り込み(挿入メイン)＝メインプロセスの割り込み・追加行動(13-5) ────────────────
  // トラッカーの割り込み入口(canInterrupt フラグでゲート)から起動する。指定キャラを順番外の
  // メイン行動者に据え、元の進行位置を退避する。終了で退避位置へ戻る。combat フラグの更新は GM
  // 権限が要るため、非 GM(入口を押した対象の操作者)はソケットで GM に委譲する。

  /**
   * 割り込み(挿入メイン)を開始する。指定キャラを順番外のメイン行動者に据える。**メインプロセス中
   * (通常/挿入いずれも)の割り込みは、その時点でそのメインを終了する**(記帳=AR−1・CS0)——終了した
   * メインには戻らない(2026-07-22 ユーザー確定)。戻り先は常にサブターン(通常メイン中なら
   * イニシアチブ・サブターン中ならその位置)。行使したら対象の割り込み許可フラグを消費(ワンショット)。
   * @param {string} combatantId 割り込ませる combatant id
   */
  async startInterrupt(combatantId) {
    if (!game.user.isGM) {
      TnxSocketHandler.emitInterruptStart({ combatId: this.id, combatantId });
      return this;
    }
    const target = this.combatants.get(combatantId);
    if (!target) return this;
    const plan = planInterruptStart({
      phase: this.cutPhase,
      mainCombatantId: this.mainCombatantId,
      spotCombatantId: this.getFlag(TNX_SCOPE, "spotCombatantId") ?? null,
      interruptMainId: this.interruptMainId,
      interruptReturn: this.interruptReturn,
    }, combatantId);
    // メイン中の割り込みは、その時点でそのメインを終了する(通常メイン終了と同じ記帳=AR−1・CS0)
    if (plan.endMainId) {
      const ended = this.actorOf(plan.endMainId);
      if (ended) await applyActorUpdate(ended, buildEndMainUpdate(ended.system));
    }
    await this.update({
      turn: this._turnIndexOf(combatantId),
      [`flags.${TNX_SCOPE}.phase`]: "main",
      [`flags.${TNX_SCOPE}.mainCombatantId`]: combatantId,
      [`flags.${TNX_SCOPE}.interruptMainId`]: plan.interruptMainId,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: null,
      [`flags.${TNX_SCOPE}.interruptReturn`]: plan.interruptReturn,
    });
    if (target.getFlag(TNX_SCOPE, "canInterrupt")) await target.unsetFlag(TNX_SCOPE, "canInterrupt");
    return this;
  }

  /**
   * 挿入メインを終了して退避したサブターン位置へ復帰する(元のメインには戻らない)。
   * @param {{decrementAr?:boolean}} [opts] decrementAr=true で AR−1(「AR を−1して終了」)。
   *   false は AR 据え置き(「終了」)。CS はどちらも据え置き(2026-07-22 ユーザー確定)。
   */
  async endInterrupt({ decrementAr = false } = {}) {
    if (!game.user.isGM) {
      TnxSocketHandler.emitInterruptEnd({ combatId: this.id, decrementAr });
      return this;
    }
    if (!this.interruptMainId) return this;
    const actor = this.actorOf(this.interruptMainId);
    if (actor) await applyActorUpdate(actor, buildInterruptEndUpdate(actor.system, { decrementAr }));
    const plan = planInterruptEnd(this.interruptReturn);
    // 通常メイン終了後のイニシアチブ等(spot 未保存)は、復帰時点の値でスポット先頭を算出し直す
    const spotId = plan.recomputeSpot ? firstSpotId(this.cutParticipants) : plan.spotId;
    await this.update({
      turn: this._turnIndexOf(spotId),
      [`flags.${TNX_SCOPE}.phase`]: plan.phase,
      [`flags.${TNX_SCOPE}.mainCombatantId`]: null,
      [`flags.${TNX_SCOPE}.interruptMainId`]: null,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: spotId,
      [`flags.${TNX_SCOPE}.interruptReturn`]: null,
    });
    return this;
  }

  // ─── カット開始シード(フェーズ10-5/11 から移設) ───

  /**
   * CSカレント・現在AR へ実効値を書き込む(GM のみ)。セットアップ開始時/開始済みカットへの参加時。
   * 次カットの再シードはクリンナップの AR 全回復(§6-5)を兼ねる。
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
   * カット進行の開始/終了・参加/離脱で再準備(reset)して表示を切り替える。
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
