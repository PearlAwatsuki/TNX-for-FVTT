/**
 * @fileoverview FS 進行判定の結果 → 進行値加算(フェーズ13-7・サブステップ①)。
 *
 * 進行判定は既存の判定要求(checkRequest・`extra.focusSystemKind==="progress"`)に乗って発行される。
 * その結果カードで**成功**した対象行に、RL 用の「進行値に加算」ボタンを描画する(ダメージ適用と
 * 同じ手動ボタン方式＝2026-07-23 ユーザー確定)。押すと獲得進行値を算出して FS の進行値へ反映する。
 *
 * 獲得進行値 ＝ `floor(差分値 ÷ 10 ＋ 進行修正) ＋ 支援ボーナス`(ルール3＋5)。
 * - 差分値は結果の `diff`(成功時のみ)。
 * - 進行修正は有効行の `progressMod` を判定者アクターに対して解決(固定/式・actor 値・outfit)。
 * - 支援ボーナス(②)は本サブステップでは 0(②で pendingSupport を接続する)。
 *
 * 進行状態の更新(world 設定)は GM 権限が要るため、ボタンは RL(=GM)にのみ出す。
 */

import { getActiveFocusSystem, updateFocusSystem } from "./focus-system-state.mjs";
import { activeProgressRow, clampGauge, computeProgressGain } from "./focus-system-logic.mjs";
import { resolveProgressModForActor } from "./progress-mod.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 進行判定要求カードの成功対象行に「進行値に加算」ボタン(または反映済み表示)を描画する。
 * `renderChatMessageHTML` フックから、`extra.focusSystemKind==="progress"` のカードに対して呼ぶ。
 */
export function renderFocusProgressButton(message, html) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.extra?.focusSystemKind !== "progress") return;
    if (!game.user.isGM) return; // 進行値の反映は RL(=GM)

    const applied = message.getFlag(SCOPE, "focusProgressApplied") ?? {};
    for (const row of html.querySelectorAll(".cr-req-target-row")) {
        const actorId = row.dataset.actorId;
        const result = flag.results?.[actorId];
        const statusEl = row.querySelector(".cr-req-target-status");
        if (!statusEl || !result?.success) continue; // 成功のみ(失敗/ファンブルは進行なし)

        if (applied[actorId] !== undefined) {
            const note = document.createElement("span");
            note.className = "cr-req-note tnx-fs-applied";
            note.innerHTML = `<i class="fas fa-check"></i> 進行 +${applied[actorId]} 反映済み`;
            statusEl.appendChild(note);
            continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn tnx-fs-progress-btn";
        btn.innerHTML = '<i class="fas fa-diamond"></i> 進行値に加算';
        btn.addEventListener("click", () => applyFocusProgress(message, actorId));
        statusEl.appendChild(btn);
    }
}

/**
 * 進行判定の結果を FS の進行値へ反映する(RL=GM が押す)。獲得進行値を算出して加算し、カードに
 * 反映済みを記録して再適用を防ぐ。
 * @param {ChatMessage} message 進行判定要求カード
 * @param {string} actorId 判定したキャストの Actor id
 */
export async function applyFocusProgress(message, actorId) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    const result = flag?.results?.[actorId];
    if (!result?.success) return;

    const fs = getActiveFocusSystem(flag.extra?.focusSystemId);
    if (!fs) { ui.notifications.warn("対象の FS判定が見つかりません。"); return; }

    const row = activeProgressRow(fs.rows, fs.progress);
    const actor = game.actors.get(actorId) ?? null;
    const mod = await resolveProgressModForActor(actor, row?.progressMod);
    // 支援ボーナス(②): 「次に進行判定を行うキャスト」が受け取るため FS 全体の pendingSupport を
    // この進行判定で使い切る(2026-07-24 ユーザー確定＝対象別でなく次の進行者が受け取る)
    const support = Number(fs.pendingSupport) || 0;
    const gain = computeProgressGain(result.diff, mod, support);

    await updateFocusSystem(fs.id, { progress: clampGauge(fs.progress + gain, fs.targetProgress), pendingSupport: 0 });
    const appliedFlag = { ...(message.getFlag(SCOPE, "focusProgressApplied") ?? {}), [actorId]: gain };
    await message.update({ [`flags.${SCOPE}.focusProgressApplied`]: appliedFlag });
}

// ─── サブステップ②: 支援判定の AR 消費 ＋ pendingSupport 加算(結果確定で**自動適用**) ──────
// 進行値加算(①)は RL の判断で手動ボタン(ダメージ同様)だが、支援判定の AR 消費・成立は判定結果が
// 出た時点で確定する機械的な帰結なので**自動適用**する(2026-07-24 ユーザー確定＝ダメージとは性格が違う)。

/**
 * 支援判定の結果を自動適用する(結果記録時＝GM 側で1回)。支援者の AR を−1(成功/失敗問わず＝
 * メジャーアクション・確定C)、**成功なら** FS 全体の `pendingSupport` を +1(「次に進行判定を行う
 * キャスト」が受け取る)。二重適用を防ぐため focusSupportApplied で冪等にする。
 * @param {ChatMessage} message 支援判定要求カード
 * @param {string} actorId 支援を行ったキャストの Actor id
 */
export async function autoApplyFocusSupport(message, actorId) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.extra?.focusSystemKind !== "support") return;
    const result = flag.results?.[actorId];
    if (!result) return;
    const applied = message.getFlag(SCOPE, "focusSupportApplied") ?? {};
    if (applied[actorId] !== undefined) return; // 一度だけ(再判定等の二重 AR 消費を防ぐ)

    const fs = getActiveFocusSystem(flag.extra?.focusSystemId);
    if (!fs) return;
    // AR−1(メジャーアクション＝成功/失敗問わず消費)
    const actor = game.actors.get(actorId) ?? null;
    if (actor?.system?.actionRank) {
        await actor.update({ "system.actionRank.value": Math.max(0, (actor.system.actionRank.value ?? 0) - 1) });
    }
    // 成功なら次の進行判定への +1 を FS 全体に貯める
    const succeeded = result.success === true;
    if (succeeded) {
        await updateFocusSystem(fs.id, { pendingSupport: (Number(fs.pendingSupport) || 0) + 1 });
    }
    await message.update({ [`flags.${SCOPE}.focusSupportApplied`]: { ...applied, [actorId]: succeeded } });
}

/**
 * 支援判定要求カードに、自動適用済みの表示(AR−1／支援成立)を各支援者行に描画する(全員に表示)。
 * 適用そのものは autoApplyFocusSupport が結果確定時に済ませており、ここは表示のみ。
 */
export function renderFocusSupportNote(message, html) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.extra?.focusSystemKind !== "support") return;
    const applied = message.getFlag(SCOPE, "focusSupportApplied") ?? {};
    for (const row of html.querySelectorAll(".cr-req-target-row")) {
        const actorId = row.dataset.actorId;
        if (applied[actorId] === undefined) continue;
        const statusEl = row.querySelector(".cr-req-target-status");
        if (!statusEl) continue;
        const note = document.createElement("span");
        note.className = "cr-req-note tnx-fs-applied";
        note.innerHTML = applied[actorId]
            ? '<i class="fas fa-hands-helping"></i> 支援成立（AR−1）'
            : '<i class="fas fa-hands-helping"></i> AR−1';
        statusEl.appendChild(note);
    }
}
