/**
 * @fileoverview FS 進行判定の結果 → 進行値加算(フェーズ13-7・サブステップ①)。
 *
 * 進行判定は既存の判定要求(checkRequest)に乗って発行される。FS の文脈(focusSystemId/Kind)は
 * postCheckRequest の `extra` が checkRequest **トップレベルへスプレッド展開**されるため、読み取りは
 * `checkRequest.focusSystemKind`(=`"progress"`)で行う(`.extra.` 経由ではない=2026-07-26 是正)。
 * その結果カードで**成功**した対象行に、RL 用の「進行値に加算」ボタンを描画する(ダメージ適用と
 * 同じ手動ボタン方式＝2026-07-23 ユーザー確定)。押すと獲得進行値を算出して FS の進行値へ反映する。
 *
 * 獲得進行値 ＝ `floor(差分値 ÷ 10 ＋ 進行修正) ＋ 支援ボーナス`(ルール3＋5)。
 * - 差分値は結果の `diff`(成功時のみ)。
 * - 進行修正は有効行の `progressMod` を判定者アクターに対して解決(固定/式・actor 値・outfit)。
 * - 支援ボーナス(②)は**対象キャラに乗る ActiveEffect**(2026-08-05 ユーザー確定)。支援成功で対象へ
 *   支援 AE(進行 +1・持続=カット中)を付与し、進行判定時に判定者本人の支援 AE を合算して消費
 *   (=AE を除去)する。専用の pendingSupport カウンタは廃止(基本機能=AE で表現)。**カット終了での
 *   自動失効は 15-3 で接続済み**(time-boundary が TNX の持続を見て畳む)。使われなかった支援は
 *   カット終了で消え、使われた分は進行判定での消費が先に除去する。
 *
 * 進行状態の更新(world 設定)は GM 権限が要るため、ボタンは RL(=GM)にのみ出す。
 */

import { getActiveFocusSystem, updateFocusSystem } from "./focus-system-state.mjs";
import { activeProgressRow, clampGauge, computeProgressGain } from "./focus-system-logic.mjs";
import { resolveProgressModForActor } from "./progress-mod.mjs";
import { TnxCombat } from "../combat/tnx-combat.mjs";

const SCOPE = "tokyo-nova-axleration";

// 支援 AE が加算する実フィールド(2026-08-05)。中身のある本物の change:
// system.focus.progressBonus += 1。ネイティブ適用で対象アクターの progressBonus に乗る(素値0)。
// 進行判定時にこの実効値を読み、加算した後、この change を持つ AE を除去して消費する。
// 対象キャラに乗る＝FS 非スコープ(対象が次に行う進行判定＝どの FS でも受け取る・ユーザー確定)。
const FOCUS_SUPPORT_KEY = "system.focus.progressBonus";

/** アクターに乗っている支援ボーナス AE(有効・支援 change を持つもの)を集める。 */
function supportBonusEffects(actor) {
    return [...(actor?.effects ?? [])].filter(e =>
        !e.disabled && (e.changes ?? []).some(c => c.key === FOCUS_SUPPORT_KEY));
}

/**
 * 進行判定要求カードの成功対象行に「進行値に加算」ボタン(または反映済み表示)を描画する。
 * `renderChatMessageHTML` フックから、`checkRequest.focusSystemKind==="progress"` のカードに対して呼ぶ。
 */
export function renderFocusProgressButton(message, html) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.focusSystemKind !== "progress") return;
    if (!game.user.isGM) return; // 進行値の反映は RL(=GM)

    const applied = message.getFlag(SCOPE, "focusProgressApplied") ?? {};
    for (const row of html.querySelectorAll(".cr-req-target-row")) {
        const actorId = row.dataset.actorId;
        const result = flag.results?.[actorId];
        if (!result?.success) continue; // 成功のみ(失敗/ファンブルは進行なし)

        // ボタン/表示は行の**新しい行(全幅)**に置く。status セル(右寄せ・flex:1)へ詰めると
        // 達成値表示と重なってレイアウトが崩れるため(2026-07-26 実機指摘)。
        if (applied[actorId] !== undefined) {
            const note = document.createElement("div");
            note.className = "tnx-fs-row-action cr-req-note tnx-fs-applied";
            note.innerHTML = `<i class="fas fa-check"></i> 進行 +${applied[actorId]} 反映済み`;
            row.appendChild(note);
            continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-fs-row-action tnx-chat-btn tnx-fs-progress-btn";
        btn.innerHTML = '<i class="fas fa-diamond"></i> 進行値に加算';
        btn.addEventListener("click", () => applyFocusProgress(message, actorId));
        row.appendChild(btn);
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

    const fs = getActiveFocusSystem(flag?.focusSystemId);
    if (!fs) { ui.notifications.warn("対象の FS判定が見つかりません。"); return; }

    const row = activeProgressRow(fs.rows, fs.progress);
    const actor = game.actors.get(actorId) ?? null;
    const mod = await resolveProgressModForActor(actor, row?.progressMod);
    // 支援ボーナス(AE・2026-08-05): 進行判定を行うキャスト**本人**に乗った支援 AE の実効値
    // (system.focus.progressBonus＝ネイティブ適用で加算済み)を受け取り、この進行判定で消費(AE 除去)する。
    // 対象キャラに乗る AE なので FS 非スコープ(次に行う進行判定で受け取る)。
    const bonusEffects = supportBonusEffects(actor);
    const support = Math.max(0, Number(actor?.system?.focus?.progressBonus) || 0);
    const gain = computeProgressGain(result.diff, mod, support);

    await updateFocusSystem(fs.id, { progress: clampGauge(fs.progress + gain, fs.targetProgress) });
    // 支援 AE を消費(除去)する。成否・クランプに関わらず「進行判定を行った」時点で使い切る
    if (bonusEffects.length && actor) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", bonusEffects.map(e => e.id));
    }
    const appliedFlag = { ...(message.getFlag(SCOPE, "focusProgressApplied") ?? {}), [actorId]: gain };
    await message.update({ [`flags.${SCOPE}.focusProgressApplied`]: appliedFlag });
}

// ─── サブステップ②: 支援判定の記帳(メジャー記帳 ＋ 対象へ支援 AE 付与・結果確定で**自動適用**) ──
// 進行値加算(①)は RL の判断で手動ボタン(ダメージ同様)だが、支援判定の成立は判定結果が出た時点で確定
// する機械的な帰結なので**自動適用**する(2026-07-24 ユーザー確定)。AR は FS 側で直接引かず、戦闘の
// 一般則に載せる(2026-07-26 全面改訂): 支援判定はイニシアチブプロセス(無所有)で行うメジャーなので、
// メジャー記帳(markMajorAction)だけ行い、AR−1＋CSカレント0 はそのプロセス終了時に一般則が適用する。
// 支援ボーナスは対象キャラに乗る ActiveEffect で表す(2026-08-05・基本機能=AE で表現)。

/**
 * 支援判定の結果を自動適用する(結果記録時＝GM 側で1回)。支援者をメジャー記帳(markMajorAction=成功
 * /失敗問わず・支援はメジャーアクション。AR−1＋CS0 はイニシアチブ終了時に一般則で自動適用)し、
 * **成功なら**支援者がターゲットした対象へ**支援 AE(進行 +1)**を付与する(その対象が次に行う進行判定で
 * 合算・消費)。二重適用を防ぐため focusSupportApplied で冪等にする。
 * @param {ChatMessage} message 支援判定要求カード
 * @param {string} actorId 支援を行ったキャストの Actor id
 */
export async function autoApplyFocusSupport(message, actorId) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.focusSystemKind !== "support") return;
    const result = flag.results?.[actorId];
    if (!result) return;
    const applied = message.getFlag(SCOPE, "focusSupportApplied") ?? {};
    if (applied[actorId] !== undefined) return; // 一度だけ(再判定等の二重記帳を防ぐ)

    const fs = getActiveFocusSystem(flag?.focusSystemId);
    if (!fs) return;
    // メジャー記帳(成功/失敗問わず): 支援=メジャーアクション。AR−1＋CS0 はイニシアチブ終了時に一般則で
    const actor = game.actors.get(actorId) ?? null;
    if (actor) await TnxCombat.markMajorAction(actor);
    // 成功なら、支援者がターゲットした対象へ支援 AE(進行 +1)を付与する(2026-08-05)
    const succeeded = result.success === true;
    const targetId = result.focusSupportTargetId ?? null;
    const target = targetId ? game.actors.get(targetId) : null;
    if (succeeded && target) {
        await target.createEmbeddedDocuments("ActiveEffect", [{
            name: "支援（進行 +1）",
            img:  "icons/svg/regen.svg",
            // 中身のある本物の change: 次に行う進行判定の獲得進行値 +1(実フィールドをネイティブ適用で加算)
            changes: [{ key: FOCUS_SUPPORT_KEY, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20 }],
            // カット終了で自動失効する(15-3。ネイティブの duration は本システムでは動かないため
            // TNX の持続で指定する。進行判定での消費=AE 除去も従来どおり効く)
            flags: { [SCOPE]: { tnxDuration: "cut" } },
        }]);
    }
    await message.update({ [`flags.${SCOPE}.focusSupportApplied`]: { ...applied, [actorId]: { success: succeeded, targetId, targetName: target?.name ?? null } } });
}

/**
 * 支援判定要求カードに、自動適用済みの表示(支援成立→対象の進行+1／支援失敗)を各支援者行に描画する。
 * 適用そのものは autoApplyFocusSupport が結果確定時に済ませており、ここは表示のみ。AR の消費は
 * イニシアチブ終了時に一般則で行われる(トラッカーの AR 表示に出る)ため、この行には出さない。
 */
export function renderFocusSupportNote(message, html) {
    const flag = message.getFlag(SCOPE, "checkRequest");
    if (flag?.focusSystemKind !== "support") return;
    const applied = message.getFlag(SCOPE, "focusSupportApplied") ?? {};
    for (const row of html.querySelectorAll(".cr-req-target-row")) {
        const actorId = row.dataset.actorId;
        const rec = applied[actorId];
        if (rec === undefined) continue;
        // 適用済み表示も行の新しい行(全幅)に置く(status セルへ詰めない・2026-07-26)
        const note = document.createElement("div");
        note.className = "tnx-fs-row-action cr-req-note tnx-fs-applied";
        if (rec.success) {
            const esc = foundry.utils.escapeHTML;
            const tgt = rec.targetName ? `「${esc(rec.targetName)}」` : "対象";
            note.innerHTML = `<i class="fas fa-hands-helping"></i> 支援成立 → ${tgt}の進行 +1`;
        } else {
            note.innerHTML = '<i class="fas fa-hands-helping"></i> 支援失敗';
        }
        row.appendChild(note);
    }
}
