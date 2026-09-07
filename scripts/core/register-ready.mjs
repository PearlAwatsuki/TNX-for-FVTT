/**
 * @fileoverview ワールド読み込み完了時の初期化(2026-09-07 tnx.mjs の ready フックから移設)。
 *
 * 一回限りの移行、経験点の初期同期、ソケットの受信登録、HUD の起動など、**ワールドのデータが
 * 揃ってからでないとできない**処理をまとめる。init に置けないものだけがここにある。
 * 実行順は元のまま——移行どうしの前後関係がある。
 */

import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";
import { TokyoNovaCastSheet } from "../actor/tnx-cast-sheet.mjs";
import { canonicalizeSkillActions } from "./usage-type-migration.mjs";
import { TnxHud } from "../app/tnx-hud.mjs";
import { recordCastOwnerUser } from "./cast-ownership.mjs";
import { enforceUsageChainDefaultsOnImport } from "./usage-derivation.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { TnxCheckFlow } from "../flow/tnx-check-flow.mjs";
import { TnxCheckDialog } from "../app/tnx-check-dialog.mjs";
import { sweepEffectScratchItems } from "./effect-authoring.mjs";
import { getUserFlagData } from "./user-flag-schema.mjs";
import { buildCastHistorySyncUpdate } from "../rules/exp-sync.mjs";
import { initializeDefaultPartSlotPreset, migratePartSlotKeys } from "../app/part-slot-preset-app.mjs";
import { autoAcquireForStyleSkill, autoImportDerivedData } from "./style-skill-acquisition.mjs";
import { cleanupCapabilityTransferCopies } from "./item-transfer.mjs";
import { syncCastExpToUser, performInitialHistorySync, performUnsyncSeparation } from "./exp-user-sync.mjs";

export async function onSystemReady() {
    game.tnx = game.tnx || {};

    // 効果シートを開いたままワールドを閉じた場合にだけ残る下書きの置き忘れを片づける
    await sweepEffectScratchItems();

    // 部位スロットプリセット: ワールド初回ロードでデフォルト体部位を自動設定(GM のみ・1回)
    await initializeDefaultPartSlotPreset();

    // 部位キーの付与移行(フェーズ12・GM のみ・1回): プリセット設定と全アクターの partSlots に
    // 無キー行のキーを永続化する(既定ラベル=対応表・カスタム=生成キー)
    await migratePartSlotKeys();

    // 技能・神業の上に残った転送コピーの一回限り掃除(2026-09-02 ユーザー確定・GM のみ・1回):
    // 技能レベル等の効果はキャラクター付与(遠隔適用)へ移ったため、旧経路のコピーが残ると二重に乗る
    await cleanupCapabilityTransferCopies();

    // 正準名ブリッジの一回限り移行(2026-07-17 ユーザー承認・GM のみ・1回): 既定一般技能の用途を
    // 行動種別タイプへ付け替える(回避→ドッジ・白兵→パリー・自我/信用→各リアクション・医療→治療・
    // 操縦→移動/リアクション（移動妨害）の追加)。以後の資格・候補判定は用途タイプの所持のみ
    // (skillRoles・正準名既定は廃止=この移行とインポート時正規化だけが対応表を使う)
    if (game.user.isGM && !game.settings.get(SYSTEM_ID, "usageTypeCanonicalMigrated")) {
        const migrateSkill = async (item) => {
            if (item.type !== "generalSkill") return;
            const src = item.toObject().system ?? {};
            const next = canonicalizeSkillActions(
                { name: item.name, identificationKey: src.identificationKey ?? "", actions: src.actions ?? [] },
                () => foundry.utils.randomID());
            if (next) await item.update({ "system.actions": next });
        };
        for (const it of game.items.contents) await migrateSkill(it);
        for (const actor of game.actors.contents) {
            for (const it of actor.items.contents) await migrateSkill(it);
        }
        await game.settings.set(SYSTEM_ID, "usageTypeCanonicalMigrated", true);
        console.log("TNX | 用途タイプの正準名移行を完了しました");
    }

    // 下バー展開時はホットバーを退避する。HUD 初期描画前に body クラスを付与して
    // 「ホットバー表示→直後に非表示」のチラつきを防ぐ(下バー収納の既定は false=展開)。
    if (!game.settings.get(SYSTEM_ID, "hudBottomCollapsed")) {
        document.body.classList.add("tnx-bottom-hud-expanded");
    }
    game.tnx.hud = new TnxHud();
    game.tnx.hud.render({ force: true });
    // サイドバー追従の沈静化: ロード直後はサイドバー位置が未確定でめり込むため、右カラムは
    // CSS で非表示にしておき、UI 安定後(ready+遅延)に実測位置をセットしてからフェードインで出す。
    // これで「安全位置→実測位置へカクっと移動」する瞬間を見せずに済む(下バーは別要素で表示のまま)。
    setTimeout(() => {
        TnxHud._settled = true;
        TnxHud._applyRightOffset?.();            // 実測位置をセット(まだ非表示)
        document.body.classList.add("tnx-hud-settled"); // 右カラムをフェードインで表示
    }, 500);

    // 判定フロー: ダイアログクラスを注入してグローバルに公開
    TnxCheckFlow.dialogClass = TnxCheckDialog;
    game.tnx.check = TnxCheckFlow;

    // システムソケットメッセージの受信（TnxSocketHandler に集約）
    game.socket.on(SOCKET_CHANNEL, TnxSocketHandler.onMessage);

    Hooks.on("updateSetting", (setting) => {
        if (setting.key === "tokyo-nova-axleration.revealPlayerHands") {
            game.tnx?.hud?.render();
        }
    });

    Hooks.on("renderPlayerList", () => {
        if (!TnxHud._playerListObserver) {
            TnxHud._setupPlayerListObserver();
        } else if (TnxHud._playerListUpdate) {
            requestAnimationFrame(TnxHud._playerListUpdate);
        }
    });

    // サイドバー再描画時にオブザーバーをリセット(#sidebar-content が作り直される可能性)
    Hooks.on("renderSidebar", () => {
        TnxHud._rightOffsetObserver?.disconnect();
        TnxHud._rightOffsetObserver = null;
        TnxHud._setupRightOffsetObserver();
    });

    // 2-1/2-2: ownerUserId 未記録キャストの起動時初期化
    // Phase 2-1 デプロイ前に ownership が設定済みのキャストはここで補完する
    if (game.user.isGM) {
        const gmSet = new Set(game.users.filter(u => u.isGM).map(u => u.id));
        const OBSERVER = 2;
        for (const cast of game.actors.filter(a => a.type === 'cast' && !a.system.ownerUserId)) {
            for (const [userId, level] of Object.entries(cast.ownership ?? {})) {
                if (userId === 'default' || level < OBSERVER || gmSet.has(userId)) continue;
                const foundUser = game.users.get(userId);
                if (foundUser?.uuid) {
                    await cast.update({ "system.ownerUserId": foundUser.uuid }, { calcExp: false, syncing: true });
                    if (cast.system.syncWithOwner) {
                        await performInitialHistorySync(cast, foundUser);
                    }
                    break;
                }
            }
        }
    }

    // 所有トループ級の消費は取得元キャストに計上される(11-6・Troops.md)ため、
    // トループ側のアイテム変動でも所有者キャストの EXP を再計算する(分身は計上対象外)
    const recalcTroopOwnerExp = (troop) => {
        if (troop?.type !== "troop" || troop.system?.troopMode === "bunshin") return;
        const uuid = troop.system?.ownerActorRef?.uuid ?? "";
        if (!uuid) return;
        let owner = null;
        try { owner = fromUuidSync(uuid); } catch { owner = null; }
        if (owner?.type === "cast") TokyoNovaCastSheet.updateCastExp(owner);
    };

    const recalcActorExp = (item) => {
        if (!item.parent) return;
        if (item.parent.type === 'cast') {
            TokyoNovaCastSheet.updateCastExp(item.parent);
        } else if (item.parent.type === 'troop') {
            recalcTroopOwnerExp(item.parent);
        }
    };

    // 所有者参照・種別の変更で計上先が移動するため、旧所有者を preUpdate で捕捉して双方を再計算する。
    // トループ削除時も所有者の消費が減るため再計算する
    Hooks.on("preUpdateActor", (actor, changes, options) => {
        if (actor.type !== "troop") return;
        if (foundry.utils.hasProperty(changes, "system.ownerActorRef")
            || foundry.utils.hasProperty(changes, "system.troopMode")) {
            options.tnxPrevTroopOwnerUuid = actor.system.ownerActorRef?.uuid ?? "";
        }
    });
    Hooks.on("updateActor", (actor, changes, options) => {
        if (actor.type !== "troop" || options.tnxPrevTroopOwnerUuid === undefined) return;
        const uuids = new Set([options.tnxPrevTroopOwnerUuid, actor.system.ownerActorRef?.uuid ?? ""]);
        for (const uuid of uuids) {
            if (!uuid) continue;
            let owner = null;
            try { owner = fromUuidSync(uuid); } catch { owner = null; }
            if (owner?.type === "cast") TokyoNovaCastSheet.updateCastExp(owner);
        }
    });
    Hooks.on("deleteActor", (actor) => recalcTroopOwnerExp(actor));

    // トループ級シートの「所有者経験点」表示は描画時に所有者キャストの exp を読むだけのため、
    // キャスト側の exp 変動では自動再描画されない。開いている該当トループ級シートを明示的に
    // 再描画して表示を同期する(11-6)
    Hooks.on("updateActor", (actor, changes) => {
        if (actor.type !== "cast" || !foundry.utils.hasProperty(changes, "system.exp")) return;
        for (const app of foundry.applications.instances.values()) {
            const doc = app.document;
            if (doc?.documentName === "Actor" && doc.type === "troop"
                && (doc.system.ownerActorRef?.uuid ?? "") === actor.uuid) {
                app.render();
            }
        }
    });

    Hooks.on('createItem', (item) => recalcActorExp(item));
    Hooks.on('deleteItem', (item) => recalcActorExp(item));
    Hooks.on('updateItem', (item) => recalcActorExp(item));

    // スタイル技能をアクターに取得(インポート/ドロップ)した時、自動取得対象の武器を複製生成(10-2)。
    // 多重生成を避けるため作成したユーザーのみ実行。
    Hooks.on('createItem', (item, options, userId) => {
        if (game.user.id !== userId) return;
        if (item.parent?.documentName !== "Actor") return;
        // 技能チェーンの既定(ベース技能・必須コンボ)をインポート直後に適用(2026-07-08 修正)。
        // 辞典/ワールドで用途を設定→アクターへインポートでは、用途シートを開くまで自動設定が
        // 効かなかったため、作成時に一括適用する(冪等・解決不能な旧参照の掃除を含む)。
        // 技能以外でも用途を持つアイテム(アウトフィット等)は「解説参照」→「その他」の正規化
        // (KI-033)があるため同じ整備を通す(チェーン解決は従来どおり内部の条件で判断)
        if (["generalSkill", "styleSkill"].includes(item.type)
            || (item.system?.actions?.length ?? 0) > 0) {
            enforceUsageChainDefaultsOnImport(item).catch(err =>
                console.error("TNX | 用途チェーン既定の適用に失敗しました", err));
        }
        if (item.type === "styleSkill") {
            autoAcquireForStyleSkill(item.parent, item);
        } else if (item.system?.hasDerivedData === true) {
            // 派生元アウトフィット: 派生データを自動生成(各々 isDerivedData=true＝経験点なし)
            autoImportDerivedData(item.parent, item);
        }
    });

    // アウトフィット集計(outfitMod / appearanceModifier)は CastDataModel.prepareDerivedData で
    // 都度算出するため(B-2)、アイテム変更フックでの再集計・DB 書き戻しは不要になった。

    // 起動時: 全キャストの経験点を初期化(User flag 同期のため。EXP は派生でなく実保存)。
    for (const actor of game.actors.filter(a => a.type === "cast")) {
        TokyoNovaCastSheet.updateCastExp(actor).catch(e =>
            console.error(`TokyoNOVA | Initial updateCastExp failed for ${actor.name}:`, e)
        );
    }

    Hooks.on('updateActor', async (actor, diff, options) => {
        if (actor.type === 'cast' && options.calcExp !== false && !options.syncing) {
            if (diff.system) {
                 await TokyoNovaCastSheet.updateCastExp(actor);
            }
        }

        // 2-1: cast の ownership 変更 → ownerUserId(User UUID)を記録
        // GM クライアントのみ実行。syncing フラグ付きの更新(ownerUserId 記録後の折り返し等)は無視。
        // diff.ownership に依存しない: Foundry v13 の ownership 更新では diff.ownership が
        // 設定されない場合があるため。recordCastOwnerUser 自体が resolveOwnerUserIdAction で
        // 変更不要(none)の場合を早期 return するため、全 cast 更新で呼んでも安全。
        if (actor.type === 'cast' && !options.syncing && game.user.isGM) {
            try {
                await recordCastOwnerUser(actor);
            } catch (e) { console.error(`TokyoNOVA | Failed to record ownerUserId for cast ${actor.name}:`, e); }
        }

        // 2-2: ownerUserId 新規記録 → cast と User flag の history を双方向マージ(初回同期)
        // diff.system?.ownerUserId が設定されている = recordCastOwnerUser が ownerUserId を更新した
        // syncing: true の更新(起動時スキャン等)はここに到達しないため startup scan は直接呼ぶ
        if (actor.type === 'cast' && diff.system?.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performInitialHistorySync(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed initial history sync for cast ${actor.name}:`, e); }
        }

        // 2-2b: syncWithOwner OFF→ON → 初回同期(performInitialHistorySync 内で syncWithOwner ゲート済み)
        if (actor.type === 'cast' && diff.system?.syncWithOwner === true && actor.system.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performInitialHistorySync(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed initial history sync (ON) for cast ${actor.name}:`, e); }
        }

        // 2-2b: syncWithOwner ON→OFF → 由来分離
        if (actor.type === 'cast' && diff.system?.syncWithOwner === false && actor.system.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performUnsyncSeparation(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed unsync separation for cast ${actor.name}:`, e); }
        }

        // isGhost 変更時の CS修正再集計は不要(prepareDerivedData が isGhost を見て都度算出する、B-2)。

        // 2-2: cast → User flag EXP 同期(syncWithOwner が ON の場合のみ)
        // syncing フラグで updateUser → updateCastExp → updateActor の再帰を遮断する
        if (actor.type === 'cast' && actor.system.ownerUserId && actor.system.syncWithOwner && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) {
                    await syncCastExpToUser(ownerUser);
                }
            } catch (e) { console.warn(`TokyoNOVA | Failed to sync EXP to User flag:`, e); }
        }
    });

    // 2-2: User flag(exp/history)変更 → レコードシート再描画 + cast ローカル履歴同期
    // syncCastExpToUser が { syncing: true } で書き込むため、その折り返しはここで遮断する
    // 全クライアントでレコードシートを再描画してから GM クライアントのみ cast 同期を行う
    Hooks.on('updateUser', async (user, diff, options) => {
        if (options.syncing) return;

        const flagDiff = diff.flags?.[SYSTEM_ID];
        if (!flagDiff) return;
        if (!("exp" in flagDiff) && !("history" in flagDiff)) return;

        // 全クライアント: 開いているレコードシートを再描画
        const sheet = foundry.applications?.instances?.get(`tnx-record-sheet-${user.id}`);
        if (sheet?.rendered) sheet.render();

        if (!game.user.isGM) return;

        const linkedCasts = game.actors.filter(
            a => a.type === 'cast' && a.system.ownerUserId === user.uuid && a.system.syncWithOwner
        );
        const { history: userHistory } = getUserFlagData(user);
        for (const cast of linkedCasts) {
            // cast ローカルの system.history を User flag に合わせて同期
            const historySyncUpdate = buildCastHistorySyncUpdate(cast.system.history, userHistory);
            if (!foundry.utils.isEmpty(historySyncUpdate)) {
                await cast.update(historySyncUpdate, { calcExp: false, syncing: true });
            }
            await TokyoNovaCastSheet.updateCastExp(cast);
        }
    });
}
