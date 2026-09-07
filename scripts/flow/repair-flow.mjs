/**
 * @fileoverview 修理フロー(2026-07-18 ユーザー確定・repair タイプ)。
 *
 * 〈製作〉等の技能に持たせた「修理」用途で、故障したアウトフィットの故障(isMalfunction)を解除する。
 * 破壊(isDestroyed)は修理対象外(基本アクト終了まで直らない)。
 *
 * フロー:
 * 1. 使用(アイテムロール) → 対象解決(ターゲット中のキャラクター・いなければ自分=し忘れの自動解決。
 *    実対象はアウトフィットで、キャラクターのターゲットは「どのキャラクターの所持品か」を指す
 *    便宜=対象欄の値では分岐・ブロックしない・2026-07-19 ユーザー裁定)
 * 2. 対象が所持する故障アウトフィットのうち、用途の repairableCategories(分類ホワイトリスト・
 *    小分類キーまたは大分類キー=その大分類全体)に合致するものを1つ選択
 * 3. 判定へ(共通前段 buildUsageCheckContext → TnxCheckFlow.open)。完了継続 ctx.repair が
 *    成功時に選択アウトフィットの故障を解除する(対象の所有権が無ければ GM 委譲)。
 *
 * サービス大分類は故障しない(免疫)ため候補に出ない(isOutfitMalfunctioning が false)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { stampCardOutcome } from "../chat/chat-card.mjs";
import { nowrap } from "../chat/chat-text.mjs";
import { TnxSocketHandler } from "../core/tnx-socket-handler.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { ListSelectionDialog } from "../ui/tnx-dialog.mjs";
import { resolveTargetedOrSelf } from "./target-resolution.mjs";
import { itemDisplayName } from "../core/identification.mjs";
import { isOutfitMalfunctioning } from "../data/item/helpers.mjs";
import { OUTFIT_TYPES, getMajorCategoryLabel, getMinorCategoryLabel, outfitClassifications } from "../data/item/outfit-categories.mjs";

/**
 * 対象が所持する、この用途で修理できる故障アウトフィットを列挙する。
 * 故障中(実効・サービス免疫は除外)かつ分類がホワイトリストに合致するもの
 * (小分類キー=その小分類のみ・大分類キー=その大分類の全小分類)。
 * 照合は分類集合(主分類＋副分類=「両方の分類として扱う」・フェーズ16-1)。
 * @param {Actor} target
 * @param {{repairableCategories?: string[]}} usage
 * @returns {Item[]}
 */
export function listRepairableOutfits(target, usage) {
    const cats = new Set(usage?.repairableCategories ?? []);
    if (!cats.size) return [];
    const out = [];
    for (const it of (target?.items ?? [])) {
        if (!OUTFIT_TYPES.has(it.type)) continue;
        if (!isOutfitMalfunctioning(it.system)) continue;
        if (!outfitClassifications(it.system).some((c) => cats.has(c.major) || cats.has(c.minor))) continue;
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
    if (!(usage.repairableCategories ?? []).length) {
        ui.notifications.warn("修理できるアウトフィットの分類が設定されていません（用途の〈修理〉で設定してください）。");
        return;
    }

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
    ui.notifications.warn("対象の所有権がなく GM も不在のため、修理を適用できません。");
    return false;
}

/** GM が委譲された故障解除を代行する(socket)。 */
export async function applyRepairDelegated({ targetUuid, outfitId }) {
    const target = await fromUuid(targetUuid).catch(() => null);
    if (!target) return;
    const it = target.items.get(outfitId);
    if (it) await it.update({ "system.isMalfunction": false });
}
