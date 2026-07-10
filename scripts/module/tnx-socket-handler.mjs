/**
 * @fileoverview TnxSocketHandler - システムソケットメッセージの集約ハンドラ
 *
 * tnx.mjs の ready フックで登録される socket.on コールバックを
 * メッセージ種別ごとに振り分ける。
 *
 * メッセージ種別:
 *   presentAccessCard  - アクセスカード提示（既存）
 *   checkResult     - PL → GM: 判定結果を送信し ChatMessage を更新する
 *   attackUpdate    - PL → GM: 攻撃カード(attackCheck)のフラグ更新を委譲する（12-2。
 *                     対象側プレイヤーは攻撃者のメッセージを直接更新できないため）
 *   damageUpdate    - PL → GM: ダメージ・カード(damageRoll)のフラグ更新を委譲する（12-3。
 *                     防御側が適用結果を書き込む際、攻撃者のメッセージを直接更新できないため。
 *                     ダメージの効果付与自体は対象の所有者クライアントで行うため委譲不要）
 */

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
            case "attackUpdate":
                TnxSocketHandler._onAttackUpdate(data);
                break;
            case "damageUpdate":
                TnxSocketHandler._onDamageUpdate(data);
                break;
            case "treatmentApply":
                TnxSocketHandler._onTreatmentApply(data);
                break;
            case "usageEffectApplied":
                TnxSocketHandler._onUsageEffectApplied(data);
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

    // ─── attackUpdate（フェーズ12-2） ─────────────────────────────────────────

    /** 攻撃カードのフラグ更新を GM クライアントが代行する。 */
    static async _onAttackUpdate(data) {
        if (!game.user.isGM) return;
        const message = game.messages.get(data?.messageId);
        if (!message || !data?.patch) return;
        const updates = {};
        for (const [k, v] of Object.entries(data.patch)) {
            updates[`flags.tokyo-nova-axleration.attackCheck.${k}`] = v;
        }
        await message.update(updates);
    }

    /** 攻撃カードのフラグ更新を GM へ委譲する（対象側 PL から呼ぶ）。 */
    static emitAttackUpdate(messageId, patch) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "attackUpdate",
            messageId,
            patch,
        });
    }

    // ─── damageUpdate（フェーズ12-3） ─────────────────────────────────────────

    /** ダメージ・カードのフラグ更新を GM クライアントが代行する。 */
    static async _onDamageUpdate(data) {
        if (!game.user.isGM) return;
        const message = game.messages.get(data?.messageId);
        if (!message || !data?.patch) return;
        const updates = {};
        for (const [k, v] of Object.entries(data.patch)) {
            updates[`flags.tokyo-nova-axleration.damageRoll.${k}`] = v;
        }
        await message.update(updates);
    }

    /** ダメージ・カードのフラグ更新を GM へ委譲する（防御側 PL から呼ぶ）。 */
    static emitDamageUpdate(messageId, patch) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "damageUpdate",
            messageId,
            patch,
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

    // ─── usageEffectApplied（フェーズ12・用途の効果付与） ─────────────────────────

    /** 用途効果カードの「適用済み」フラグ更新を GM クライアントが代行する。 */
    static async _onUsageEffectApplied(data) {
        if (!game.user.isGM) return;
        const message = game.messages.get(data?.messageId);
        if (!message) return;
        await message.update({ "flags.tokyo-nova-axleration.usageEffects.applied": true });
    }

    /** 用途効果カードの適用済みフラグ更新を GM へ委譲する（メッセージ非作者の対象所有者から呼ぶ）。 */
    static emitUsageEffectApplied(messageId) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "usageEffectApplied",
            messageId,
        });
    }
}
