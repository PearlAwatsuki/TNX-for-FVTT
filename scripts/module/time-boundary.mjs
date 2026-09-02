/**
 * @fileoverview 時間境界の購読と適用(フェーズ15・Foundry グルー)。
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
import { TNX_BOUNDARIES, planEffectExpiry, planItemGrantExpiry, planItemBoundaryUpdates, planConditionRecovery, planActEndDamageCleanup, planSceneDeadlineExpiry, planPoisonTicks,
         planSceneDeferredFiring, buildForcedExitFlags } from "./time-boundary-logic.mjs";
import { CONDITION_KINDS, getConditionKinds } from "./conditions.mjs";
import { listAppearingActors } from "./appearance-state.mjs";

const SCOPE = "tokyo-nova-axleration";

/** この境界の適用を自分が担うか(activeGM のみ)。 */
function isApplier() {
    return game.users?.activeGM?.id === game.user?.id;
}

/**
 * 1 アクターについて、その境界で失効する効果を除去する。
 *
 * アクターに乗っている効果に加え、**アイテムに着地した付与コピー**も実体として失効させる
 * (KI-048)。アイテムに乗る供給元の定義(消すとアイテムの設定そのものが失われる)と転送コピー
 * (供給元が正)は残す——判別は `planItemGrantExpiry` が持つ。
 * @param {Actor} actor
 * @param {string} boundary TNX_BOUNDARIES の値
 */
async function expireEffectsOn(actor, boundary) {
    const ids = planEffectExpiry(actor?.effects?.contents ?? [], boundary);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    for (const { itemId, effectIds } of planItemGrantExpiry(actor?.items ?? [], boundary)) {
        await actor.items.get(itemId)?.deleteEmbeddedDocuments("ActiveEffect", effectIds);
    }
}

/**
 * 1 アクターについて、その境界で戻る使用回数・消費アイテムの個数をリセットする(15-2)。
 * @param {Actor} actor
 * @param {string} boundary TNX_BOUNDARIES の値
 */
async function resetItemsOn(actor, boundary) {
    const updates = planItemBoundaryUpdates(actor?.items?.contents ?? [], boundary);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * 1 アクターについて、その境界で回復する BS を除去する(15-4)。
 * 酩酊(大)のように別の BS へ変わるものは、除去と同時に変換先を付与する。
 * @param {Actor} actor
 * @param {string} boundary TNX_BOUNDARIES の値
 * @param {boolean} isMainActor そのメインプロセスの行動者本人か
 */
async function recoverConditionsOn(actor, boundary, isMainActor) {
    const effects = actor?.effects?.contents ?? [];
    const { removeIds, downgrades } = planConditionRecovery(effects, boundary, { isMainActor });
    if (!removeIds.length) return;
    // 変換先は、変換元の由来(リスト非表示・負傷への紐づき)をそのまま引き継ぐ
    const created = [];
    for (const { id, toKind } of downgrades) {
        const def = CONDITION_KINDS[toKind];
        if (!def) continue;
        const from = actor.effects.get(id)?.flags?.[SCOPE] ?? {};
        const flags = { conditionKind: toKind };
        if (from.hideFromList !== undefined) flags.hideFromList = from.hideFromList;
        if (from.woundSource) flags.woundSource = from.woundSource;
        created.push({ name: def.label, img: def.img ?? "icons/svg/aura.svg", statuses: [toKind], flags: { [SCOPE]: flags } });
    }
    await actor.deleteEmbeddedDocuments("ActiveEffect", removeIds);
    if (created.length) await actor.createEmbeddedDocuments("ActiveEffect", created);
}

/**
 * 境界を適用する(対象アクター全員へ順に)。
 * @param {string} boundary TNX_BOUNDARIES の値
 * @param {Actor[]} actors
 * @param {{mainActorId?: string|null}} [opts] メインプロセス系の境界での行動者
 */
export async function applyBoundary(boundary, actors, { mainActorId = null } = {}) {
    for (const actor of (actors ?? [])) {
        if (!actor) continue;
        await expireEffectsOn(actor, boundary);
        await resetItemsOn(actor, boundary);
        await recoverConditionsOn(actor, boundary, !!mainActorId && actor.id === mainActorId);
        if (boundary === TNX_BOUNDARIES.actEnd) await cleanupDamageOn(actor);
        if (boundary === TNX_BOUNDARIES.cleanup) await tickPoisonOn(actor);
    }
}

/**
 * クリンナップの邪毒(15-6)。**カードは自動で引かない**——受付カードを出すだけで、
 * 受けたキャラクターを操作しているプレイヤーか RL がボタンで引く(2026-08-29 ユーザー指示)。
 * ドローとチャート適用は condition-resolution の領分で、ここは「誰にいつ起こるか」だけを決める。
 * @param {Actor} actor
 */
async function tickPoisonOn(actor) {
    const ticks = planPoisonTicks(actor?.effects?.contents ?? []);
    if (!ticks.length) return;
    const { postPoisonDrawPrompt } = await import("./condition-resolution.mjs");
    for (const tick of ticks) {
        const effect = actor.effects.get(tick.id);
        if (effect) await postPoisonDrawPrompt(actor, effect, tick.magnitude);
    }
}

/**
 * アクト終了の残存ダメージ消去(15-5・Scenario_Progress「ポストアクト」)。
 * 終端状態(完全死亡・精神崩壊・抹殺)は残す——キャラロストは後始末で無かったことにしない。
 * @param {Actor} actor
 */
async function cleanupDamageOn(actor) {
    const ids = planActEndDamageCleanup(actor?.effects?.contents ?? []);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** カット進行のコンバッタント id から Actor を引く。 */
function actorOfCombatant(combatantId) {
    if (!combatantId) return null;
    return game.combat?.combatants?.get(combatantId)?.actor ?? null;
}

/** 境界イベントの購読を登録する(ready で 1 回・全クライアントで呼んでよい)。 */
export function registerTimeBoundaries() {
    // メインプロセスの開始。恐慌は**本人**のメインプロセスの直前に回復する。
    Hooks.on(TNX_HOOKS.processStart, (_combat, data) => {
        if (!isApplier() || data?.phase !== "main") return;
        const mainActorId = actorOfCombatant(data?.combatantId)?.id ?? null;
        applyBoundary(TNX_BOUNDARIES.mainProcessStart, listAppearingActors(), { mainActorId });
    });

    // メインプロセスの終了。「メインプロセス中」の効果は**誰のメインプロセスかを問わず**
    // 失効する(Time_Management)ため登場中の全員が対象だが、萎縮・憎悪の回復は**本人**だけ。
    // クリンナップは酩酊・電子妨害の回復(と 15-6 の邪毒)の境界。
    Hooks.on(TNX_HOOKS.processEnd, (_combat, data) => {
        if (!isApplier()) return;
        if (data?.phase === "main") {
            const mainActorId = actorOfCombatant(data?.combatantId)?.id ?? null;
            applyBoundary(TNX_BOUNDARIES.mainProcessEnd, listAppearingActors(), { mainActorId });
        } else if (data?.phase === "cleanup") {
            applyBoundary(TNX_BOUNDARIES.cleanup, listAppearingActors());
        }
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

    // シーンの開始で2つ。①シーン番号で数える期限(行動不可・逮捕令状)を切る——境界の中で
    // 「シーン番号が進んだ後」に見るのはここだけ。②社会ダメージの「次のシーン」効果を発火する。
    Hooks.on(TNX_HOOKS.sceneStart, async () => {
        if (!isApplier()) return;
        const { getSessionState } = await import("./session-state.mjs");
        const sceneNumber = getSessionState()?.sceneNumber ?? 0;
        for (const actor of game.actors?.contents ?? []) {
            const effects = actor.effects?.contents ?? [];
            const ids = planSceneDeadlineExpiry(effects, sceneNumber);
            if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
            for (const { id, kind } of planSceneDeferredFiring(effects)) {
                if (ids.includes(id)) continue;
                await actor.effects.get(id)?.setFlag(SCOPE, `conditions.${kind}.sceneFired`, true);
            }
        }
    });

    // アクトの終了。対象を絞らない(絞る意味が無い＝畳むものが無ければ no-op)。
    Hooks.on(TNX_HOOKS.actEnd, () => {
        if (!isApplier()) return;
        applyBoundary(TNX_BOUNDARIES.actEnd, game.actors?.contents ?? []);
    });
}


/**
 * 逮捕令状(社会17)の適用を購読する(15-7・正本 Appearance_Check)。
 *
 * 負傷が付いたら **①チームから抜けてから ②退場** する(2026-08-23 裁定＝強制退場は退場連動に
 * 乗せない)。以後この負傷が生きている間は登場判定が自動失敗になり(appearanceBlockOf)、
 * 負傷自体は「次のシーン」が終われば消える(付与シーン+2 から自由＝シーン開始で期限を切る)。
 *
 * 適用は activeGM のみ——チーム(ワールド設定)と他人のアクターを更新する権限が要るため。
 * ダメージを適用したのが誰であっても、GM 側で1回だけ走る。
 */
export function registerForcedExitWounds() {
    Hooks.on("createActiveEffect", async (effect) => {
        if (!isApplier()) return;
        const actor = effect?.parent;
        if (!actor || actor.documentName !== "Actor") return;
        const kind = getConditionKinds(effect).find(k => CONDITION_KINDS[k]?.forcesExit === true);
        if (!kind) return;

        const { getSessionState, leaveTeam } = await import("./session-state.mjs");
        const { setAppearing, isAppearing } = await import("./appearance-state.mjs");
        // ① チームから抜ける(退場連動を起こさないため、退場より先)
        await leaveTeam(actor.id);
        // ② 退場(連動には乗せない＝setAppearing を直接呼ぶ)
        if (isAppearing(actor)) await setAppearing(actor, false);
        // ③ 登場できない期限をこの負傷に刻む
        const flags = buildForcedExitFlags(kind, getSessionState()?.sceneNumber ?? 0);
        if (flags) await effect.setFlag(SCOPE, `conditions.${kind}`, flags);
    });
}