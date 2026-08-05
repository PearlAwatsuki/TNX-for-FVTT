/**
 * @fileoverview 割り込み許可の付与(フェーズ13-5・正本 Combat_Flow「割り込み(挿入メイン)」)。
 *
 * 宣言/判定用途の `grantsInterrupt` トグルがオンのとき、用途解決時にターゲットしたキャラクターの
 * combatant へ「割り込み許可」フラグ(`flags.<scope>.canInterrupt`)を立てる。フラグはトラッカーの
 * 割り込み入口(combat-tracker-view.rowActions・対象の操作者/RL のみ)のゲートで読まれ、入口を押して
 * 挿入メインを開始(TnxCombat.startInterrupt)したときに消費される(ワンショット)。
 *
 * 対象の決め方:
 *   ・対象上書き(リアクション=攻撃者へ返す等)があればそれ。
 *   ・無ければ現在のレティクル(ターゲット)。他者への追加行動付与はこの経路(対象=別キャラ)。
 *   ・レティクルも無ければ自分(セルフ割り込み=イニシアチブでの割り込みは対象=自分)。
 *
 * 付与は用途解決時に即時に行う。フラグ自体は何もせず、実際の割り込みはトラッカーの入口
 * (対象の操作者/RL のみ押せる)を押して初めて起こるため、付与を早めに行っても制御は失われない。
 * combatant フラグの更新は GM 権限が要るため、非 GM は GM(activeGM)へ委譲する。
 */

import { currentTargetActors } from "./target-resolution.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 用途の割り込み許可トグルを適用する。`grantsInterrupt` でない用途は何もしない。
 * @param {Actor} actor 用途を使うアクター(セルフ割り込みのフォールバック対象)
 * @param {object} usage 用途エントリ
 * @param {object} [opts]
 * @param {Array<{uuid:string,name:string}>|null} [opts.targetOverride] 対象上書き
 *   (非 null なら現在のレティクルを読まずこの配列を対象にする。空配列=対象なし)
 */
export async function applyInterruptGrantForUsage(actor, usage, { targetOverride = null } = {}) {
    if (usage?.grantsInterrupt !== true) return;

    // 対象解決: 上書き > レティクル > 自分(セルフ割り込み)
    let uuids = [];
    if (targetOverride !== null) {
        uuids = targetOverride.map(t => t.uuid).filter(Boolean);
    } else {
        uuids = currentTargetActors().map(a => a.uuid).filter(Boolean);
    }
    if (!uuids.length && actor?.uuid) uuids = [actor.uuid];
    if (!uuids.length) return;

    // 挿入メインが AR を消費するか(consumesAr・2026-07-26): 用途の宣言をフラグに載せて伝搬する
    // (用途 → combatant の割り込み許可 → 挿入メイン)。既定=真(自己割り込み)・追加行動でオフ。
    const consumesAr = usage.interruptConsumesAr !== false;

    if (game.user.isGM) {
        await grantInterruptToTargets(uuids, consumesAr);
    } else {
        TnxSocketHandler.emitInterruptGrant({ sourceUuid: actor?.uuid ?? null, targetUuids: uuids, consumesAr });
    }
}

/**
 * 指定 uuid 群のアクターの combatant に割り込み許可フラグを立てる(GM 側で実行)。あわせて、その割り込みが
 * AR を消費するか(consumesAr)を combatant フラグに載せる(startInterrupt が読み、挿入メインへ伝える)。
 * 開始済みのカット進行に参加している combatant のみが対象(参加していなければ何もしない)。
 * @param {string[]} targetUuids 対象アクター(またはトークン)の uuid
 * @param {boolean} [consumesAr] この割り込みで挿入メインが AR を消費するか(既定=真)
 */
export async function grantInterruptToTargets(targetUuids, consumesAr = true) {
    for (const uuid of (targetUuids ?? [])) {
        const doc = await fromUuid(uuid).catch(() => null);
        const target = doc?.actor ?? doc;
        if (!target) continue;
        for (const combat of game.combats) {
            if (!combat.started) continue;
            for (const c of (combat.getCombatantsByActor?.(target) ?? [])) {
                await c.setFlag(SCOPE, "canInterrupt", true).catch(() => {});
                await c.setFlag(SCOPE, "interruptConsumesAr", consumesAr === true).catch(() => {});
            }
        }
    }
}
