/**
 * @fileoverview 時間境界の購読と適用(フェーズ15-1・Foundry グルー)。
 *
 * フェーズ13-6 と 14-2 が発火してきた境界イベントの**唯一の購読口**。境界ごとの手続きを
 * 各機構に散らさず、ここ 1 本に集約する——「何が・いつ・どう畳まれるか」は宣言側
 * (効果の持続欄・`uses.type`・`CONDITION_KINDS`)に置き、本モジュールは宣言を読んで
 * 適用するだけにする。境界が増えても購読口は増えず、適用順序も一箇所で決まる。
 *
 * 判断は純ロジック(`time-boundary-logic.mjs`)に置き、ここはドキュメントの走査と更新に徹する。
 *
 * **適用は黙って行う**(2026-08-29 ユーザー裁定・チャット報告をしない)。
 * **実行は activeGM のみ**——他人のアクターを更新する権限が要るため(appearance-state と同じ作法)。
 *
 * 対象アクターの範囲(→ Time_Management「適用のされ方」):
 * - カット系・メインプロセス系: **登場中**のアクター
 * - 退場: 退場した本人だけ(退場＝そのキャラにとってのシーンの終わり)
 * - アクト終了: **絞らない**。参加していないアクターには畳むものが無く no-op になるため
 */

import { TNX_HOOKS } from "./combat-events.mjs";
import { TNX_BOUNDARIES, planEffectExpiry } from "./time-boundary-logic.mjs";
import { listAppearingActors } from "./appearance-state.mjs";

/** この境界の適用を自分が担うか(activeGM のみ)。 */
function isApplier() {
    return game.users?.activeGM?.id === game.user?.id;
}

/**
 * 1 アクターについて、その境界で失効する効果を除去する。
 *
 * 対象は**アクターに乗っている効果**だけ。アイテムに乗っている効果は定義であって実体ではなく、
 * 消すとアイテムの設定そのものが失われる(用途で対象へ付与されたコピーがアクター側の実体で、
 * 持続はそのコピーに引き継がれて失効する)。
 * @param {Actor} actor
 * @param {string} boundary TNX_BOUNDARIES の値
 */
async function expireEffectsOn(actor, boundary) {
    const ids = planEffectExpiry(actor?.effects?.contents ?? [], boundary);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * 境界を適用する(対象アクター全員へ順に)。
 * @param {string} boundary TNX_BOUNDARIES の値
 * @param {Actor[]} actors
 */
export async function applyBoundary(boundary, actors) {
    for (const actor of (actors ?? [])) {
        if (actor) await expireEffectsOn(actor, boundary);
    }
}

/** 境界イベントの購読を登録する(ready で 1 回・全クライアントで呼んでよい)。 */
export function registerTimeBoundaries() {
    // メインプロセスの終了。「メインプロセス中」の効果は**誰のメインプロセスかを問わず**
    // 失効する(Time_Management)ため、行動者本人ではなく登場中の全員が対象。
    Hooks.on(TNX_HOOKS.processEnd, (_combat, data) => {
        if (!isApplier() || data?.phase !== "main") return;
        applyBoundary(TNX_BOUNDARIES.mainProcessEnd, listAppearingActors());
    });

    // カットの終了(次カット境界)。
    Hooks.on(TNX_HOOKS.cutEnd, () => {
        if (!isApplier()) return;
        applyBoundary(TNX_BOUNDARIES.cutEnd, listAppearingActors());
    });

    // カット進行の終了。シーンは終わらせない(Combat_Flow「終了は非連動」)ため、
    // カットまでの持続だけを畳む。
    Hooks.on(TNX_HOOKS.cutProgressionEnd, () => {
        if (!isApplier()) return;
        applyBoundary(TNX_BOUNDARIES.cutProgressionEnd, listAppearingActors());
    });

    // 退場＝そのキャラクターにとってのシーンの終わり。シーン終了もアクト終了も
    // 「全員を退場させてから」境界イベントを発火するため、ここを購読すれば全員に届く。
    Hooks.on(TNX_HOOKS.actorExit, (actor) => {
        if (!isApplier()) return;
        applyBoundary(TNX_BOUNDARIES.exit, [actor]);
    });

    // アクトの終了。対象を絞らない(絞る意味が無い＝畳むものが無ければ no-op)。
    Hooks.on(TNX_HOOKS.actEnd, () => {
        if (!isApplier()) return;
        applyBoundary(TNX_BOUNDARIES.actEnd, game.actors?.contents ?? []);
    });
}
