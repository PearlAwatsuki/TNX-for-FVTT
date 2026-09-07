/**
 * @fileoverview 改造フロー(16-4・正本 Purchase_and_Modification.md「改造判定」)。修理フローと同型。
 *
 * 〈製作〉等との組み合わせを持つ改造タイプ用途で、対象アウトフィットの1項目を＋［レベル］改造する。
 * - 項目選択は**判定前**(2026-08-31 ユーザー裁定): 対象選択→項目選択→判定→成功で適用。
 * - ＋［レベル］の［レベル］=当該改造技能(用途の親アイテム)のレベル実効値。
 * - 改造の重複規約(2026-08-31 verbatim): 1つのアウトフィットの1つの項目への改造は技能を問わず
 *   1回だけ。別々の項目へは同じ改造技能で重複可。項目選択で改造済みを不能表示＋適用時二重ガード。
 * - 「ー」「解説参照」の項目は不可。用途の目標値式が購入値(@outfit.buy)を参照する場合、
 *   購入値「ー」のアウトフィットは対象にできない。
 * - 住宅施設: 登場判定目標値は±二択・セキュリティは電脳/アナログ一括。
 * - ドラッグ特殊: パラメータ修正でなく、所持ドラッグを［レベル］個まで選択して各ドラッグの
 *   用途タイミングを一時的にマイナーアクションへ上書き(2026-08-31 ユーザー提案・
 *   実装=drugTiming の改造行を各ドラッグに記録し、タイミング読者が実効解決)。
 * - 組み合わせ技能の適否(対応分類の一致)はシステムで制限しない(一般則・卓の裁量)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { stampCardOutcome } from "../chat/chat-card.mjs";
import { nowrap } from "../chat/chat-text.mjs";
import { TnxSocketHandler } from "../core/tnx-socket-handler.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { resolveTargetedOrSelf } from "./target-resolution.mjs";
import { itemDisplayName } from "../core/identification.mjs";
import { DISABLED_TRIGGER_CLASS } from "../ui/ui-trigger-disable.mjs";
import { ListSelectionDialog } from "../ui/tnx-dialog.mjs";
import { OUTFIT_TYPES, getMajorCategoryLabel, getMinorCategoryLabel, outfitClassifications, hasClassification } from "../data/item/outfit-categories.mjs";
import {
    MODIFICATION_PARAMS, listModificationChoices, modificationUnavailableReason,
    hasDrugTimingOverride,
} from "../data/item/modification-params.mjs";

const { DialogV2 } = foundry.applications.api;

/** 用途の目標値式が対象の購入値(@outfit.buy)を参照するか。 */
export function usageReferencesBuy(usage) {
    if (usage?.targetValue !== "explanation" && usage?.targetValue !== "other") return false;
    return String(usage?.targetValueOther ?? "").includes("outfit.buy");
}

/**
 * 対象アウトフィットの改造可否(対象選択の不能化)。
 * @returns {?string} 不能理由(null=選択可)
 */
export function outfitUnmodifiableReason(system, usage) {
    if (usageReferencesBuy(usage) && system.buy?.mode !== "value") {
        return "購入値が「ー」「解説参照」のため、この技能（目標値が購入値参照）では改造できません";
    }
    const choices = listModificationChoices(system, outfitClassifications(system));
    if (!choices.some((c) => c.availability === "ok")) return "改造できる項目がありません";
    return null;
}

/** 対象アウトフィット(1つ)の選択ダイアログ。不能は理由つきグレーアウトで見せる。null=中止。 */
async function promptOutfitSelection(target, usage) {
    const candidates = (target?.items ?? []).filter((it) => OUTFIT_TYPES.has(it.type));
    if (!candidates.length) {
        ui.notifications.warn(`「${target.name}」は改造できるアウトフィットを所持していません。`);
        return null;
    }
    const picked = await ListSelectionDialog.prompt({
        title:       `改造対象の選択: ${target.name}`,
        note:        "改造するアウトフィットを選んでください。",
        confirmIcon: "fas fa-wrench",
        width:       440,
        options: candidates.map((it) => ({
            value:    it.id,
            label:    itemDisplayName(it),
            sub:      `${getMajorCategoryLabel(it.system.majorCategory)}／${getMinorCategoryLabel(it.system.minorCategory)}`,
            disabled: outfitUnmodifiableReason(it.system, usage) ?? "",
        })),
    });
    return picked ? (candidates.find((it) => it.id === picked) ?? null) : null;
}

/**
 * 改造項目の選択(判定前・縦積みボタン)。住宅の登場判定目標値は±二択に展開。
 * 「改造して入手」(購入用途の属性・purchase-flow)も同じダイアログを共用する。
 * @param {Item} outfit 対象(所持アイテムまたは辞典アイテム)
 * @param {number} level ＋［レベル］のレベル(改造技能/購入用途の親技能のレベル実効値)
 * @returns {?{param: string, value: number}} null=中止
 */
export async function promptModificationParamSelection(outfit, level) {
    const choices = listModificationChoices(outfit.system, outfitClassifications(outfit.system));
    const buttons = [];
    let idx = 0;
    const results = [];
    for (const c of choices) {
        const disabled = c.availability !== "ok";
        const reason = modificationUnavailableReason(c.availability);
        // 登場判定目標値は「＋［レベル］または−［レベル］」の二択(テーブルの住宅施設行)
        const variants = c.key === "appearance"
            ? [{ value: level, sign: "＋" }, { value: -level, sign: "−" }]
            : [{ value: c.key === "drugTiming" ? 0 : level, sign: "＋" }];
        for (const v of variants) {
            const suffix = c.key === "drugTiming" ? "" : `に${v.sign}${Math.abs(v.value)}`;
            buttons.push({
                action: `p${idx}`,
                icon: "fas fa-wrench",
                label: `${c.label}${suffix}${disabled ? `（${reason}）` : ""}`,
                disabled,
                class: disabled ? DISABLED_TRIGGER_CLASS : "",
                callback: ((i) => () => results[i])(idx),
            });
            results[idx] = { param: c.key, value: v.value };
            idx += 1;
        }
    }
    buttons.push({ action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false });
    return DialogV2.wait({
        window: { title: `改造項目の選択: ${itemDisplayName(outfit)}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
        position: { width: 420 },
        content: "",
        buttons,
        close: () => null,
    });
}

/**
 * ドラッグ特殊: マイナーアクション化する所持ドラッグを［レベル］個まで選択(チェックボックス)。
 * 改造済み(上書き済み)は不能表示。
 * @returns {?string[]} 選択したドラッグの itemId 配列(null=中止)
 */
async function promptDrugSelection(target, level) {
    const drugs = (target?.items ?? []).filter((it) =>
        OUTFIT_TYPES.has(it.type) && hasClassification(it.system, "drug"));
    if (!drugs.length) {
        ui.notifications.warn(`「${target.name}」はドラッグを所持していません。`);
        return null;
    }
    // 中止の判定は ListSelectionDialog が担う。従来ここは `picked === null` で中止を見ていたが、
    // DialogV2 はコールバックの戻り値が無いと action 文字列("cancel")を返すため、キャンセルが
    // 中止と判定されず「最大 N 個」の警告つきで開き直る恐れがあった(2026-09-07)
    return await ListSelectionDialog.prompt({
        title:       `マイナーアクション化するドラッグの選択（最大 ${level} 個）`,
        confirmIcon: "fas fa-wrench",
        width:       440,
        multi:       true,
        min:         1,
        max:         level,
        minMessage:  "ドラッグを1つ以上選んでください。",
        maxMessage:  `選択できるのは最大 ${level} 個です。`,
        options: drugs.map((it) => ({
            value:    it.id,
            label:    itemDisplayName(it),
            disabled: hasDrugTimingOverride(it.system) ? modificationUnavailableReason("modified") : "",
        })),
    });
}

/**
 * 改造用途を使用する(アイテムロールから)。対象選択→項目選択(判定前)→判定。
 * 完了継続 ctx.modification が成功で改造行を適用する。
 * @param {Item} item 改造タイプの用途を持つ技能
 * @param {object} usage type="modification" の用途エントリ
 */
export async function useModification(item, usage) {
    const actor = item.actor;
    if (!actor) { ui.notifications.warn("改造はアクターが所持している技能から使用してください。"); return; }
    const level = Number(item.system.levelTotal ?? item.system.level) || 0;
    if (level <= 0) {
        ui.notifications.warn(`「${item.name}」のレベルが 0 のため、改造（＋［レベル］）の効果がありません。`);
        return;
    }

    // 対象: ターゲット中のキャラクター(先頭)・いなければ自分(修理と同じ・対象欄では分岐しない)
    const target = resolveTargetedOrSelf(actor);

    const outfit = await promptOutfitSelection(target, usage);
    if (!outfit) return;

    // 項目選択は判定前(2026-08-31 裁定)
    const pick = await promptModificationParamSelection(outfit, level);
    if (!pick) return;

    // ドラッグ特殊: ［レベル］個までの所持ドラッグを選択(こちらも判定前)
    let drugIds = null;
    if (pick.param === "drugTiming") {
        drugIds = await promptDrugSelection(target, level);
        if (!drugIds) return;
    }

    // 判定。目標値式には対象の購入値実効(@outfit.buy)を注入する
    const base = await buildUsageCheckContext(actor, item, usage, {
        targetValueExtra: { outfit: { buy: Number(outfit.system.buy?.total ?? outfit.system.buy?.value) || 0 } },
    });
    if (!base) return;

    await TnxCheckFlow.open({
        ...base,
        modification: {
            // 委譲の受理条件で使う行為者=改造する人(修理と同じ)
            actorUuid:  actor.uuid,
            targetUuid: target.uuid,
            outfitId:   outfit.id,
            outfitName: itemDisplayName(outfit),
            param:      pick.param,
            value:      pick.value,
            drugIds,
            usageName:  usage.name || item.name,
        },
    });
}

/**
 * 改造判定の完了継続(TnxCheckFlow._execute / 再判定 rerun から)。成功で改造行を適用する。
 * 目標値なし(成否 null)は達成値の報告のみ(適用は卓裁定=手動)。
 * 改造したことは**判定結果カードの帰結行**として刻む(2026-09-07 ユーザー指示・別カードを出さない)。
 * 失敗は結果カード自身が「失敗」と示すため、帰結行は刻まない。
 * @param {{messageId?: ?string}} [args] messageId=帰結行を刻む判定結果カード
 */
export async function resolveModificationFromCheck(cc, result, { messageId = null } = {}) {
    const target = await fromUuid(cc.targetUuid).catch(() => null);
    if (!target) return;

    if (result?.success !== true) return; // 失敗・目標値なし(成否は卓裁定=適用は手動)

    const rows = cc.param === "drugTiming"
        ? (cc.drugIds ?? []).map((id) => ({ outfitId: id, param: "drugTiming", value: 0, note: cc.usageName }))
        : [{ outfitId: cc.outfitId, param: cc.param, value: cc.value, note: cc.usageName }];
    if (!await applyModificationRows(target, rows, cc.actorUuid)) return;

    const paramLabel = MODIFICATION_PARAMS[cc.param]?.label ?? cc.param;
    const effectText = cc.param === "drugTiming"
        ? "のマイナーアクション化"
        : `の${paramLabel}${cc.value >= 0 ? `＋${cc.value}` : `−${Math.abs(cc.value)}`}`;
    // 名前は1つずつ「」でくくる(ドラッグは複数=まとめてくくると1つの名前に見える)
    const esc = foundry.utils.escapeHTML;
    const names = cc.param === "drugTiming"
        ? (cc.drugIds ?? []).map((id) => `「${esc(itemDisplayName(target.items.get(id)) || "?")}」`).join("、")
        : `「${esc(cc.outfitName)}」`;
    const message = messageId ? game.messages.get(messageId) : null;
    if (message) {
        await stampCardOutcome(message, { icon: "fa-wrench",
            text: `${esc(target.name)}の${names}${nowrap(esc(effectText))}${nowrap("を適用した")}` });
    }
}

/**
 * 改造行の適用(所有権が無ければ modificationApply ソケットで GM 委譲)。
 * 二重ガード: 既に同項目の改造行があるアイテムはスキップして警告(1項目1回・並行操作対策)。
 */
async function applyModificationRows(target, rows, actorUuid = null) {
    if (target.isOwner) {
        await applyModificationRowsLocal(target, rows);
        return true;
    }
    if (game.users.activeGM) {
        TnxSocketHandler.emitModificationApply({ targetUuid: target.uuid, rows, actorUuid });
        return true;
    }
    ui.notifications.warn("対象の所有権がなく GM も不在のため、改造を適用できません。");
    return false;
}

/** 改造行の実適用(ローカル)。GM 委譲側と共用。 */
export async function applyModificationRowsLocal(target, rows) {
    const updates = [];
    for (const row of rows) {
        const it = target.items.get(row.outfitId);
        if (!it) continue;
        const existing = Array.isArray(it.system.modifications) ? it.system.modifications : [];
        if (existing.some((r) => r?.param === row.param)) {
            ui.notifications.warn(`「${itemDisplayName(it)}」の項目は既に改造済みのため適用しませんでした（1項目1回）。`);
            continue;
        }
        updates.push({ _id: it.id, "system.modifications": [...existing, { param: row.param, value: row.value, note: row.note ?? "" }] });
    }
    if (updates.length) await target.updateEmbeddedDocuments("Item", updates);
}

/** GM が委譲された改造適用を代行する(socket)。 */
export async function applyModificationDelegated({ targetUuid, rows }) {
    const target = await fromUuid(targetUuid).catch(() => null);
    if (!target) return;
    await applyModificationRowsLocal(target, rows);
}
