/**
 * @fileoverview キャストと User flag の経験点同期(フェーズ2-2)。
 *
 * 経験点の権威は User flag にあり、キャストはそれを写している。ownerUserId の記録・
 * syncWithOwner の切り替えに応じて双方向の初回同期と由来分離を行う。GM クライアントのみ実行。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { TokyoNovaCastSheet } from "../actor/tnx-cast-sheet.mjs";
import { getUserFlagData, calcHistoryExpTotal } from "./user-flag-schema.mjs";
import { calcSharedSpent, buildCastHistorySyncUpdate, mergeHistories, separateHistoryByOrigin } from "../rules/exp-sync.mjs";

export async function syncCastExpToUser(ownerUser) {
    const linkedCasts = game.actors.filter(
        a => a.type === 'cast' && a.system.ownerUserId === ownerUser.uuid && a.system.syncWithOwner
    );

    const castExpList = linkedCasts.map(a => ({
        spent:      Number(a.system.exp?.spent)      || 0,
        additional: Number(a.system.exp?.additional) || 0,
    }));

    const newSpent = calcSharedSpent(castExpList);
    const { exp: { total: currentTotal, spent: currentSpent } } = getUserFlagData(ownerUser);

    if (currentSpent === newSpent) return;

    await ownerUser.update({
        [`flags.${SYSTEM_ID}.exp.spent`]: newSpent,
        [`flags.${SYSTEM_ID}.exp.value`]: currentTotal - newSpent,
    }, { syncing: true });
}

/**
 * ownerUserId が新規に記録された時点で、cast の history と User flag の history を
 * 双方向マージして両者を揃える初回同期を行う。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  cast タイプの Actor(ownerUserId 設定済み)
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
export async function performInitialHistorySync(castActor, ownerUser) {
    if (!castActor.system.syncWithOwner) return;
    const castHistory = castActor.system.history ?? {};
    const { history: userHistory } = getUserFlagData(ownerUser);
    const mergedHistory = mergeHistories(castHistory, userHistory);
    const newTotal = calcHistoryExpTotal(mergedHistory);

    // User flag: merged history 全エントリ + exp.total を更新
    // syncing: true で updateUser フックのループを防ぐ
    const flagUpdate = { [`flags.${SYSTEM_ID}.exp.total`]: newTotal };
    for (const [id, entry] of Object.entries(mergedHistory)) {
        flagUpdate[`flags.${SYSTEM_ID}.history.${id}`] = entry;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // cast: system.history を merged に差分同期
    // syncing: true で updateActor フックのループを防ぐ
    const castHistoryUpdate = buildCastHistorySyncUpdate(castActor.system.history, mergedHistory);
    if (!foundry.utils.isEmpty(castHistoryUpdate)) {
        await castActor.update(castHistoryUpdate, { calcExp: false, syncing: true });
    }

    // exp.spent / exp.value を User flag に反映(syncCastExpToUser は syncing: true で書く)
    await syncCastExpToUser(ownerUser);

    // cast の exp.total / spent / value を User flag の新しい total に基づいて更新
    await TokyoNovaCastSheet.updateCastExp(castActor);
}

/**
 * syncWithOwner が ON→OFF になった際に、cast と User flag から相互の由来エントリを除去する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  同期を切った cast タイプの Actor
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
export async function performUnsyncSeparation(castActor, ownerUser) {
    const castUuid = castActor.uuid;

    // cast から User 由来(origin !== castUuid)のエントリを削除
    const castHistory = castActor.system.history ?? {};
    const { ownedByOther: castForeignEntries } = separateHistoryByOrigin(castHistory, castUuid);
    const castUpdate = {};
    for (const id of Object.keys(castForeignEntries)) {
        castUpdate[`system.history.-=${id}`] = null;
    }
    if (!foundry.utils.isEmpty(castUpdate)) {
        await castActor.update(castUpdate, { calcExp: false, syncing: true });
    }

    // User flag からこの cast 由来(origin === castUuid)のエントリを削除
    const { history: userHistory } = getUserFlagData(ownerUser);
    const { ownedByOrigin: castEntriesInUser, ownedByOther: remainingUserHistory } = separateHistoryByOrigin(userHistory, castUuid);
    const newTotal = calcHistoryExpTotal(remainingUserHistory);
    const flagUpdate = { [`flags.${SYSTEM_ID}.exp.total`]: newTotal };
    for (const id of Object.keys(castEntriesInUser)) {
        flagUpdate[`flags.${SYSTEM_ID}.history.-=${id}`] = null;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // 分離後の EXP 再集計(sync 中の他キャスト分のみが残る)
    await syncCastExpToUser(ownerUser);
    await TokyoNovaCastSheet.updateCastExp(castActor);

    // ownerUser の update は syncing:true で行うため updateUser フックの再描画が
    // スキップされる。由来分離完了後に明示的に再描画する。
    const recordSheet = foundry.applications?.instances?.get(`tnx-record-sheet-${ownerUser.id}`);
    if (recordSheet?.rendered) recordSheet.render();
}

// アウトフィット集計(outfitMod / appearanceModifier)はフェーズ9-2 で
// CastDataModel.prepareDerivedData の派生算出へ移行した(B-2)。
// 派生値を DB に書き戻すフック方式(updateCastOutfitMods / updateCastAppearanceModifier /
// recalcOutfitAggregates)・起動時スキャン・isGhost 変更時の再集計は撤去。

// ActiveEffect 設定シートの詳細タブに TNX の設定(重複可・準備先・付与先)を注入する(フェーズ9-3 v2/v3)。
// 注入フィールドは name="flags.tokyo-nova-axleration.*" を与えて**ネイティブ項目と同じフォーム送信で
// 保存**する(2026-07-13 ユーザー指摘で是正: 即時 setFlag はドキュメント更新→シート再描画で
// 未保存のフォーム状態(transfer のオン等)を巻き戻すため廃止)。
