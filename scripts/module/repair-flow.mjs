/**
 * @fileoverview 修理フロー(2026-07-18 ユーザー確定・repair タイプ)。
 *
 * 〈製作〉等の技能に持たせた「修理」用途で、故障したアウトフィットの故障(isMalfunction)を解除する。
 * 破壊(isDestroyed)は修理対象外(基本アクト終了まで直らない)。
 *
 * フロー:
 * 1. 使用(アイテムロール) → 対象解決(ターゲット1体。無ければ確認→自分)
 * 2. 対象が所持する故障アウトフィットのうち、用途の repairableCategories(小分類ホワイトリスト)に
 *    合致するものを1つ選択
 * 3. 判定へ(共通前段 buildUsageCheckContext → TnxCheckFlow.open)。完了継続 ctx.repair が
 *    成功時に選択アウトフィットの故障を解除する(対象の所有権が無ければ GM 委譲)。
 *
 * サービス大分類は故障しない(免疫)ため候補に出ない(isOutfitMalfunctioning が false)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { resolveUsageTargetRefs } from "./target-resolution.mjs";
import { postConditionOutcome } from "./condition-resolution.mjs";
import { itemDisplayName } from "./identification.mjs";
import { isOutfitMalfunctioning } from "../data/item/helpers.mjs";
import { OUTFIT_TYPES, getMajorCategoryLabel, getMinorCategoryLabel } from "../data/item/outfit-categories.mjs";

/**
 * 対象が所持する、この用途で修理できる故障アウトフィットを列挙する。
 * 故障中(実効・サービス免疫は除外)かつ小分類がホワイトリストに合致するもの。
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
        if (!cats.has(it.system.minorCategory)) continue;
        out.push(it);
    }
    return out;
}

/** 修理対象(故障アウトフィット1つ)の選択ダイアログ。null=中止。 */
async function promptRepairSelection(target, candidates) {
    const esc = foundry.utils.escapeHTML;
    const rows = candidates.map((it, i) => {
        const cat = `${getMajorCategoryLabel(it.system.majorCategory)}／${getMinorCategoryLabel(it.system.minorCategory)}`;
        return `<div class="tnx-uses-row"><label>
            <input type="radio" name="repair" value="${esc(it.id)}" ${i === 0 ? "checked" : ""}>
            <span>${esc(itemDisplayName(it))}（${esc(cat)}）</span></label></div>`;
    }).join("");
    const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: `修理対象の選択: ${target.name}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
        position: { width: 420 },
        content: `<div class="tnx-uses-consume">
            <p class="tnx-uses-note">修理する故障アウトフィットを選んでください。</p>${rows}</div>`,
        buttons: [
            { action: "ok", icon: "fas fa-screwdriver-wrench", label: "決定", default: true,
              callback: (_e, _b, dialog) => dialog.element.querySelector('input[name="repair"]:checked')?.value ?? null },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (!picked) return null;
    return candidates.find(it => it.id === picked) ?? null;
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

    // 対象解決(決定表駆動・2026-07-18): 対象「単体」未ターゲットは自動セルフ。複数時は先頭の1体
    const refs = await resolveUsageTargetRefs(actor, usage);
    if (refs === null) return;
    if (!refs.length) {
        ui.notifications.warn("修理する対象がターゲットされていません（用途の対象を設定するか、対象をターゲットしてください）。");
        return;
    }
    const target = await fromUuid(refs[0].uuid).catch(() => null);
    if (!target) return;

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
            targetUuid: target.uuid,
            outfitId:   chosen.id,
            outfitName: itemDisplayName(chosen),
            usageName:  usage.name || item.name,
        },
    });
}

/**
 * 修理判定の完了継続(TnxCheckFlow._execute から)。成功で選択アウトフィットの故障を解除する。
 * 目標値なし(成否 null)は達成値の報告のみ(解除は卓裁定=手動)。
 * @param {{targetUuid:string, outfitId:string, outfitName:string, usageName:string}} ctx
 * @param {object} result 判定結果
 */
export async function resolveRepairFromCheck(ctx, result) {
    const target = await fromUuid(ctx.targetUuid).catch(() => null);
    if (!target) return;

    if (result?.success === false || result?.fumble) {
        await postConditionOutcome(target, {
            title: ctx.usageName, tag: "修理失敗", status: "failure",
            label: ctx.outfitName, text: "の故障は直りませんでした。",
        });
        return;
    }
    if (result?.success !== true) return; // 目標値なし=成否は卓裁定(解除は手動)

    if (!await applyRepairClear(target, ctx.outfitId)) return;
    await postConditionOutcome(target, {
        title: ctx.usageName, tag: "修理", status: "success",
        label: ctx.outfitName, text: "の故障を修理しました。",
    });
}

/** 故障の解除を実行する(所有権が無ければ repairApply ソケットで GM 委譲)。 */
async function applyRepairClear(target, outfitId) {
    if (target.isOwner) {
        const it = target.items.get(outfitId);
        if (it) await it.update({ "system.isMalfunction": false });
        return true;
    }
    if (game.users.activeGM) {
        TnxSocketHandler.emitRepairApply({ targetUuid: target.uuid, outfitId });
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
