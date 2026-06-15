/**
 * @fileoverview TnxSocketHandler - システムソケットメッセージの集約ハンドラ
 *
 * tnx.mjs の ready フックで登録される socket.on コールバックを
 * メッセージ種別ごとに振り分ける。
 *
 * メッセージ種別:
 *   presentAccessCard  - アクセスカード提示（既存）
 *   judgmentResult     - PL → GM: 判定結果を送信し ChatMessage を更新する
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
            case "judgmentResult":
                TnxSocketHandler._onJudgmentResult(data);
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

    // ─── judgmentResult ───────────────────────────────────────────────────────

    /**
     * PL が判定を完了したときに socket 経由で GM へ送信される。
     * GM クライアントのみ ChatMessage を更新する。
     *
     * ペイロード:
     *   messageId  {string}  対象の ChatMessage ID
     *   actorId    {string}  判定を行ったキャスト Actor ID
     *   result     {object}  TnxJudgmentEngine が返す判定結果オブジェクト
     */
    static async _onJudgmentResult(data) {
        if (!game.user.isGM) return;

        const { messageId, actorId, result } = data;
        const message = game.messages.get(messageId);
        if (!message) return;

        const flags = message.getFlag("tokyo-nova-axleration", "judgmentRequest") ?? {};
        const results = foundry.utils.deepClone(flags.results ?? {});
        results[actorId] = result;

        const allDone = (flags.targets ?? []).every(t => results[t.actorId] !== undefined);

        await message.update({
            "flags.tokyo-nova-axleration.judgmentRequest.results": results,
            "flags.tokyo-nova-axleration.judgmentRequest.status":
                allDone ? "completed" : "partial",
        });
    }

    /**
     * 判定結果を GM へ送信するヘルパー（PL 側から呼ぶ）。
     *
     * @param {string} messageId  対象 ChatMessage ID
     * @param {string} actorId    判定を行ったキャスト Actor ID
     * @param {object} result     TnxJudgmentEngine が返す判定結果オブジェクト
     */
    static emitJudgmentResult(messageId, actorId, result) {
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "judgmentResult",
            messageId,
            actorId,
            result,
        });
    }
}
