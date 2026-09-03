/**
 * @fileoverview 神業の使用フロー(フェーズ17-1・Foundry 依存側)。純ロジックは miracle-logic.mjs。
 *
 * 神業はゴールデンルール「RL の絶対権限」のひとつ下に位置する強制力の強いルール(Miracle_Rules
 * 「神業の位置づけ」)。挙動は既存の用途の器で表現し、用途は前提条件にしない——**用途が0件でも
 * 機能する**(ロール→残回数ゲート→使用回数の消費→神業カード)。固有の挙動(打ち消し・防御・
 * ダメージ等)は用途のフラグで乗る(17-2 以降)。
 *
 * 神業由来の印(miracleOriginOf)は神業カードのフラグ `miracle` に刻む。読み手は isMiracleOrigin。
 * 起動は唯一の起動関数 `_activateItemCheck` からのみ(旧 _onUseMiracle は撤去)。
 */

import { miracleUseGate, miracleConsumeUpdate, buildMiracleCardData, miracleOriginOf } from "./miracle-logic.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 神業カードを投稿する。効果文と条件はここでエンリッチし、描画データは純関数で組む。
 * 適用効果(usageEffects)があれば解説カードと同じ器(tnx-usage-use-card ＋ 効果エリア)で包み、
 * 「効果を適用」トレイは renderChatMessageHTML フックが差し込む。
 * @param {Item} item 神業アイテム
 * @param {{usageEffects?: ?object}} [opts]
 * @returns {Promise<ChatMessage>}
 */
export async function postMiracleCard(item, { usageEffects = null } = {}) {
    const TE = foundry.applications.ux.TextEditor;
    const [description, condition] = await Promise.all([
        TE.enrichHTML(item.system?.description ?? "", { relativeTo: item }),
        TE.enrichHTML(item.system?.usageCondition ?? "", { relativeTo: item }),
    ]);
    const { remaining, max } = miracleUseGate(item.system);
    const data = buildMiracleCardData(item, { description, condition, remaining, max });
    const card = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/miracle-card.hbs", data);
    return ChatMessage.create({
        user:    game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: item.actor ?? undefined }),
        content: usageEffects
            ? `<div class="tnx-usage-use-card">${card}<div class="tnx-usage-effect-area"></div></div>`
            : card,
        flags: {
            "core.canPopout": true,
            [SCOPE]: {
                miracle: miracleOriginOf(item),
                ...(usageEffects ? { usageEffects } : {}),
            },
        },
    });
}

/**
 * 用途を持たない神業の使用(既定挙動)。残回数ゲート→消費→神業カード。
 * @param {Item} item 神業アイテム
 * @returns {Promise<boolean>} 使用したら true(残り無しで中止なら false)
 */
export async function useMiracleWithoutUsage(item) {
    const gate = miracleUseGate(item.system);
    if (!gate.ok) {
        ui.notifications.warn(`神業「${item.name}」はこれ以上使用できません。`);
        return false;
    }
    await item.update(miracleConsumeUpdate(item.system));
    await postMiracleCard(item);
    return true;
}
