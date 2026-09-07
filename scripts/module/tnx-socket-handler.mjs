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
 *   markMajor      - PL → GM: メジャーアクション記帳(majorActed 追加)を委譲する（2026-07-26
 *                    一般則。プロセス終了時に本人へ AR−1＋CSカレント0）
 *   sessionSceneCard - PL → GM: 切り札のシーン消費化に伴う「現在のシーンカード」の記録を
 *                    委譲する（フェーズ14-2。実行状態=ワールド設定は GM しか書けない）
 *   sessionTeam    - PL → GM: チーム宣言（結成・参加・離脱）を委譲する
 *                    （フェーズ14-5。宣言はいつでも可＝プレイヤーも行うため）
 *   teamExit       - PL → GM: 手動退場（チームの退場連動込み）を委譲する（2026-08-23。
 *                    連動時はチームメイトのアクターを更新するため activeGM が代行）
 *   infoDisclose   - PL → GM: 情報収集判定の自動開示を委譲する（フェーズ14-9。開示の正本＝
 *                    アクトジャーナルのフラグは GM しか書けないため）
 *   passHandCard   - PL → GM: 手札から手札へのカード受け渡しを委譲する（手札は本人+GM のみ
 *                    OWNER のため、非所有者は相手の手札にカードを作成できない）
 *
 * **受理条件**(2026-09-07): ソケットは接続中の任意のクライアントが任意のペイロードを投げられる。
 * アクターを書き換える委譲は `_authorizeDelegation` を通してから実処理へ入る。委譲は
 * 「**対象**の所有権が無い」から起きるので対象側は検証条件にできない——検証するのは
 * **行為者側**(修理する人・治療する人・宣言した人)を要求者が操作できるか、である。
 */

import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";


export class TnxSocketHandler {
    /**
     * ソケットメッセージを受信して種別ごとに処理する。
     * tnx.mjs の ready フック内で
     *   game.socket.on(SOCKET_CHANNEL, TnxSocketHandler.onMessage)
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
            case "miracleSwap":
                TnxSocketHandler._onMiracleSwap(data);
                break;
            case "repairApply":
                TnxSocketHandler._onRepairApply(data);
                break;
            case "modificationApply":
                TnxSocketHandler._onModificationApply(data);
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
            case "markMajor":
                TnxSocketHandler._onMarkMajor(data);
                break;
            case "sessionSceneCard":
                TnxSocketHandler._onSessionSceneCard(data);
                break;
            case "sessionTeam":
                TnxSocketHandler._onSessionTeam(data);
                break;
            case "teamExit":
                TnxSocketHandler._onTeamExit(data);
                break;
            case "infoDisclose":
                TnxSocketHandler._onInfoDisclose(data);
                break;
            case "passHandCard":
                TnxSocketHandler._onPassHandCard(data);
                break;
        }
    }

    /**
     * アクターを書き換える委譲要求を受理してよいか。
     *
     * - 複数 GM 接続時は activeGM だけが代行する(二重適用を防ぐ)。
     * - 要求者が**行為者アクター**(`actorUuid`)の OWNER であることを確かめる。行為者を渡さない
     *   旧形式の要求は受理しない。
     *
     * @param {{userId?:string, actorUuid?:string}} data 委譲ペイロード
     * @returns {Promise<boolean>}
     */
    static async _authorizeDelegation(data) {
        if (game.users.activeGM?.id !== game.user.id) return false;
        const requester = game.users.get(data?.userId);
        if (!requester || !data?.actorUuid) return false;
        const doc = await fromUuid(data.actorUuid).catch(() => null);
        const actor = doc?.actor ?? doc;
        return actor?.testUserPermission?.(requester, "OWNER") === true;
    }

    // ─── passHandCard（手札から手札への受け渡しの委譲） ───────────────────────
    // 手札は本人+GM のみ OWNER のため、PL は他ユーザーの手札にカードを作成できない。
    // 参加者パネルへの D&D /「指定枚数を渡す」で相手の手札を所有していない場合、
    // activeGM がカード移動を代行する。移動元が要求者本人の手札であることを検証する。

    /** 手札間のカード移動を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onPassHandCard(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const { getUserFlagData } = await import("./user-flag-schema.mjs");
        const requester = game.users.get(data?.userId);
        if (!requester) return;
        if (getUserFlagData(requester).handPileId !== data?.sourceHandUuid) return;
        const sourceHand = await fromUuid(data.sourceHandUuid);
        const targetHand = await fromUuid(data?.targetHandUuid);
        if (!sourceHand || !targetHand) return;
        const cardIds = (data?.cardIds ?? []).filter(id => sourceHand.cards.get(id));
        if (!cardIds.length) return;
        await sourceHand.pass(targetHand, cardIds, { chatNotification: false });
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
    static async _onCheckResult(data, { viaSocket = true } = {}) {
        // 複数 GM 接続時、ソケット経由の受信は activeGM だけが処理する(二重更新・支援 AE の
        // 二重付与を防ぐ)。GM 自身の判定は emitCheckResult から**直接**呼ばれるため素通しする
        if (!game.user.isGM) return;
        if (viaSocket && game.users.activeGM?.id !== game.user.id) return;

        const { messageId, actorId, result } = data;
        const message = game.messages.get(messageId);
        if (!message) return;

        const flags = message.getFlag(SYSTEM_ID, "checkRequest") ?? {};
        const results = foundry.utils.deepClone(flags.results ?? {});
        results[actorId] = result;

        const allDone = (flags.targets ?? []).every(t => results[t.actorId] !== undefined);

        await message.update({
            [`flags.${SYSTEM_ID}.checkRequest.results`]: results,
            [`flags.${SYSTEM_ID}.checkRequest.status`]:
                allDone ? "completed" : "partial",
        });

        // FS 支援判定: 支援判定は結果確定で自動適用する(メジャー記帳＋成功なら対象へ支援 AE(進行 +1)を
        // 付与。AR−1＋CS0 はイニシアチブ終了時に一般則で適用・2026-07-26/08-05)。手動ボタンではなく機械的な
        // 帰結のため(2026-07-24 ユーザー確定)。他の checkRequest では no-op。
        if (flags.focusSystemKind === "support") {
            const { autoApplyFocusSupport } = await import("../focus-system/result.mjs");
            await autoApplyFocusSupport(message, actorId);
        }
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
            TnxSocketHandler._onCheckResult({ messageId, actorId, result }, { viaSocket: false });
            return;
        }
        game.socket.emit(SOCKET_CHANNEL, {
            type: "checkResult",
            messageId,
            actorId,
            result,
        });
    }

    // ─── treatmentApply（フェーズ12・治療） ───────────────────────────────────

    /** 治療成功による状態除去を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onTreatmentApply(data) {
        if (!await TnxSocketHandler._authorizeDelegation(data)) return;
        const { applyTreatmentDelegated } = await import("./treatment-flow.mjs");
        await applyTreatmentDelegated(data);
    }

    // ─── miracleSwap（17-6・《神出鬼没》） ────────────────────────────────────────

    /** 宿主との状態の入れ替えを GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onMiracleSwap(data) {
        if (!await TnxSocketHandler._authorizeDelegation(data)) return;
        const { applyMiracleSwapDelegated } = await import("./miracle-flow.mjs");
        await applyMiracleSwapDelegated(data);
    }

    /** 状態の入れ替えを GM へ委譲する(宿主の所有権がない宣言者クライアントから呼ぶ)。 */
    static emitMiracleSwap(payload) {
        game.socket.emit(SOCKET_CHANNEL, { userId: game.user.id,
            type: "miracleSwap", ...payload });
    }

    /** 治療の状態除去を GM へ委譲する（患者の所有権がない治療者クライアントから呼ぶ）。 */
    static emitTreatmentApply(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            userId: game.user.id,
            type: "treatmentApply",
            ...payload,
        });
    }

    // ─── repairApply（フェーズ12・修理・2026-07-18） ──────────────────────────────

    /** 修理成功による故障解除を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onRepairApply(data) {
        if (!await TnxSocketHandler._authorizeDelegation(data)) return;
        const { applyRepairDelegated } = await import("./repair-flow.mjs");
        await applyRepairDelegated(data);
    }

    /** 故障解除を GM へ委譲する（対象の所有権がない修理者クライアントから呼ぶ）。 */
    static emitRepairApply(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            userId: game.user.id,
            type: "repairApply",
            ...payload,
        });
    }

    // ─── modificationApply（16-4・改造） ───────────────────────────────────────

    /** 改造成功による改造行の適用を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onModificationApply(data) {
        if (!await TnxSocketHandler._authorizeDelegation(data)) return;
        const { applyModificationDelegated } = await import("./modification-flow.mjs");
        await applyModificationDelegated(data);
    }

    /** 改造行の適用を GM へ委譲する（対象の所有権がない改造者クライアントから呼ぶ）。 */
    static emitModificationApply(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            userId: game.user.id,
            type: "modificationApply",
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
        game.socket.emit(SOCKET_CHANNEL, {
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
        await grantInterruptToTargets(data?.targetUuids ?? [], data?.consumesAr !== false);
    }

    /** 割り込み許可の付与を GM へ委譲する（付与元アクターの操作者クライアントから呼ぶ）。 */
    static emitInterruptGrant(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
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
        game.socket.emit(SOCKET_CHANNEL, {
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
        await combat.endInterrupt();
    }

    /** 挿入メイン終了を GM へ委譲する（挿入メインの操作者クライアントから呼ぶ）。 */
    static emitInterruptEnd(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            type: "interruptEnd",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── markMajor（メジャーアクション記帳の委譲・2026-07-26 一般則） ────────────────
    // majorActed は combat フラグのため GM 権限が要る。メジャータイミングの用途を実行した非 GM は
    // activeGM へ委譲し、GM が本人の combatant を現プロセスの majorActed に積む(プロセス終了時に
    // AR−1＋CSカレント0)。

    /** メジャーアクション記帳を GM が代行する。要求者が本人の所有者であることを検証。 */
    static async _onMarkMajor(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const combat = game.combats.get(data?.combatId);
        const combatant = combat?.combatants.get(data?.combatantId);
        const requester = game.users.get(data?.userId);
        if (!requester || !combatant?.actor?.testUserPermission(requester, "OWNER")) return;
        await combat._addMajorActed(data.combatantId);
    }

    /** メジャーアクション記帳を GM へ委譲する（本人の操作者クライアントから呼ぶ）。 */
    static emitMarkMajor(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            type: "markMajor",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── sessionSceneCard（切り札→現在のシーンカード記録の委譲・フェーズ14-2） ────
    // 切り札のシーン消費化はプレイヤークライアントで起きるが、実行状態(ワールド設定
    // sessionState)は GM しか書けないため、activeGM が記録を代行する。

    /** 現在のシーンカードの記録を GM クライアントが代行する(複数 GM 接続時は activeGM のみ)。 */
    static async _onSessionSceneCard(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const { setCurrentSceneCard } = await import("./session-state.mjs");
        await setCurrentSceneCard(data?.cardId ?? "");
    }

    // ─── sessionTeam（チーム宣言の委譲・フェーズ14-5） ────────────────────────
    // チームを組む宣言はいつでも可(プレイヤーも行う)が、実行状態(ワールド設定)は GM しか
    // 書けないため activeGM が代行する。join/leave は要求者が対象アクターの所有者である
    // ことを検証する。旧「チームで登場/退場」op は 2026-08-22 のオミットで廃止。

    /** チーム宣言(結成・参加・離脱)を GM クライアントが代行する。 */
    static async _onSessionTeam(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const requester = game.users.get(data?.userId);
        if (!requester) return;
        const ss = await import("./session-state.mjs");
        const ownsActor = (id) => !!game.actors.get(id)?.testUserPermission(requester, "OWNER");
        switch (data?.op) {
            case "create":     return void await ss.createTeam(String(data.name ?? ""));
            case "join":       if (ownsActor(data.actorId)) await ss.joinTeam(data.teamId, data.actorId); return;
            case "leave":      if (ownsActor(data.actorId)) await ss.leaveTeam(data.actorId); return;
        }
    }

    /** チーム宣言を GM へ委譲する(プレイヤークライアントから呼ぶ)。 */
    static emitSessionTeam(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            type: "sessionTeam",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── teamExit（手動退場の委譲・2026-08-23 チームの退場連動） ───────────────
    // PL のトークン削除起点の退場は、連動時にチームメイトのアクター(登場フラグ)を更新する
    // 必要があるため activeGM が代行する。要求者が対象アクターの所有者であることを検証し、
    // 連動対象(チームメンバー)は GM 側で再解決する(クライアントの主張を信用しない)。

    /** 手動退場(チームの退場連動込み)を GM クライアントが代行する。 */
    static async _onTeamExit(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        const requester = game.users.get(data?.userId);
        if (!requester) return;
        if (!game.actors.get(data?.actorId)?.testUserPermission(requester, "OWNER")) return;
        const { applyManualExit } = await import("./appearance-state.mjs");
        await applyManualExit(data.actorId);
    }

    /** 手動退場を GM へ委譲する(プレイヤークライアントから呼ぶ)。 */
    static emitTeamExit(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            type: "teamExit",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── infoDisclose（情報収集判定の自動開示の委譲・フェーズ14-9） ────────────
    // 開示の正本(アクトジャーナルのフラグ)は GM しか書けないため activeGM が代行する。
    // 開示は開くだけで閉じない(単調・冪等)ため、検証は要求者の存在確認に留める。

    /** 情報収集判定の自動開示を GM クライアントが代行する。 */
    static async _onInfoDisclose(data) {
        if (game.users.activeGM?.id !== game.user.id) return;
        if (!game.users.get(data?.userId)) return;
        const { applyInfoDisclosure } = await import("./info-gathering.mjs");
        await applyInfoDisclosure(data ?? {});
    }

    /** 情報収集判定の自動開示を GM へ委譲する(プレイヤークライアントから呼ぶ)。 */
    static emitInfoDisclose(payload) {
        game.socket.emit(SOCKET_CHANNEL, {
            type: "infoDisclose",
            userId: game.user.id,
            ...payload,
        });
    }

    // ─── messagePatch（メッセージ更新の汎用委譲・2026-07-16 一本化） ──────────────

    /** メッセージ更新を GM クライアントが代行する(自スコープの flags と content=カード本文、
     *  および whisper=リアクションカードの公開切替(シークレット解除・2026-07-18)のみ受理。
     *  再判定の置き換え着地は本文の差し替えを含む=2026-07-14)。 */
    static async _onMessagePatch(data) {
        // 複数 GM 接続時に両方が update すると二重更新になるため activeGM のみ代行する
        if (game.users.activeGM?.id !== game.user.id) return;
        const message = game.messages.get(data?.messageId);
        if (!message || !data?.patch) return;
        const updates = {};
        for (const [k, v] of Object.entries(data.patch)) {
            if (k !== "content" && k !== "whisper" && !k.startsWith(`flags.${SYSTEM_ID}.`)) continue; // 自スコープ外は無視
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
            data[flagPrefix ? `flags.${SYSTEM_ID}.${flagPrefix}.${k}` : k] = v;
        }
        if (game.user.isGM || message.isAuthor) {
            await message.update(data);
        } else {
            game.socket.emit(SOCKET_CHANNEL, {
                type: "messagePatch",
                messageId: message.id,
                patch: data,
            });
        }
    }
}
