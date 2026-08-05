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
  buildArDecrementUpdate,
  buildWaitUpdate,
  buildSetupConfirmUpdate,
  pushInterruptFrame,
  popInterruptFrame,
} from "../module/combat-progression.mjs";
import { compareTurnOrder, nextActiveMain, firstSpotId, nextSpotId, PHASE_TIMING_KEY } from "../module/combat-turn-order.mjs";
import { resolveConsumeRowsForActor, isConsumptionDepleted } from "../module/usage-consumption.mjs";
import { TNX_HOOKS, planPhaseEvents } from "../module/combat-events.mjs";
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

  /**
   * 割り込み(挿入メイン)の退避スタック(2026-07-26 サスペンド／レジューム)。各要素は割り込み開始時に
   * 退避した進行状態フレーム。空=割り込み中でない。入れ子の割り込みは複数フレームが積まれる。
   */
  get interruptStack() { return this.getFlag(TNX_SCOPE, "interruptStack") ?? []; }

  /** 割り込み中か(退避スタックが空でない=現在走っているのは挿入メイン)。 */
  get inInterrupt() { return this.interruptStack.length > 0; }

  /**
   * 現在走っている挿入メインが AR を消費するか(consumesAr・2026-07-26)。割り込み中でないときは null。
   * 真=終了時に majorActed へ AR−1＋CS0(一般則)・偽=無償(追加行動の肩代わり)。
   */
  get interruptConsumesAr() { return this.getFlag(TNX_SCOPE, "interruptConsumesAr") ?? null; }

  /** 挿入メイン(割り込み・追加行動)の行動者 id。割り込み中の現メイン=挿入メイン。通常状態は null。 */
  get interruptMainId() { return this.inInterrupt ? this.mainCombatantId : null; }

  /**
   * 現プロセスでメジャーアクションを行った combatant id の配列(2026-07-26 一般則)。
   * プロセス終了時、この各人に AR−1＋CSカレント0 を適用してクリアする(空メジャー廃止)。
   */
  get majorActed() { return this.getFlag(TNX_SCOPE, "majorActed") ?? []; }

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
      // 割り込み状態・メジャー追跡は開始時にクリア(前回のカット進行の残骸を持ち越さない)
      [`flags.${TNX_SCOPE}.interruptStack`]: [],
      [`flags.${TNX_SCOPE}.interruptConsumesAr`]: null,
      [`flags.${TNX_SCOPE}.majorActed`]: [],
    };
    Hooks.callAll("combatStart", this, updateData);
    await this.update(updateData);
    // カット進行(＝シーン)開始・カット1開始・セットアップ開始の境界イベント(適用はフェーズ15・13-6)
    Hooks.callAll(TNX_HOOKS.cutProgressionStart, this, {});
    Hooks.callAll(TNX_HOOKS.cutStart, this, { cut: 1 });
    Hooks.callAll(TNX_HOOKS.processStart, this, { phase: "setup", combatantId: null, cut: 1 });
    return this;
  }

  /**
   * 「次へ」＝形を変えた「次のターンへ」(nextTurn 1本)。
   * - サブターン(setup/initiative/cleanup)中: スポット(プロセスの行動権)を CS順の次のキャラへ渡す。
   *   走査を終えていればフェーズ送り(advancePhase)。
   * - メインターン中: 手番終了(メジャーを行っていれば AR−1・CSカレント0)→ イニシアチブへ戻る。
   */
  async advanceCut() {
    if (!game.user.isGM) return this;
    // 挿入メイン(割り込み)中は通常の前進を行わない——終了は専用ボタン(endInterrupt)。core の
    // キーバインド等から nextTurn が来ても、退避スタックを壊さないためのガード。
    if (this.inInterrupt) return this;
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
   * - どのプロセス終了時も、そのプロセスでメジャーを行った者(majorActed)へ AR−1＋CSカレント0
   *   (2026-07-26 一般則。空メジャー廃止＝メジャーを実際に行った者だけ消費)
   * - cleanup→setup: 次カット(round+1・再シード=AR全回復を含む)
   */
  async advancePhase() {
    if (!game.user.isGM) return this;
    const fromPhase = this.cutPhase;
    if (!fromPhase) return this;
    // 境界イベント計画用に遷移前の状態を退避(発火は update 後・13-6)
    const fromMainId = this.mainCombatantId;
    const fromCut = this.round;

    // 1. 離脱プロセスの記帳(順序が重要)。
    //   setup 末: CSカレント確定(全員・凍結モデル)
    if (fromPhase === "setup") {
      for (const c of this.combatants) {
        if (c.actor) await applyActorUpdate(c.actor, buildSetupConfirmUpdate(c.actor.system));
      }
    }
    //   プロセス終了: そのプロセスでメジャーアクションを行った者に AR−1＋CSカレント0(空メジャー廃止・
    //   AR減少⟺CS0・2026-07-26 一般則)。**confirmMain より先**に適用し、行動済みの者が次のメイン候補に
    //   来ないようにする。majorActed はメジャー実行フック(markMajorAction)が積む。
    for (const id of this.majorActed) {
      const actor = this.actorOf(id);
      if (actor) await applyActorUpdate(actor, buildArDecrementUpdate(actor.system));
    }

    // 2. 遷移計画(記帳後の状態で confirmMain を算出する)
    const plan = planAdvance(fromPhase, this.cutParticipants);
    if (!plan) return this;

    // 3. 行動不能(イニシアチブで CS 最上位なのに行動できない者)の AR−1＋CS0(Combat_Flow §4)
    for (const id of (plan.penalizedIds ?? [])) {
      const actor = this.actorOf(id);
      if (actor) await applyActorUpdate(actor, buildArDecrementUpdate(actor.system));
    }

    // 4. 次カットのセットアップ開始＝再シード(CSカレント←CS・AR←付与値=クリンナップの AR 全回復を
    // 含む)。combat 更新より**先**に行う(セットアップに入る時点で付与済み・2026-07-22 ユーザー指摘)
    if (plan.nextCut) {
      await TnxCombat.seedStartValues(this.combatants.map(c => c.actor).filter(Boolean));
    }

    // 5. フェーズ遷移(combat 側)。core の turn は常に「今の番」へ同期。majorActed はクリア(新プロセスは空)。
    const spotId = WALK_PHASES.has(plan.to)
      ? firstSpotId(this.cutParticipants, this._eligibleSpotIds(plan.to)) : null;
    const update = {
      turn: this._turnIndexOf(plan.to === "main" ? plan.mainId : spotId),
      [`flags.${TNX_SCOPE}.phase`]: plan.to,
      [`flags.${TNX_SCOPE}.mainCombatantId`]: plan.mainId ?? null,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: spotId,
      [`flags.${TNX_SCOPE}.majorActed`]: [],
    };
    if (plan.nextCut) update.round = this.round + 1;
    await this.update(update);
    // 境界イベントを発火(離脱プロセス終了→[次カット境界]→遷移先開始)。適用はフェーズ15 が購読(13-6)
    for (const e of planPhaseEvents({
      fromPhase, fromMainId, toPhase: plan.to, toMainId: plan.mainId ?? null,
      nextCut: !!plan.nextCut, round: fromCut,
    })) {
      Hooks.callAll(e.hook, this, e.data);
    }
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

  /**
   * @override カット進行の終了(案1・2026-07-22 ユーザー確定)。Foundry 既定の「戦闘終了?」確認を、
   * シーンも終了するかの3択に置き換える。カット進行終了とシーン終了は非連動(RL がシーン内で治療まで
   * 認める運用等のため)。境界イベント(適用はフェーズ15 が購読・13-6)を発火してから delete する。
   */
  async endCombat() {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "カット進行の終了" },
      classes: ["tokyo-nova", "tnx-dialog", "tnx-scene-end-dialog"],
      content: `<p>カット進行を終了します。このシーンも終了しますか？</p>`,
      buttons: [
        { action: "scene", icon: "fas fa-flag-checkered", label: "シーンも終了する", default: true, callback: () => "scene" },
        { action: "cut",   icon: "fas fa-stop",           label: "カット進行だけ終了（シーンは継続）", callback: () => "cut" },
        { action: "cancel", icon: "fas fa-xmark",         label: "キャンセル", callback: () => "cancel" },
      ],
      rejectClose: false,
      close: () => "cancel",
    });
    if (!choice || choice === "cancel") return this;
    const sceneEnded = choice === "scene";
    // 最終カットの終了 → カット進行の終了 →(シーンも終了なら)シーン終了、の順で発火
    Hooks.callAll(TNX_HOOKS.cutEnd, this, { cut: this.round });
    Hooks.callAll(TNX_HOOKS.cutProgressionEnd, this, { sceneEnded });
    if (sceneEnded) Hooks.callAll(TNX_HOOKS.sceneEnd, this, {});
    await this.delete();
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

  // ─── 割り込み(挿入メイン)＝サスペンド／レジューム＋consumesAr(2026-07-26 全面改訂) ──────────
  // トラッカーの割り込み入口(canInterrupt フラグでゲート)から起動する。指定キャラを順番外のメイン
  // 行動者に据え、**元の進行位置(メイン/サブターンいずれも)は終了せず退避スタックへ積む(サスペンド)**。
  // 挿入メイン終了で退避位置を厳密に復元(レジューム)する。挿入メインが AR を消費するか(consumesAr)は
  // 割り込みを生じさせた用途が宣言し、combatant フラグ経由で伝搬する。combat フラグの更新は GM 権限が
  // 要るため、非 GM(入口を押した対象の操作者)はソケットで GM に委譲する。

  /**
   * 割り込み(挿入メイン)を開始する。指定キャラを順番外のメイン行動者に据え、現在の進行状態を退避
   * スタックへ積む(元のメイン/サブターンは終了しない=あとで戻る)。挿入メインが AR を消費するかは
   * 対象の combatant フラグ(interruptConsumesAr・用途宣言由来・既定=真)で決まる。行使したら対象の
   * 割り込み許可フラグを消費(ワンショット)。
   * @param {string} combatantId 割り込ませる combatant id
   */
  async startInterrupt(combatantId) {
    if (!game.user.isGM) {
      TnxSocketHandler.emitInterruptStart({ combatId: this.id, combatantId });
      return this;
    }
    const target = this.combatants.get(combatantId);
    if (!target) return this;
    // consumesAr は付与時に combatant へ載せた値(既定=真=自己割り込み・偽=追加行動の無償)
    const consumesAr = target.getFlag(TNX_SCOPE, "interruptConsumesAr") !== false;
    const { frame, next } = pushInterruptFrame({
      phase: this.cutPhase,
      mainCombatantId: this.mainCombatantId,
      spotCombatantId: this.getFlag(TNX_SCOPE, "spotCombatantId") ?? null,
      majorActed: this.majorActed,
      interruptConsumesAr: this.interruptConsumesAr,
    }, combatantId, consumesAr);
    await this.update({
      turn: this._turnIndexOf(next.mainCombatantId),
      [`flags.${TNX_SCOPE}.phase`]: next.phase,
      [`flags.${TNX_SCOPE}.mainCombatantId`]: next.mainCombatantId,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: next.spotCombatantId,
      [`flags.${TNX_SCOPE}.majorActed`]: next.majorActed,
      [`flags.${TNX_SCOPE}.interruptStack`]: [...this.interruptStack, frame],
      [`flags.${TNX_SCOPE}.interruptConsumesAr`]: next.interruptConsumesAr,
    });
    // 割り込み許可(ワンショット)と consumesAr を消費する
    if (target.getFlag(TNX_SCOPE, "canInterrupt")) await target.unsetFlag(TNX_SCOPE, "canInterrupt");
    if (target.getFlag(TNX_SCOPE, "interruptConsumesAr") !== undefined) await target.unsetFlag(TNX_SCOPE, "interruptConsumesAr");
    // 境界イベント(13-6): 退避された元プロセスは終了しない(サスペンド)ので processEnd は発火しない。
    // 挿入メインも「メインプロセス」なので開始で tnxProcessStart(phase:"main") を発火する(＝
    // メインプロセス中効果は挿入メインでも新規に有効になる)。
    Hooks.callAll(TNX_HOOKS.processStart, this, { phase: "main", combatantId, cut: this.round, viaInterrupt: true });
    return this;
  }

  /**
   * 挿入メインを終了し、退避した進行位置を厳密に復元する(サスペンド／レジューム)。この挿入メインが
   * AR を消費する(consumesAr=真)なら、挿入メインでメジャーを行った者(majorActed)へ AR−1＋CSカレント0
   * (一般則)。consumesAr=偽(追加行動)は無償(記帳なし=付与者が自分のメジャーとして肩代わり)。
   */
  async endInterrupt() {
    if (!game.user.isGM) {
      TnxSocketHandler.emitInterruptEnd({ combatId: this.id });
      return this;
    }
    if (!this.inInterrupt) return this;
    const endedId = this.mainCombatantId;
    // consumesAr のときだけ、挿入メインでメジャーを行った者に AR−1＋CS0(空メジャーは対象外)
    if (this.interruptConsumesAr) {
      for (const id of this.majorActed) {
        const actor = this.actorOf(id);
        if (actor) await applyActorUpdate(actor, buildArDecrementUpdate(actor.system));
      }
    }
    const { restore, remaining } = popInterruptFrame(this.interruptStack);
    // 復元先の turn: メイン復帰ならメイン行動者・サブターン復帰ならスポットへ(位置は退避時に保存済み)
    const restoreTurnId = restore.phase === "main" ? restore.mainCombatantId : restore.spotCombatantId;
    await this.update({
      turn: this._turnIndexOf(restoreTurnId),
      [`flags.${TNX_SCOPE}.phase`]: restore.phase,
      [`flags.${TNX_SCOPE}.mainCombatantId`]: restore.mainCombatantId,
      [`flags.${TNX_SCOPE}.spotCombatantId`]: restore.spotCombatantId,
      [`flags.${TNX_SCOPE}.majorActed`]: restore.majorActed,
      [`flags.${TNX_SCOPE}.interruptStack`]: remaining,
      [`flags.${TNX_SCOPE}.interruptConsumesAr`]: restore.interruptConsumesAr,
    });
    // 挿入メインの終了イベント(13-6)。復帰先(メイン/サブターン)は中断からの再開なので開始は再発火
    // しない(退避された効果は割り込みを跨いで持続する)。
    Hooks.callAll(TNX_HOOKS.processEnd, this, { phase: "main", combatantId: endedId, cut: this.round, viaInterrupt: true });
    return this;
  }

  // ─── メジャーアクション記帳(2026-07-26 一般則) ───

  /**
   * メジャーアクションを行った本人を、現プロセスの majorActed に積む。プロセス終了時(advancePhase・
   * 割り込みによるメイン終了)に majorActed の各行動者へ AR−1＋CSカレント0 を記帳する(2026-07-26
   * 全面改訂の一般則「メジャーを行ったプロセス所有者がプロセス終了時に AR−1」)。メインでもサブターン
   * (イニシアチブの支援判定など)でも、メジャーを行った本人が対象。combat フラグ更新は GM 権限が要る
   * ため、非 GM は activeGM へソケット委譲する。メジャータイミングの用途実行フックから呼ぶ。
   * @param {Actor} actor メジャーアクションを行ったアクター
   */
  static async markMajorAction(actor) {
    const combat = game.combat;
    if (!combat?.started || !actor) return;
    const combatant = combat.combatants.find(c => c.actor === actor)
      ?? combat.combatants.find(c => c.actorId === actor.id);
    if (!combatant) return;
    if (game.user.isGM) await combat._addMajorActed(combatant.id);
    else TnxSocketHandler.emitMarkMajor({ combatId: combat.id, combatantId: combatant.id });
  }

  /** majorActed に combatant を追加する(GM のみ・重複は無視)。 */
  async _addMajorActed(combatantId) {
    if (!game.user.isGM) return;
    const cur = this.majorActed;
    if (cur.includes(combatantId)) return;
    await this.setFlag(TNX_SCOPE, "majorActed", [...cur, combatantId]);
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
