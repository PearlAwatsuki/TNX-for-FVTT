/**
 * @fileoverview システム設定(game.settings)の登録。
 *
 * tnx.mjs の init フックから切り出したもの(2026-09-07)。**呼ぶ順序に意味がある**ため、
 * tnx.mjs 側は元の並びのまま順に呼ぶ。ここで並びを変えないこと。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { TnxCardSetupApp } from "../app/tnx-card-setup-app.mjs";
import { registerFocusSystemSetting } from "../focus-system/state.mjs";
import { registerSessionStateSetting, registerAppearanceExpTracking, registerMiracleUseLogging } from "../session/session-state.mjs";
import { registerSubSceneSetting } from "../session/subscenes.mjs";
import { registerPartSlotPresetSetting } from "../app/part-slot-preset-app.mjs";

export function registerSettings() {
    // --- システム設定の登録 ---
    // ダメージチャート効果文(ワールド設定＋編集アプリメニュー)

    // 部位スロットプリセット(ワールド設定＋編集アプリメニュー。新規キャストへ流し込む)
    registerPartSlotPresetSetting();

    // 実行中 FS判定の正本(フェーズ12-5)
    registerFocusSystemSetting();
    registerSessionStateSetting();
    // 登場シーン数の記帳(経験点配布の「全て自動で入力する」の元・アクティブ GM のみが書く)
    registerAppearanceExpTracking();
    registerMiracleUseLogging();
    registerSubSceneSetting();

    game.settings.register(SYSTEM_ID, "defaultHandMaxSize", {
        name: "デフォルトの手札上限数",
        hint: "各ユーザーの手札上限の基本となる枚数を設定します。ユーザーが個別に設定していない場合、この値が適用されます。",
        scope: "world",
        config: true,
        type: Number,
        default: 4,
        requiresReload: true
    });

    // 正準名ブリッジの一回限り移行(2026-07-17)の実行済みフラグ(ready フックでゲート)
    game.settings.register(SYSTEM_ID, "usageTypeCanonicalMigrated", {
        scope: "world", config: false, type: Boolean, default: false,
    });
    // 技能・神業の上の転送コピーの一回限り掃除(2026-09-02)の版番号ゲート。部位キー移行と同じ作法
    game.settings.register(SYSTEM_ID, "capabilityTransferCleanupScheme", {
        scope: "world", config: false, type: Number, default: 0,
    });

    // チームの退場連動(2026-08-23 ユーザー裁定・既定オフ)。登場は判定を振るか等の判断が多く
    // 自動化しない(2026-08-22 オミット)が、退場は純粋な記帳なので連動できる——という非対称が
    // 設計根拠。連動の適用は手動の退場操作(パネルの×・盤面のトークン削除)のみ
    game.settings.register(SYSTEM_ID, "teamLinkedExit", {
        name: "チームの退場連動",
        hint: "チームを組んでいるキャラクターを退場させたとき、チームの登場中メンバー全員を一緒に退場させます。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.register(SYSTEM_ID, "shuffleOnDeckReset", {
        name: "山札リセット時にシャッフル",
        hint: "山札のリセット（全回収）や捨て札の回収を行った際、自動的に山札をシャッフルします。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false // デフォルトはOFF
    });

    // カードID設定（config: false — UIはカードセットアップアプリで管理）
    const _cardIdSetting = { scope: "world", config: false, type: String, default: "" };
    game.settings.register(SYSTEM_ID, "cardDeckId",       { ..._cardIdSetting });
    game.settings.register(SYSTEM_ID, "discardPileId",    { ..._cardIdSetting });
    game.settings.register(SYSTEM_ID, "neuroDeckId",      { ..._cardIdSetting });
    game.settings.register(SYSTEM_ID, "scenePileId",      { ..._cardIdSetting });
    game.settings.register(SYSTEM_ID, "accessCardPileId", { ..._cardIdSetting });
    game.settings.register(SYSTEM_ID, "gmTrumpDiscardId", { ..._cardIdSetting });

    // HUD UI 状態（クライアントローカル）
    const _hudUiSetting = { scope: "client", config: false, type: Boolean, default: false };
    game.settings.register(SYSTEM_ID, "hudRightCollapsed",  { ..._hudUiSetting });
    game.settings.register(SYSTEM_ID, "hudBottomCollapsed", { ..._hudUiSetting });
    game.settings.register(SYSTEM_ID, "hudAccessCollapsed", { ..._hudUiSetting, default: true });
    // 参加者パネルはステータスと受け渡し先(D&D)を常時見せる場のため、既定は展開
    game.settings.register(SYSTEM_ID, "hudParticipantsCollapsed", { ..._hudUiSetting });

    // シナリオコントロールパネル UI 状態（クライアントローカル・2026-08-15 タブ再構成）
    game.settings.register(SYSTEM_ID, "scenarioPanelTab", {
        scope: "client", config: false, type: String, default: "flow",
    });
    game.settings.register(SYSTEM_ID, "scenarioPanelSceneListOpen", { ..._hudUiSetting });
    game.settings.register(SYSTEM_ID, "scenarioPanelRotationOpen",  { ..._hudUiSetting });

    game.settings.register(SYSTEM_ID, "revealPlayerHands", {
        name: "プレイヤーの手札を開示",
        hint: "有効にすると全ユーザーのHUDにプレイヤー全員の手札が表示されます。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.registerMenu(SYSTEM_ID, "cardSetup", {
        name: "カードをセットアップ",
        label: "カードの設定を開く",
        hint: "山札・手札などのカードドキュメントを作成・割り当てします。",
        icon: "fas fa-cards",
        type: TnxCardSetupApp,
        restricted: true,
    });
}
