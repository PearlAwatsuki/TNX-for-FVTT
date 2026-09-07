/**
 * @fileoverview 報酬点の配布カード(フェーズ12・2026-07-20)。
 *
 * ルール上の「前金」(RL から依頼の対価として付与される)の実装 → Bounty_Points.md「RL による配布」。
 * 判定要求と同じアクター登録方式で、カードの対象行のボタンを**そのアクターの所有者**(または RL)が
 * クリックして受け取る。所有者が自分のアクターを更新するため**権限委譲を必要としない**。
 * カードのフラグ更新だけは非作者なら GM へ委譲する(applyMessagePatch)。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { TnxSocketHandler } from "../core/tnx-socket-handler.mjs";
import { nextBountyValue, markBountyReceived, isBountyReceived } from "../rules/bounty-grant.mjs";


/** 同期解決(チャット描画は同期のため fromUuidSync を使う)。 */
function resolveSync(uuid) {
    try { return uuid ? fromUuidSync(uuid) : null; } catch { return null; }
}

/**
 * 配布カードのライブ描画。対象行に「受け取る」ボタン(所有者/RL のみ)または受け取り済みを出す。
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery} html
 */
export function renderBountyGrantCard(message, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const f = message.getFlag(SYSTEM_ID, "bountyGrant");
    if (!root || !f) return;

    for (const row of root.querySelectorAll(".tnx-card__target")) {
        const uuid = row.dataset.uuid;
        const status = row.querySelector(".tnx-card__target-status");
        if (!status) continue;
        status.innerHTML = "";

        if (isBountyReceived(f, uuid)) {
            // 結果表示は判定要求の対象行と同じ意匠(tnx-card__target-result + cr-inline-success)
            const done = document.createElement("div");
            done.className = "tnx-card__target-result";
            done.innerHTML = `<span class="cr-inline-success"><i class="fas fa-check"></i> ${f.amount < 0 ? "支払い済み" : "受け取り済み"}</span>`;
            status.appendChild(done);
            continue;
        }

        const actor = resolveSync(uuid);
        if (!(game.user.isGM || actor?.isOwner === true)) continue;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.innerHTML = `<i class="fas fa-coins"></i> ${f.amount < 0 ? "支払う" : "受け取る"}`;
        btn.addEventListener("click", () => receiveBounty(message, uuid));
        status.appendChild(btn);
    }
}

/**
 * 報酬点を受け取る(=`system.bounty` に加算。`bountyBase` は変えない)。
 * 二重受け取りはフラグで防ぐ。
 * @param {ChatMessage} message
 * @param {string} uuid 対象アクターの uuid
 */
export async function receiveBounty(message, uuid) {
    const f = message.getFlag(SYSTEM_ID, "bountyGrant");
    if (!f || isBountyReceived(f, uuid)) return;

    const actor = await fromUuid(uuid);
    if (!actor) return void ui.notifications.warn("対象のキャストが見つかりません。");
    if (!(game.user.isGM || actor.isOwner)) return void ui.notifications.warn("このキャストを操作する権限がありません。");

    const next = nextBountyValue({
        bountyBase: actor.system?.bountyBase ?? 0,
        bounty:     actor.system?.bounty ?? 0,
        amount:     f.amount,
    });
    await actor.update({ "system.bounty": next });

    const patched = markBountyReceived(f, uuid);
    await TnxSocketHandler.applyMessagePatch(message, { received: patched.received }, "bountyGrant");
}
