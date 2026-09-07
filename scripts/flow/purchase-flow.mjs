/**
 * @fileoverview 購入フロー(16-3・正本 Purchase_and_Modification.md「購入判定」)。
 *
 * 起動＝辞典ブラウザのアウトフィットカードの「購入」ボタン(injectは tnx-dictionary-browser)。
 * 実行アクター＝選択トークンのアクター(RL が任意のアクターに購入させる経路)→無ければ
 * 担当キャラクター(PL)。経路は purchase-logic の decidePurchasePath で3分岐:
 * - unavailable: 購入値「ー」「解説参照」＝手続き自体が存在しない(ボタン側で不能化済みの保険)
 * - always: 購入値が外界実効値以下＝常時入手(確認→複製付与→カード公開)
 * - check: 方式選択(縦積みボタン・D&D 準拠)
 *   - カード判定: アクターの購入用途(usage.type="purchase")から選択し、唯一の起動関数
 *     `_activateItemCheck` に TN=購入値と完了継続 ctx.purchase を注入(登場判定と同型)。
 *     購入用途が無ければ選択肢をグレーアウトで見せる(designation-response と同じ規約)
 *   - カードなし特例(Check_Rules の信用特例): 判定フローを起動せず本フロー内で
 *     達成値 = 外界実効値 ＋ 消費報酬点。報酬点は消費時点一元ゲート(口座凍結/信用失墜=
 *     hasBountyBlock)で塞ぎ、使用分は system.bounty から実減算(判定の報酬点と同じ着地)
 *
 * 成功の帰結＝辞典原本(fromUuid で live 解決)の複製をアクターへ付与(1判定=1個)。
 * grantPurchasedItem の modSpec は「改造して入手」(変則効果・16-4 で有効化)の席。
 */

import {
    decidePurchasePath, computeNoCardPurchase, purchaseUnavailableReason,
    decidePreActPurchase, preActUnavailableReason,
} from "../rules/purchase.mjs";
import { hasBountyBlock } from "../rules/conditions.mjs";
import { usageDisplayName } from "../rules/usage-types.mjs";
import { DISABLED_TRIGGER_CLASS } from "../ui/ui-trigger-disable.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { getSessionState } from "../session/session-state.mjs";
import { promptModificationParamSelection } from "./modification-flow.mjs";
import { miracleRewriteVia } from "../rules/miracle.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * アクターの購入用途(usage.type="purchase")を列挙する。
 * @param {Actor} actor
 * @returns {Array<{item: Item, usage: object}>}
 */
export function enumeratePurchaseUsages(actor) {
    const out = [];
    for (const item of actor?.items ?? []) {
        for (const usage of item.system?.actions ?? []) {
            if (usage?.type === "purchase") out.push({ item, usage });
        }
    }
    return out;
}

/** 辞典ブラウザの購入ボタンから起動する。uuid=辞典アイテム(コンペンディウム)。 */
export async function startPurchaseFromBrowser(uuid) {
    const actor = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor) {
        return void ui.notifications.warn("購入するアクターがいません。トークンを選択するか、担当キャラクターを設定してください。");
    }
    if (!actor.isOwner) {
        return void ui.notifications.warn(`「${actor.name}」の所有権限がないため購入できません。`);
    }
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) return void ui.notifications.warn("購入対象の辞典アイテムを解決できませんでした。");

    // アクト未開始はプレアクト購入(2026-08-31 指示)。技能起点(信用判定経由)は本関数を
    // 通らない(startPurchaseWithUsage)ため、アクト状態にかかわらず通常の購入判定のまま
    if (!getSessionState().actStarted) return preActPurchase(actor, doc, uuid);

    const mundane = actor.system.mundane?.total ?? 0;
    const decision = decidePurchasePath(doc.system?.buy, mundane);
    if (decision.path === "unavailable") {
        return void ui.notifications.warn(purchaseUnavailableReason(decision.reason));
    }
    if (decision.path === "always") return alwaysAcquire(actor, doc, uuid, decision.targetValue, mundane);
    return promptPurchaseMethod(actor, doc, uuid, decision.targetValue, mundane);
}

/**
 * プレアクト購入(2026-08-31 指示・条件は同日ユーザー verbatim): 成立条件＝購入値・
 * 常備化経験点が値を持ち、**購入値 ≤ そのキャストの外界(実効値)**(正本
 * Purchase_and_Modification.md)。判定・報酬点は使わない取得で、付与する複製に
 * isPre-play を立てる=常備化経験点を支払わずプレアクトで購入して所持している状態
 * (経験点計上は _calcSingleItemCost が isPre-play で免除)。
 * プレアクトは卓の進行外のためチャットカードは出さない(通知＋シートの消費経験点に反映なし)。
 */
async function preActPurchase(actor, doc, uuid) {
    const mundane = actor.system.mundane?.total ?? 0;
    const decision = decidePreActPurchase(doc.system?.buy, doc.system?.preserveExp, mundane);
    if (!decision.ok) return void ui.notifications.warn(preActUnavailableReason(decision.reason));
    const esc = foundry.utils.escapeHTML;
    const ok = await DialogV2.confirm({
        window: { title: `プレアクト購入: ${esc(doc.name)}` },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>購入値 ${decision.targetValue} は外界（${mundane}）以下のため、プレアクト購入できます。「${esc(doc.name)}」を入手しますか？</p>`,
    });
    if (!ok) return;
    const created = await grantPurchasedItem(actor, uuid, null, { preAct: true });
    if (created) ui.notifications.info(`${actor.name} は「${created.name}」をプレアクト購入で入手した。`);
}

/** 常時入手(購入値が外界点以下): 確認→複製付与→カード公開。判定は行わない。
 *  @returns {Promise<boolean>} 入手したか(キャンセル・付与失敗は false) */
async function alwaysAcquire(actor, doc, uuid, targetValue, mundane) {
    const esc = foundry.utils.escapeHTML;
    const ok = await DialogV2.confirm({
        window: { title: `購入: ${esc(doc.name)}` },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>購入値 ${targetValue} は外界（${mundane}）以下のため、いつでも入手できます。入手しますか？</p>`,
    });
    if (!ok) return false;
    const created = await grantPurchasedItem(actor, uuid);
    if (!created) return false;
    await postPurchaseCard({ actor, mode: "always", itemName: doc.name, targetValue, mundane });
    ui.notifications.info(`${actor.name} は「${created.name}」を入手した。`);
    return true;
}

/**
 * 「改造して入手」(16-4・購入用途の任意属性): 判定前に改造項目を選択して modSpec を作る。
 * 属性オフは {modSpec: null}(素の購入)。null=中止(選択キャンセル・レベル0)。
 */
async function resolveAcquireModSpec(usage, usageItem, doc) {
    if (usage?.acquireModified !== true) return { modSpec: null };
    const level = Number(usageItem.system.levelTotal ?? usageItem.system.level) || 0;
    if (level <= 0) {
        ui.notifications.warn(`「${usageItem.name}」のレベルが 0 のため、改造して入手（＋［レベル］）の効果がありません。`);
        return null;
    }
    const pick = await promptModificationParamSelection(doc, level);
    if (!pick) return null;
    return { modSpec: { param: pick.param, value: pick.value, note: usage.name || usageItem.name } };
}

/** 購入方式の選択(縦積みボタン): 購入用途ごとのカード判定＋カードなし特例＋キャンセル。 */
async function promptPurchaseMethod(actor, doc, uuid, targetValue, mundane) {
    const esc = foundry.utils.escapeHTML;
    const candidates = enumeratePurchaseUsages(actor);
    const buttons = candidates.map((c, i) => ({
        action: `usage${i}`,
        icon: "fas fa-clover",
        label: `${usageDisplayName(c.usage, c.item.name)}で判定する`,
        callback: () => ({ kind: "check", index: i }),
    }));
    // 購入用途なし: 選択肢の存在は見せたままグレーアウト(designation-response の規約)
    if (!candidates.length) {
        buttons.push({
            action: "noUsage", icon: "fas fa-clover", label: "カード判定（購入用途を持つ技能がありません）",
            disabled: true, class: DISABLED_TRIGGER_CLASS, callback: () => null,
        });
    }
    buttons.push({
        action: "noCard", icon: "fas fa-coins", label: "カードを出さずに購入（外界＋報酬点）",
        callback: () => ({ kind: "noCard" }),
    });
    buttons.push({ action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false });

    const choice = await DialogV2.wait({
        window: { title: `購入判定: ${esc(doc.name)}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
        position: { width: 400 },
        content: `<p>目標値（購入値）: <strong>${targetValue}</strong></p>`,
        buttons,
        close: () => null,
    });
    if (!choice) return;

    if (choice.kind === "noCard") return noCardPurchase(actor, doc, uuid, targetValue, mundane);

    const picked = candidates[choice.index];
    if (!picked) return;
    // 「改造して入手」属性の購入は判定前に改造項目を選ぶ(16-4)
    const spec = await resolveAcquireModSpec(picked.usage, picked.item, doc);
    if (!spec) return;
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(actor, picked.item, {
        usageId: picked.usage._id,
        targetValue,
        purchase: {
            actorId: actor.id, uuid, itemName: doc.name,
            ...(spec.modSpec ? { modSpec: spec.modSpec } : {}),
        },
    });
}

/** カードなし特例: 達成値 = 外界 ＋ 消費報酬点。報酬点は一元ゲート＋実減算。 */
async function noCardPurchase(actor, doc, uuid, targetValue, mundane) {
    const blocked = hasBountyBlock(TnxCheckFlow._gatherConditions(actor));
    const available = blocked ? 0 : (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);
    const bountySpent = await TnxCheckFlow._promptBountyUsage(available, { baseAchievement: mundane });
    const result = computeNoCardPurchase({ mundaneTotal: mundane, bountySpent, targetValue });
    if (bountySpent > 0) {
        await actor.update({ "system.bounty": (actor.system.bounty ?? 0) - bountySpent });
    }
    let granted = false;
    if (result.success) granted = !!(await grantPurchasedItem(actor, uuid));
    await postPurchaseCard({
        actor, mode: "noCard", itemName: doc.name, targetValue, mundane,
        bountySpent, achievement: result.achievement, success: result.success, diff: result.diff,
        granted,
    });
    if (granted) ui.notifications.info(`${actor.name} は「${doc.name}」を入手した。`);
}

/**
 * 技能起点の購入(16-3 追補・2026-08-31 指示): 購入用途をアイテムロールから起動した場合、
 * アウトフィットのみの辞典ブラウザ(選択モード)を開く(D&D のドロップエリア起動の絞り込み
 * ブラウザと同型)。対象の購入ボタンで startPurchaseWithUsage に合流する。
 */
export async function startPurchasePicker(actor, item, usage) {
    const { TnxDictionaryBrowser } = await import("../app/tnx-dictionary-browser.mjs");
    TnxDictionaryBrowser.openOutfitPicker({ actorId: actor.id, itemId: item.id, usageId: usage._id });
}

/**
 * 起動元の用途が確定している購入(技能起点)。方式選択(用途選択＋カードなし特例)をスキップして
 * 判定ダイアログへ直接合流する(技能から起動した時点で「カードで判定する」意図が確定している・
 * 2026-08-31 理解確認済み)。常時入手(購入値≤外界)と不能化(「ー」「解説参照」)の分岐は
 * 通常経路と同じに生きる。
 * @param {string} uuid 辞典アイテムの uuid
 * @param {{actorId: string, itemId: string, usageId: string}} origin 起動元
 * @returns {Promise<boolean>} 購入手続きを開始したか(選択モードのブラウザを閉じてよいか)
 */
export async function startPurchaseWithUsage(uuid, { actorId, itemId, usageId, miracle = false, asOtherUuid = "", rewriteId = "" }) {
    const actor = game.actors.get(actorId);
    const item = actor?.items.get(itemId);
    // 神業の入手(《タイムリー》《買収》・17-6): 購入値や外界の条件を問わず、宣言の効果へ再入する
    // (用途は他の神業として使う参照先にあることもあるため、ここでは解決しない)
    if (miracle) {
        if (!actor || !item) { ui.notifications.warn("入手の起動元（神業・用途）を解決できませんでした。"); return false; }
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) { ui.notifications.warn("入手するアウトフィットを解決できませんでした。"); return false; }
        let asOther = null;
        if (asOtherUuid) {
            const src = await fromUuid(asOtherUuid).catch(() => null);
            // 神業書き換え技能(rewriteId)なら、効果の出どころは技能自身のこともある(kind=skill)。
            // 書き換えの印(via)はここで組み直す——辞典ブラウザを挟むと文脈が一度切れるため
            const skill = rewriteId ? actor.items.get(rewriteId) : null;
            if (src) {
                asOther = { uuid: asOtherUuid, name: src.name, source: src };
                if (skill) {
                    asOther.kind = src.type === "miracle" ? "miracle" : "skill";
                    asOther.via = miracleRewriteVia(skill);
                }
            }
        }
        const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
        await TnxCharacterSheetBase._activateItemCheck(actor, item, {
            usageId, purchase: { actorId: actor.id, uuid, itemName: doc.name }, ...(asOther ? { asOther } : {}),
        });
        return true;
    }
    const usage = item?.system.actions?.find((a) => a._id === usageId);
    if (!actor || !item || !usage) {
        ui.notifications.warn("購入判定の起動元（技能・用途）を解決できませんでした。");
        return false;
    }
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) {
        ui.notifications.warn("購入対象の辞典アイテムを解決できませんでした。");
        return false;
    }
    const mundane = actor.system.mundane?.total ?? 0;
    const decision = decidePurchasePath(doc.system?.buy, mundane);
    if (decision.path === "unavailable") {
        ui.notifications.warn(purchaseUnavailableReason(decision.reason));
        return false;
    }
    if (decision.path === "always") {
        return alwaysAcquire(actor, doc, uuid, decision.targetValue, mundane);
    }
    // 「改造して入手」属性の購入は判定前に改造項目を選ぶ(16-4)
    const spec = await resolveAcquireModSpec(usage, item, doc);
    if (!spec) return false;
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(actor, item, {
        usageId,
        targetValue: decision.targetValue,
        purchase: {
            actorId: actor.id, uuid, itemName: doc.name,
            ...(spec.modSpec ? { modSpec: spec.modSpec } : {}),
        },
    });
    return true;
}

/**
 * カード判定の完了継続(ctx.purchase)。成功で辞典原本の複製を付与する。
 * 再判定は rerunOnSuccessOnly(失敗→成功の遷移でのみ付与・成功→失敗は表示のみ=手動除去)。
 */
export async function resolvePurchaseFromCheck(cc, result) {
    if (result?.success !== true) return;
    const actor = game.actors.get(cc?.actorId);
    if (!actor) return;
    const created = await grantPurchasedItem(actor, cc.uuid, cc.modSpec ?? null);
    if (created) ui.notifications.info(`${actor.name} は「${created.name}」を入手した。`);
}

/**
 * 辞典原本の複製をアクターへ付与する(1判定=1個)。
 * 入手区分のフラグを立てる(経験点計上の免除・正本 Outfits.md): 通常(判定経由=カード判定・
 * カードなし特例・常時入手)は isCheckAcquired、プレアクト購入は isPre-play。
 * @param {Actor} actor 付与先
 * @param {string} uuid 辞典アイテムの uuid(live 解決)
 * @param {?object} modSpec 「改造して入手」の改造指定(16-4 で有効化・現状は素の複製のみ)
 * @param {{preAct?: boolean}} [opts] preAct=true でプレアクト購入として付与
 * @returns {Promise<?Item>}
 */
export async function grantPurchasedItem(actor, uuid, modSpec = null, { preAct = false } = {}) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) {
        ui.notifications.warn("購入対象の辞典アイテムを解決できず、付与できませんでした。");
        return null;
    }
    const data = doc.toObject();
    delete data._id;
    delete data.folder;
    data.sort = 0;
    if (preAct) data.system["isPre-play"] = true;
    else data.system.isCheckAcquired = true;
    // 「改造して入手」(16-4): 判定前に選択した改造項目を複製の改造記録へ書き込む
    if (modSpec?.param) {
        const rows = Array.isArray(data.system.modifications) ? data.system.modifications : [];
        data.system.modifications = [...rows, { param: modSpec.param, value: modSpec.value ?? 0, note: modSpec.note ?? "" }];
    }
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
}

/** 常時入手・カードなし特例の結果カードを投稿する(カード判定の結果は check-result 側)。 */
async function postPurchaseCard(data) {
    const { actor, ...rest } = data;
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/purchase-result.hbs",
        {
            ...rest,
            isAlways: rest.mode === "always",
            // 差分値は成功時のみ(既存エンジンの規約=失敗時は算出されない・カード判定の結果カードと同じ)
            diffDisplay: rest.success === true && Number.isFinite(rest.diff)
                ? (rest.diff >= 0 ? `+${rest.diff}` : `${rest.diff}`) : null,
        },
    );
    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
}
