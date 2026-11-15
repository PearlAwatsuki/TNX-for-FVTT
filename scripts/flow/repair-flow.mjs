/** Select malfunctioning equipment, then clear the malfunction on a successful check. */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { stampCardOutcome } from "../chat/chat-card.mjs";
import { nowrap } from "../chat/chat-text.mjs";
import { TnxSocketHandler } from "../core/tnx-socket-handler.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { ListSelectionDialog } from "../ui/tnx-dialog.mjs";
import { resolveTargetedOrSelf } from "./target-resolution.mjs";
import { itemDisplayName } from "../core/identification.mjs";
import { isOutfitMalfunctioning } from "../data/item/helpers.mjs";
import { OUTFIT_TYPES, getMajorCategoryLabel, getMinorCategoryLabel } from "../data/item/outfit-categories.mjs";

/** Equipment eligibility follows its current state, not a usage whitelist. */
export function listRepairableOutfits(target) {
    const out = [];
    for (const it of (target?.items ?? [])) {
        if (!OUTFIT_TYPES.has(it.type)) continue;
        if (!isOutfitMalfunctioning(it.system)) continue;
        out.push(it);
    }
    return out;
}

/** 修理対象(故障アウトフィット1つ)の選択ダイアログ。null=中止。 */
async function promptRepairSelection(target, candidates) {
    const picked = await ListSelectionDialog.prompt({
        title:       `修理対象の選択: ${target.name}`,
        note:        "修理する故障アウトフィットを選んでください。",
        confirmIcon: "fas fa-screwdriver-wrench",
        options: candidates.map((it) => ({
            value: it.id,
            label: itemDisplayName(it),
            sub:   `${getMajorCategoryLabel(it.system.majorCategory)}／${getMinorCategoryLabel(it.system.minorCategory)}`,
        })),
    });
    return picked ? (candidates.find(it => it.id === picked) ?? null) : null;
}

/**
 * 修理用途を使用する(アイテムロールから・2026-07-18)。判定のみ(selectableForm なし)。
 * @param {Item} item 修理タイプの用途を持つ技能
 * @param {object} usage type="repair" の用途エントリ
 */
export async function useRepair(item, usage) {
    const actor = item.actor;
    if (!actor) { ui.notifications.warn("修理はアクターが所持している技能から使用してください。"); return; }

    // 対象: ターゲット中のキャラクター(先頭)・いなければ自分(し忘れの自動解決・2026-07-19)。
    // 対象欄の値では分岐・ブロックしない(複数ターゲット時は先頭の1体)
    const target = resolveTargetedOrSelf(actor);

    const candidates = listRepairableOutfits(target, usage);
    if (!candidates.length) {
        ui.notifications.warn(`「${target.name}」に、この技能で修理できる故障したアウトフィットがありません。`);
        return;
    }
    const chosen = await promptRepairSelection(target, candidates);
    if (!chosen) return;

    // 判定(共通前段=不備検知・参加技能・報酬点・消費・適用効果・目標値)で解決して通常の判定フローへ。
    // 完了継続(TnxCheckFlow._execute → resolveRepairFromCheck)が成功で故障を解除する。
    const base = await buildUsageCheckContext(actor, item, usage);
    if (!base) return;

    await TnxCheckFlow.open({
        ...base,
        repair: {
            // 委譲の受理条件(GM 代行)で使う行為者=修理する人。対象の所有権が無いから委譲するので、
            // 検証できるのは対象側ではなく行為者側(2026-09-07)
            actorUuid:  actor.uuid,
            targetUuid: target.uuid,
            outfitId:   chosen.id,
            outfitName: itemDisplayName(chosen),
        },
    });
}

/**
 * 修理判定の完了継続(TnxCheckFlow._execute から)。成功で選択アウトフィットの故障を解除する。
 * 目標値なし(成否 null)は達成値の報告のみ(解除は卓裁定=手動)。
 * 修理したことは**判定結果カードの帰結行**として刻む(2026-09-07 ユーザー指示・別カードを出さない)。
 * 失敗は結果カード自身が「失敗」と示すため、帰結行は刻まない。
 * @param {{targetUuid:string, outfitId:string, outfitName:string}} ctx
 * @param {object} result 判定結果
 * @param {{messageId?: ?string}} [args] messageId=帰結行を刻む判定結果カード
 */
export async function resolveRepairFromCheck(ctx, result, { messageId = null } = {}) {
    const target = await fromUuid(ctx.targetUuid).catch(() => null);
    if (!target) return;

    if (result?.success !== true) return; // 失敗・目標値なし(成否は卓裁定=解除は手動)

    if (!await applyRepairClear(target, ctx.outfitId, ctx.actorUuid)) return;
    const message = messageId ? game.messages.get(messageId) : null;
    if (message) {
        const esc = foundry.utils.escapeHTML;
        await stampCardOutcome(message, { icon: "fa-screwdriver-wrench",
            text: `${esc(target.name)}の「${esc(ctx.outfitName)}」${nowrap("の故障を修理した")}` });
    }
}

/** 故障の解除を実行する(所有権が無ければ repairApply ソケットで GM 委譲)。
 *  @param {?string} actorUuid 修理する人(委譲の受理条件に使う) */
async function applyRepairClear(target, outfitId, actorUuid = null) {
    if (target.isOwner) {
        const it = target.items.get(outfitId);
        if (it) await it.update({ "system.isMalfunction": false });
        return true;
    }
    if (game.users.activeGM) {
        TnxSocketHandler.emitRepairApply({ targetUuid: target.uuid, outfitId, actorUuid });
        return true;
    }
    ui.notifications.warn("対象の所有権がなく RL も不在のため、修理を適用できません。");
    return false;
}

/** GM が委譲された故障解除を代行する(socket)。 */
export async function applyRepairDelegated({ targetUuid, outfitId }) {
    const target = await fromUuid(targetUuid).catch(() => null);
    if (!target) return;
    const it = target.items.get(outfitId);
    if (it) await it.update({ "system.isMalfunction": false });
}
