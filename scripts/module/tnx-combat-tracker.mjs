/**
 * @fileoverview TnxCombatTracker — カット進行のサイドバートラッカー(フェーズ13-4)。
 *
 * 既定のコンバットトラッカー(v13 ApplicationV2)を上書きし、サブターンモデル(正本
 * Combat_Flow.md「トラッカー上の表現」)で表示する:
 * - 上部にサブターン行(セットアップ/イニシアチブ/クリンナップ＝全体の場・アクティブ表示)
 * - 参加者リストは CSカレント順(TnxCombat._sortCombatants)。メインターンのキャラを active、
 *   イニシアチブ中は確認された候補を明示。CS/AR を表示、エキストラは手番なし
 * - トラッカーが持つのは**進行と宣言だけ**(行動の起動・自動化は置かない):
 *   フッター=前進(nextTurn)・メジャーなし終了・カット進行の開始/終了、行=待機・行動不能
 * - 既定の機能(作成・切替・設定・コンテキストメニュー・表示切替/撃破/ピン留め)は温存。
 *   文言は「カット進行」に統一(「戦闘」「ラウンド」は使わない)
 */

import { SYSTEM_ID } from "../constants.mjs";
import { processLabel, footerPlan, rowActions } from "./combat-tracker-view.mjs";
import { participantOf } from "../combat/tnx-combat.mjs";

const { CombatTracker } = foundry.applications.sidebar.tabs;

/** クリックされた行の combatant id を引く。 */
function combatantIdOf(target) {
  return target?.closest("[data-combatant-id]")?.dataset?.combatantId ?? null;
}

export class TnxCombatTracker extends CombatTracker {
  static DEFAULT_OPTIONS = {
    actions: {
      tnxStartCombat:      TnxCombatTracker._onStartCombat,
      tnxEndCombat:        TnxCombatTracker._onEndCombat,
      tnxAdvance:          TnxCombatTracker._onAdvance,
      tnxPhase:            TnxCombatTracker._onPhase,
      tnxWait:             TnxCombatTracker._onWait,
      tnxInterrupt:        TnxCombatTracker._onInterrupt,
      tnxInterruptEnd:     TnxCombatTracker._onInterruptEnd,
    },
  };

  static PARTS = {
    header: { template: "systems/tokyo-nova-axleration/templates/combat/tracker-header.hbs" },
    tracker: {
      template: "systems/tokyo-nova-axleration/templates/combat/tracker.hbs",
      scrollable: [""],
    },
    footer: { template: "systems/tokyo-nova-axleration/templates/combat/tracker-footer.hbs" },
  };

  /** @override カット進行の情報(フェーズ・候補・スポット)を全パート共通で用意する。 */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const combat = this.viewed;
    const phase = combat?.cutPhase ?? null;
    // このレンダー内で使い回す(行コンテキストからも参照する)
    this._tnxPhase = phase;
    this._tnxCandidateId = combat?.candidateMainId ?? null;
    this._tnxMainId = phase === "main" ? (combat?.mainCombatantId ?? null) : null;
    this._tnxSpotId = combat?.spotCombatantId ?? null;
    this._tnxInterruptMainId = combat?.interruptMainId ?? null; // 挿入メイン中の行動者(割り込み中の現メイン)
    return context;
  }

  /** @override ヘッダー/フッター用: タイトル(カット N)とフッターの進行ボタン計画。 */
  async _prepareCombatContext(context, options) {
    await super._prepareCombatContext(context, options);
    const combat = this.viewed;
    const phase = this._tnxPhase;
    const started = !!combat?.started;
    const candidate = this._tnxCandidateId ? combat?.combatants.get(this._tnxCandidateId) : null;
    const main = this._tnxMainId ? combat?.combatants.get(this._tnxMainId) : null;
    const spot = this._tnxSpotId ? combat?.combatants.get(this._tnxSpotId) : null;
    context.tnxTitle = !combat ? "カット進行なし"
      : !started ? "開始前"
      : `カット ${combat.round}`;
    context.tnxFooter = footerPlan({
      hasCombat: !!combat,
      started,
      phase,
      isGM: game.user.isGM,
      isMainOwner: !!main?.actor?.isOwner,
      isSpotOwner: !!spot?.actor?.isOwner,
      candidateName: candidate?.name ?? null,
      // 挿入メイン(割り込み)中は終了2ボタン(終了 / AR を−1して終了)へ切り替える(13-5)
      isInterruptMain: !!this._tnxInterruptMainId,
    });
  }

  /** @override トラッカー用: サブターン行(全体の場)の表示情報。 */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    if (!combat?.started) return;
    const phase = this._tnxPhase;
    context.tnxPhaseRow = {
      label: processLabel(phase),
      // メインプロセスはカット進行の主役(キャラの行動本体)なので、見出しはメイン中にこそ光らせる
      // (2026-07-22 ユーザー指摘＝当初の「サブターン中のみ点灯」は逆)
      active: phase === "main",
      candidateName: this._tnxCandidateId
        ? combat.combatants.get(this._tnxCandidateId)?.name ?? null
        : null,
    };
  }

  /** @override 各行へ CS/AR・スポット/メイン/候補・行動不能・宣言操作(待機)を足す。 */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const p = participantOf(combatant); // cantAct(戦闘不能タグ/脱落)込みの素データを共用する
    const cs = combatant.actor?.system?.combatSpeed;
    const isCandidate = combatant.id === this._tnxCandidateId;
    // AR・CSカレントの表示は、描画しているカット進行が開始済みか(combat.started)で直接判定する。
    // アクターの派生フラグ combatSpeed.inCombat は reset された時点に依存して陳腐化し(ラウンドを
    // 変えない更新では refreshDisplays が走らない)、行ごとに AR が出たり出なかったりする原因に
    // なるため使わない(2026-07-22 ユーザー指摘)。開始前は素の CS・AR なし、開始後はカレント・現在AR。
    const started = !!combat.started;
    turn.tnxCs = String(started ? (cs?.currentTotal ?? 0) : (cs?.valueTotal ?? 0));
    turn.tnxAr = started ? String(p.ar) : null;
    turn.tnxActable = p.actorType !== "extra";
    // 行動不能(cantAct)の見た目は core の脱落表示に一本化(自動脱落マーク=tnx.mjs のフック。
    // 独自グレーアウトは二重表示になるため撤去=2026-07-22 ユーザー確定)
    turn.tnxIsMain = combatant.id === this._tnxMainId;
    turn.tnxIsSpot = combatant.id === this._tnxSpotId;
    turn.tnxIsCandidate = isCandidate;
    // 挿入メイン(割り込み)の行は通常メインと視覚的に区別する(13-5・造語ラベルは置かず行装飾で)
    turn.tnxIsInterruptMain = combatant.id === this._tnxInterruptMainId;
    // 割り込み許可フラグ(用途が対象に立てる)があれば割り込み入口を出す(フェーズ非依存・rowActions がゲート)
    const canInterrupt = combatant.getFlag(SYSTEM_ID, "canInterrupt") === true;
    turn.tnxRowActions = rowActions({
      phase: this._tnxPhase,
      isCandidate,
      isOwner: !!combatant.actor?.isOwner,
      isGM: game.user.isGM,
      canInterrupt,
    });
    return turn;
  }

  // ─── 進行と宣言(実体は TnxCombat 側) ───

  static async _onStartCombat() { await this.viewed?.startCombat(); }
  static async _onEndCombat()   { await this.viewed?.endCombat(); }
  static async _onAdvance()     { await this.viewed?.nextTurn(); }
  static async _onPhase()       { await this.viewed?.advancePhase(); }
  static async _onWait(event, target) { await this.viewed?.declareWait(combatantIdOf(target)); }

  // 割り込み(挿入メイン): 入口=行の「割り込み」・終了=フッターの「割り込みを終了」1本(2026-07-26)。
  // AR を消費するかは用途宣言(consumesAr)で自動判定するため終了操作は1つ。
  static async _onInterrupt(event, target) { await this.viewed?.startInterrupt(combatantIdOf(target)); }
  static async _onInterruptEnd() { await this.viewed?.endInterrupt(); }
}
