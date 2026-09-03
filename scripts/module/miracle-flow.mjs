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

import {
    miracleUseGate, miracleConsumeUpdate, buildMiracleCardData, miracleOriginOf,
    negateCheckGate, negatedCheckMods,
} from "./miracle-logic.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { applyConsumptionPlan } from "./usage-consumption.mjs";

const SCOPE = "tokyo-nova-axleration";

// ─── 打ち消し(防御タイプ・17-2) ────────────────────────────────────────────────
// 正本: Miracle_Rules「打ち消しの範囲」= 判定に対しては失敗させる／宣言に対しては効果の適用を
// キャンセルする。いずれも適用前に限る(遡及不可)。発動はクリック待ち(kind=negate)で、発動点は
// 結果カード/攻撃カードの達成値・宣言カードの効果トレイ見出し・神業カードの見出し。
// 打ち消されたものはカードから消える(理由の行は残さない=直前に神業カードが出ている)。

/** クリック待ち(negate)の状態から打ち消す神業と印を解決する。モード外なら null。 */
function negateState() {
    const state = TnxCheckFlow.peekAchievementAction("negate");
    if (!state) return null;
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return null; }
    return { state, actor, skill, by: { itemId: skill.id, name: skill.name, actorId: actor.id } };
}

/** 打ち消しの確定: モード解除と消費(待ち受け開始時に確定したプラン)。 */
async function commitNegate(state) {
    TnxCheckFlow.cancelAchievementAction();
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);
}

/**
 * 結果カード/攻撃カードの達成値クリック(打ち消し待ち中): その判定を失敗させる。
 * 攻撃なら攻撃カードを全体失敗(failedReason=negated)にし、出ているダメージカードは全対象を
 * 防いだ扱いにして消す(適用済みがあれば拒否)。それ以外は事後修正の器(checkMods)に打ち消し行を
 * 積み、成否を失敗に固定する(達成値は変えない)。
 * @param {ChatMessage} message
 */
export async function handleNegateAchievementClick(message) {
    const ns = negateState();
    if (!ns) return;
    const checkF = message.getFlag(SCOPE, "checkResult");
    const attackF = message.getFlag(SCOPE, "attackCheck");
    if (!checkF && !attackF) return;
    const rc = message.getFlag(SCOPE, "checkRecheck") ?? {};
    const damageCards = attackF
        ? [...game.messages].filter(m => m.getFlag(SCOPE, "damageRoll")?.attackMessageId === message.id)
        : [];
    if ((attackF?.failedReason === "negated") || (message.getFlag(SCOPE, "checkMods")?.rows ?? []).some(r => r?.negatedBy)) {
        ui.notifications.warn("この判定は既に打ち消されています。");
        return;
    }
    const gate = negateCheckGate({ recheck: rc, damageCards: damageCards.map(m => ({ applied: m.getFlag(SCOPE, "damageRoll")?.applied === true })) });
    if (!gate.ok) {
        ui.notifications.warn("この判定の効果は適用済みのため打ち消せません（時間をさかのぼって打ち消すことはできません）。");
        return;
    }
    await commitNegate(ns.state);

    if (attackF) {
        const { applyAttackPatch } = await import("./attack-flow.mjs");
        await applyAttackPatch(message, { state: "failed", failedReason: "negated", negatedBy: ns.by });
        const { applyDamagePatch } = await import("./damage-flow.mjs");
        for (const dm of damageCards) {
            const f = dm.getFlag(SCOPE, "damageRoll");
            const targets = (f.targets ?? []).map(t => ({ ...t, protectedBy: ns.by }));
            await applyDamagePatch(dm, { targets, negatedBy: ns.by });
        }
        return;
    }
    const mods = negatedCheckMods(message.getFlag(SCOPE, "checkMods"), {
        achievement: message.getFlag(SCOPE, "checkMods")?.achievement ?? checkF.result?.achievement ?? 0,
        targetValue: rc?.targetValue ?? null,
        by: ns.by,
    });
    await TnxSocketHandler.applyMessagePatch(message, {
        [`flags.${SCOPE}.checkMods`]: mods,
        [`flags.${SCOPE}.checkResult.result.success`]: false,
        [`flags.${SCOPE}.checkResult.result.diff`]: null,
        [`flags.${SCOPE}.negatedBy`]: ns.by,
    });
    // 判定要求由来なら要求カードの結果表示を追随させる(失敗に)
    if (rc?.requestMessageId) {
        const result = foundry.utils.deepClone(checkF.result);
        result.success = false; result.diff = null;
        TnxSocketHandler.emitCheckResult(rc.requestMessageId, rc.actorId, result);
    }
}

/**
 * 宣言カードの効果トレイ見出しクリック(打ち消し待ち中): 効果の適用をキャンセルする。
 * usageEffects に negatedBy を刻み、トレイは描画されなくなる(usageEffectTrayContext が null)。
 * 適用済みかどうかはカードが状態を持たないため判別しない(適用前に限るのは卓の運用)。
 * @param {ChatMessage} message
 */
export async function handleNegateTrayClick(message) {
    const ns = negateState();
    if (!ns) return;
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload) return;
    if (payload.negatedBy) { ui.notifications.warn("この効果は既に打ち消されています。"); return; }
    await commitNegate(ns.state);
    await TnxSocketHandler.applyMessagePatch(message, { [`flags.${SCOPE}.usageEffects.negatedBy`]: ns.by });
}

/**
 * 神業カードの見出しクリック(打ち消し待ち中): その神業を打ち消す。効果文・条件・効果トレイ
 * (・17-3 で載る適用ボタン)が消え、枠(タグと名前)だけ残る。
 * @param {ChatMessage} message
 */
export async function handleNegateMiracleCardClick(message) {
    const ns = negateState();
    if (!ns) return;
    const mf = message.getFlag(SCOPE, "miracle");
    if (!mf?.itemId) return;
    if (mf.negatedBy) { ui.notifications.warn("この神業は既に打ち消されています。"); return; }
    await commitNegate(ns.state);
    const patch = { [`flags.${SCOPE}.miracle.negatedBy`]: ns.by };
    if (message.getFlag(SCOPE, "usageEffects")) patch[`flags.${SCOPE}.usageEffects.negatedBy`] = ns.by;
    await TnxSocketHandler.applyMessagePatch(message, patch);
}

/**
 * 神業カードの描画フック(`renderChatMessageHTML`・フラグ miracle を持つカード)。
 * 打ち消された神業は中身(効果文・条件・残り回数・効果エリア)が消え、見出しだけ残る。
 * 見出しは打ち消し待ちの発動点(モード外のクリックは無視)。
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderMiracleCard(message, html) {
    const mf = message.getFlag(SCOPE, "miracle");
    if (!mf?.itemId) return;
    const card = html.querySelector(".tnx-miracle-card");
    if (!card) return;
    if (mf.negatedBy) {
        card.querySelector(".cr-req-body")?.remove();
        html.querySelector(".tnx-usage-effect-area")?.remove();
        card.classList.add("tnx-miracle-card--negated");
        return;
    }
    const head = card.querySelector(".cr-req-header");
    if (head && !head.classList.contains("tnx-recheck-target")) {
        head.classList.add("tnx-recheck-target");
        head.addEventListener("click", () => handleNegateMiracleCardClick(message));
    }
}

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
