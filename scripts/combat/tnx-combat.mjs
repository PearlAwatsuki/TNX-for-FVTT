/**
 * @fileoverview TnxCombat — カット進行の Combat 派生クラス(フェーズ13-2)。
 *
 * TNX の戦闘は「カット進行」で、1 Foundry Combat ＝ 1 カット進行 ＝ 1(戦闘)シーン
 * (正本 Combat_Flow.md)。本クラスはその「器」で、カット進行の状態(現プロセス・カット番号・
 * 手番)を **flags.tokyo-nova-axleration** に持つ(正本)。
 *
 * 13-2 の範囲: クラスの新設・CONFIG 登録・カット開始シードのロジック集約(トリガーは当面
 * 既存フックのまま＝挙動不変)。プロセスの状態機械・CS/AR の自動記帳(セットアップ末/メジャー後/
 * 待機/クリンナップ全回復)・トラッカー UI・境界イベントは 13-3 以降。
 */

import { buildCombatSeedUpdate } from "../module/combat-seed-logic.mjs";

/** 本システムのドキュメントフラグのスコープ(＝system id)。 */
const TNX_SCOPE = "tokyo-nova-axleration";

export class TnxCombat extends Combat {
  // ─── カット進行の状態(正本＝flags.tokyo-nova-axleration。遷移・自動記帳は 13-3) ───

  /** 現プロセス(prep/setup/initiative/main/cleanup)。未開始は null。 */
  get cutProcess() { return this.getFlag(TNX_SCOPE, "process") ?? null; }

  /** カット番号(1 始まり)。未開始は 0。 */
  get cutNumber() { return this.getFlag(TNX_SCOPE, "cut") ?? 0; }

  /** 現メインプロセスの combatant id(手番)。未定は null。 */
  get activeMainId() { return this.getFlag(TNX_SCOPE, "activeMainId") ?? null; }

  // ─── カット開始シード(フェーズ10-5/11 から移設・挙動不変) ───
  // 13-3 でライフサイクル(startCombat/_onEnter)へ移し、フック依存を解消する。

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
   * シートの「CS」「AR」表示は自動制御(カット進行中＝カレント・現在AR／それ以外＝CS・付与値)のため、
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
