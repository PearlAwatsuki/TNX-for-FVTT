/**
 * @fileoverview TnxSocketHandler - システムソケットメッセージの集約ハンドラ
 *
 * tnx.mjs の ready フックで登録される socket.on コールバックを
 * メッセージ種別ごとに振り分ける。
 *
 * メッセージ種別:
 *   presentAccessCard - アクセスカード提示（既存）
 *   checkResult    - PL → GM: 判定結果を送信し要求カード(checkRequest)を更新する
 *   treatmentApply - PL → GM: 治療/回復の状態除去を委譲する（対象の所有権がない場合）
 *   messagePatch   - PL → GM: ChatMessage の自スコープフラグ/本文の更新を委譲する
 *                    （メッセージ非作者は他者のカードを直接更新できないため。攻撃カード・
 *                    ダメージカード・リアクションカード・事後修正・効果適用済み等、フラグ
 *                    更新の委譲はすべてこの1種別に一本化＝2026-07-16。旧 attackUpdate/
 *                    damageUpdate/usageEffectApplied/checkModify を統合）
 *   cutAdvance     - PL → GM: カット進行の「手番終了」を委譲する（フェーズ13-4。
 *                    メインターンの手番プレイヤーは Combat ドキュメントのフラグを更新
 *                    できないため、GM クライアントが advanceCut を代行する）
 */

const SCOPE = "tokyo-nova-axleration";

export class TnxSocketHandler {
    /**
     * ソケットメッセージを受信して種別ごとに処理する。
     * tnx.mjs の ready フック内で
     *   game.socket.on("system.tokyo-nova-axleration", TnxSocketHandler.onMessage)
     * として登録する。
     *
     * @param {object} data  送信側が渡したペイロード
     */
    static onMessage(data) {
        switch (data?.type) {
            case "presentAccessCard":
                TnxSocketHandler._onPresentAccessCard(data);
                break;
            case "checkResult":
                TnxSocketHandler._onCheckResult(data);
                break;
            case "treatmentApply":
                TnxSocketHandler._onTreatmentApply(data);
                break;
            case "repairApply":
                TnxSocketHandler._onRepairApply(data);
                break;
            case "messagePatch":
                TnxSocketHandler._onMessagePatch(data);
                break;
            case "cutAdvance":
                TnxSocketHandler._onCutAdvance(data);
                break;
            case "interruptGrant":
                TnxSocketHandler._onInterruptGrant(data);
                break;
            case "interruptStart":
                TnxSocketHandler._onInterruptStart(data);
                break;
            case "interruptEnd":
                TnxSocketHandler._onInterruptEnd(data);
                break;
        }
    }

    // ─── presentAccessCard ────────────────────────────────────────────────────

    static _onPresentAccessCard(data) {
        new foundry.applications.apps.ImagePopout({
            src:    data.src,
            window: { title: data.title },
        }).render(true);
    }

    // ─── checkResult ───────────────────────────────────────────────────────

    /**
     * PL が判定を完了したときに socket 経由で GM へ送信される。
     * GM クライアントのみ ChatMessage を更新する。
     *
     * ペイロード:
     *   messageId  {string}  対象の ChatMessage ID
     *   actorId    {string}  判定を行ったキャスト Actor ID
     *   result     {object}  TnxCheckEngine が返す判定結果オブジェクト
     */
    static async _onCheckResult(data) {
        if (!game.user.isGM) return;

        const { messageId, actorId, result } = data;
        const message = game.messages.get(messageId);
        if (!message) return;

        const flags = message.getFlag("tokyo-nova-axleration", "checkRequest") ?? {};
        const results = foundry.utils.deepClone(flags.results ?? {});
        results[actorId] = result;

        const allDone = (flags.targets ?? []).every(t => results[t.actorId] !== undefined);

        await message.update({
            "flags.tokyo-nova-axleration.checkRequest.results": results,
            "flags.tokyo-nova-axleration.checkRequest.status":
                allDone ? "completed" : "partial",
        });
    }

    /**
     * 判定結果を GM へ送信するヘルパー（PL 側から呼ぶ）。
     * GM 自身が判定した場合、socket.emit は自クライアントに届かないため直接処理する
     * (未処理だと要求カードにボタンが残り再判定できてしまう=2026-07-08 修正)。
     *
     * @param {string} messageId  対象 ChatMessage ID
     * @param {string} actorId    判定を行ったキャスト Actor ID
     * @param {object} result     TnxCheckEngine が返す判定結果オブジェクト
     */
    static emitCheckResult(messageId, actorId, result) {
        if (game.user.isGM) {
            TnxSocketHandler._onCheckResult({ messageId, actorId, result });
            return;
        }
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "checkResult",
            messageId,
            actorId,
            result,
        });
    }

    // ─── treatmentApply（フェーズ12・治療） ───────────────────────────────────

    /** 治療成功による状態除去を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onTreatmentApply(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const { applyTreatmentDelegated } = await import("./treatment-flow.mjs");
        await applyTreatmentDelegated(data);
    }

    /** 治療の状態除去を GM へ委譲する（患者の所有権がない治療者クライアントから呼ぶ）。 */
    static emitTreatmentApply(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "treatmentApply",
            ...payload,
        });
    }

    // ─── repairApply（フェーズ12・修理・2026-07-18） ──────────────────────────────

    /** 修理成功による故障解除を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onRepairApply(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const { applyRepairDelegated } = await import("./repair-flow.mjs");
        await applyRepairDelegated(data);
    }

    /** 故障解除を GM へ委譲する（対象の所有権がない修理者クライアントから呼ぶ）。 */
    static emitRepairApply(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "repairApply",
            ...payload,
        });
    }

    // ─── cutAdvance（カット進行の手番終了委譲・フェーズ13-4） ─────────────────────

    /**
     * プレイヤーの「次へ」(スポット送り)/「手番終了」を GM クライアントが代行する
     * (複数 GM 接続時は activeGM のみ)。要求者が「今の番」の combatant——メインターン中は
     * 手番キャラ・サブターン中はスポットのキャラ——の所有者であることを検証してから前進する。
     */
    static async _onCutAdvance(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const combat = game.combats.get(data?.combatId);
        if (!combat) return;
        const currentId = combat.cutPhase === "main" ? combat.mainCombatantId : combat.spotCombatantId;
        const current = combat.combatants.get(currentId);
        const requester = game.users.get(data?.userId);
        if (!requester || !current?.actor?.testUserPermission(requester, "OWNER")) return;
        await combat.advanceCut();
    }

    /** 「次へ」/手番終了を GM へ委譲する（スポット/手番プレイヤーのクライアントから呼ぶ）。 */
    static emitCutAdvance(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "cutAdvance",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── 割り込み(挿入メイン)の委譲・フェーズ13-5 ─────────────────────────────────
    // combatant/combat のフラグ更新は GM 権限が要るため、非 GM は GM(activeGM)へ委譲する。

    /** 割り込み許可の付与を GM が代行する。要求者が付与元アクターの所有者であることを検証する。 */
    static async _onInterruptGrant(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const requester = game.users.get(data?.userId);
        const source = data?.sourceUuid ? await fromUuid(data.sourceUuid).catch(() => null) : null;
        const sourceActor = source?.actor ?? source;
        if (!requester || !sourceActor?.testUserPermission(requester, "OWNER")) return;
        const { grantInterruptToTargets } = await import("./interrupt-grant.mjs");
        await grantInterruptToTargets(data?.targetUuids ?? []);
    }

    /** 割り込み許可の付与を GM へ委譲する（付与元アクターの操作者クライアントから呼ぶ）。 */
    static emitInterruptGrant(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "interruptGrant",
            userId: game.user.id,
            ...payload,
        });
    }

    /** 割り込み(挿入メイン)開始を GM が代行する。要求者が割り込む combatant の所有者であることを検証。 */
    static async _onInterruptStart(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const combat = game.combats.get(data?.combatId);
        const target = combat?.combatants.get(data?.combatantId);
        const requester = game.users.get(data?.userId);
        if (!requester || !target?.actor?.testUserPermission(requester, "OWNER")) return;
        await combat.startInterrupt(data.combatantId);
    }

    /** 割り込み開始を GM へ委譲する（割り込む対象の操作者クライアントから呼ぶ）。 */
    static emitInterruptStart(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "interruptStart",
            userId: game.user.id,
            ...payload,
        });
    }

    /** 挿入メイン終了を GM が代行する。要求者が現在の挿入メインの行動者の所有者であることを検証。 */
    static async _onInterruptEnd(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const combat = game.combats.get(data?.combatId);
        const current = combat?.combatants.get(combat?.interruptMainId);
        const requester = game.users.get(data?.userId);
        if (!requester || !current?.actor?.testUserPermission(requester, "OWNER")) return;
        await combat.endInterrupt({ decrementAr: data?.decrementAr === true });
    }

    /** 挿入メイン終了を GM へ委譲する（挿入メインの操作者クライアントから呼ぶ）。 */
    static emitInterruptEnd(payload) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "interruptEnd",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── messagePatch（メッセージ更新の汎用委譲・2026-07-16 一本化） ──────────────

    /** メッセージ更新を GM クライアントが代行する(自スコープの flags と content=カード本文、
     *  および whisper=リアクションカードの公開切替(シークレット解除・2026-07-18)のみ受理。
     *  再判定の置き換え着地は本文の差し替えを含む=2026-07-14)。 */
    static async _onMessagePatch(data) {
        if (!game.user.isGM) return;
        const message = game.messages.get(data?.messageId);
        if (!message || !data?.patch) return;
        const updates = {};
        for (const [k, v] of Object.entries(data.patch)) {
            if (k !== "content" && k !== "whisper" && !k.startsWith(`flags.${SCOPE}.`)) continue; // 自スコープ外は無視
            updates[k] = v;
        }
        if (Object.keys(updates).length) await message.update(updates);
    }

    /**
     * ChatMessage の自スコープフラグ/本文を更新する**唯一の経路**(2026-07-16 一本化)。
     * GM か作者は直接 update・それ以外は GM クライアントへソケット委譲する。従来は攻撃カード・
     * ダメージカード・リアクションカード・事後修正・効果適用済み・BSドロー結果がそれぞれ
     * 「isGM/isAuthor で update / emit」を複製していた。
     * @param {ChatMessage} message 更新するメッセージ
     * @param {object} patch 更新パス(生パス。flags.<scope>.* か content のみ)
     * @param {string|null} [flagPrefix] 省略形: patch のキーを flags.<scope>.<flagPrefix>.<キー> に展開する
     */
    static async applyMessagePatch(message, patch, flagPrefix = null) {
        const data = {};
        for (const [k, v] of Object.entries(patch)) {
            data[flagPrefix ? `flags.${SCOPE}.${flagPrefix}.${k}` : k] = v;
        }
        if (game.user.isGM || message.isAuthor) {
            await message.update(data);
        } else {
            game.socket.emit("system.tokyo-nova-axleration", {
                type: "messagePatch",
                messageId: message.id,
                patch: data,
            });
        }
    }
}
