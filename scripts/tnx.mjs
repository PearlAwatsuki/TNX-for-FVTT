import { SYSTEM_ID, SOCKET_CHANNEL } from "./constants.mjs";
import { TokyoNovaCastSheet } from './actor/tnx-cast-sheet.mjs';
import { TokyoNovaGuestSheet } from './actor/tnx-guest-sheet.mjs';
import { TokyoNovaTroopSheet } from './actor/tnx-troop-sheet.mjs';
import { TokyoNovaExtraSheet } from './actor/tnx-extra-sheet.mjs';
import { usesMaxBaseOf } from './data/item/uses.mjs';
import { miracleRemovalUpdate } from './rules/miracle.mjs';
import { fitCardTags, renderCardOutcome } from './chat/chat-card.mjs';
import { canonicalizeSkillActions } from './core/usage-type-migration.mjs';
import { SKILL_PACKS } from './dictionary/skill-dictionary.mjs';
import { CastDataModel } from './data/actor/cast.mjs';
import { GuestDataModel } from './data/actor/guest.mjs';
import { TroopDataModel } from './data/actor/troop.mjs';
import { ExtraDataModel } from './data/actor/extra.mjs';
import { HousingAreaDataModel } from './data/item/housing-area.mjs';
import { OrganizationDataModel } from './data/item/organization.mjs';
import { LifePathDataModel } from './data/item/life-path.mjs';
import { ArmorDataModel } from './data/item/armor.mjs';
import { CyborgDataModel } from './data/item/cyborg.mjs';
import { CombinerDataModel } from './data/item/combiner.mjs';
import { GeneralDataModel } from './data/item/general.mjs';
import { IanusDataModel } from './data/item/ianus.mjs';
import { TronDataModel } from './data/item/tron.mjs';
import { VehicleDataModel } from './data/item/vehicle.mjs';
import { WeaponDataModel } from './data/item/weapon.mjs';
import { TapDataModel } from './data/item/tap.mjs';
import { ResidenceDataModel } from './data/item/residence.mjs';
import { MiracleDataModel } from './data/item/miracle.mjs';
import { GeneralSkillDataModel } from './data/item/general-skill.mjs';
import { StyleDataModel } from './data/item/style.mjs';
import { StyleSkillDataModel } from './data/item/style-skill.mjs';
import { PlayingCardsDataModel } from './data/card/playing-cards.mjs';
import { NeuroCardsDataModel } from './data/card/neuro-cards.mjs';
import { OtherDataModel } from './data/card/other.mjs';
import { TokyoNovaItem } from './item/item.mjs';
import { TokyoNovaActiveEffect } from './core/active-effect.mjs';
import { TnxCombat } from './combat/tnx-combat.mjs';
import { TnxCombatant } from './combat/tnx-combatant.mjs';
import { TnxCombatTracker } from './combat/tnx-combat-tracker.mjs';
import { TokyoNovaStyleSheet } from './item/tnx-style-sheet.mjs';
import { TokyoNovaMiracleSheet } from './item/tnx-miracle-sheet.mjs';
import { TokyoNovaGeneralSkillSheet } from './item/tnx-general-skill-sheet.mjs';
import { TokyoNovaStyleSkillSheet } from './item/tnx-style-skill-sheet.mjs';
import { TokyoNovaOrganizationSheet } from './item/tnx-organization-sheet.mjs';
import { TokyoNovaLifePathSheet } from './item/tnx-life-path-sheet.mjs';
import { TokyoNovaOutfitSheet } from './item/tnx-outfit-sheet.mjs';
import { formatWeaponRangeLabel } from './ui/outfit-view.mjs';
import { TokyoNovaHousingAreaSheet } from './item/tnx-housing-area-sheet.mjs';
import { TnxScenarioSheet } from './journal/tnx-scenario-sheet.mjs';
import { TnxFocusSystemSheet } from './journal/tnx-focus-system-sheet.mjs';
import { TnxCardSetupApp } from './app/tnx-card-setup-app.mjs';
import { TnxHud } from './app/tnx-hud.mjs';
import { TnxRecordSheet } from './app/tnx-record-sheet.mjs';
import { registerDrawTableHooks } from './cards/tnx-draw-table.mjs';
import { recordCastOwnerUser } from './core/cast-ownership.mjs';
import { enforceUsageChainDefaultsOnImport } from './app/tnx-usage-sheet.mjs';
import { renderAttackCard, renderReactionCard } from './flow/attack-flow.mjs';
import { renderDamageCard } from './flow/damage-flow.mjs';
import { renderUsageEffectButton } from './flow/usage-effects.mjs';
import { renderMiracleCard } from './flow/miracle-flow.mjs';
import { TnxSocketHandler } from './core/tnx-socket-handler.mjs';
import { TnxCheckFlow, renderRecheckButton } from './flow/tnx-check-flow.mjs';
import { TnxCheckDialog } from './app/tnx-check-dialog.mjs';
import { TnxRlRequestApp, renderCheckRequestCard } from './app/tnx-rl-request-app.mjs';
import { openRlGrantDamage } from './app/tnx-rl-grant-damage-app.mjs';
import { openRlGrantEffect } from './app/tnx-rl-grant-effect-app.mjs';
import { openRlGrantBounty } from './app/tnx-rl-grant-bounty-app.mjs';
import { renderBountyGrantCard } from './flow/bounty-grant.mjs';
import { renderHandoutCard } from './session/handout-contact.mjs';
import { openFocusSystemPanel } from './app/tnx-focus-system-panel.mjs';
import { openScenarioPanel } from './app/tnx-scenario-panel.mjs';
import { registerFocusSystemSetting, advanceFocusCuts } from './focus-system/state.mjs';
import { registerSessionStateSetting, registerAppearanceExpTracking, registerMiracleUseLogging, getSessionState } from './session/session-state.mjs';
import { registerSubSceneSetting, refreshSubSceneBackground } from './session/subscenes.mjs';
import { registerAppearanceTokenSync } from './session/appearance-state.mjs';
import { registerTimeBoundaries, registerForcedExitWounds } from './session/time-boundary.mjs';
import { durationLabelOf } from "./rules/time-boundary.mjs";
import { openSubScenePanel } from './app/tnx-subscene-panel.mjs';
import { renderFocusProgressButton, renderFocusSupportNote } from './focus-system/result.mjs';
import { autoSendFocusChecks } from './focus-system/request.mjs';
import { registerEffectScratchHiding, sweepEffectScratchItems } from './core/effect-authoring.mjs';
import { FOCUS_SYSTEM_FLAG, defaultFocusSystemData } from './focus-system/data.mjs';
import { getUserFlagData } from "./core/user-flag-schema.mjs";
import { buildCastHistorySyncUpdate } from "./rules/exp-sync.mjs";
import { TnxSkillUtils } from './core/tnx-skill-utils.mjs';
import { CONDITION_KINDS, conditionDisplayName } from "./rules/conditions.mjs";
import { registerPartSlotPresetSetting, getPartSlotPreset, initializeDefaultPartSlotPreset, migratePartSlotKeys } from './app/part-slot-preset-app.mjs';
import { autoAcquireForStyleSkill, autoImportDerivedData } from './core/style-skill-acquisition.mjs';
import { bindConditionChatButtons, renderConditionDrawCard } from "./flow/condition-resolution.mjs";
import { decoratedItemName } from './core/identification.mjs';
import { injectDictionaryBrowserButton } from './app/tnx-dictionary-browser.mjs';
import { applyContentLinkCardTooltips } from './chat/item-card-tooltips.mjs';
import { manualEditDamage } from "./flow/damage-flow.mjs";
import { applyAttackPatch } from "./flow/attack-flow.mjs";
import { registerEffectConfigInjection } from "./core/effect-config-inject.mjs";
import { registerItemTransferHooks, cleanupCapabilityTransferCopies } from "./core/item-transfer.mjs";
import { syncCastExpToUser, performInitialHistorySync, performUnsyncSeparation } from "./core/exp-user-sync.mjs";
import { registerTroopNameSync } from "./core/troop-name.mjs";

async function preloadHandlebarsTemplates() {
    const templatePaths = [
        // === Actor Sheets ===
        "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",

        // === Item Sheets ===
        "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/general-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/organization-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/life-path-sheet.hbs",

        // === Journal Sheets ===
        "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/journal/focus-system-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/parts/focus-system-editor.hbs",

        // === Chat ===
        // 判定結果系カードの基底部品(2026-07-19 基底化): 全カードが参照するためパーシャルとして先読み
        "systems/tokyo-nova-axleration/templates/chat/parts/check-card-row.hbs",
        "systems/tokyo-nova-axleration/templates/chat/parts/check-calc-rows.hbs",
        "systems/tokyo-nova-axleration/templates/chat/parts/info-disclose-outcome.hbs",
        "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-result.hbs",
        "systems/tokyo-nova-axleration/templates/chat/miracle-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/item-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/simple-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/derived-damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-request.hbs",
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/vehicle-move-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/rl-damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-outcome.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-prompt.hbs",

        // === App ===
        "systems/tokyo-nova-axleration/templates/parts/target-picker.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-request-app.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-damage.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-effect.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-bounty.hbs",
        "systems/tokyo-nova-axleration/templates/chat/bounty-grant.hbs",
        "systems/tokyo-nova-axleration/templates/chat/handout-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/scene-switch-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/text-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/info-card.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-panel.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-result.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs",

        // === Dialogs ===
        "systems/tokyo-nova-axleration/templates/dialog/check-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs",

        // === Partials ===
        // アクターシート共通部品(フェーズ11-2。cast/guest 等で共有・features フラグで差異をゲート)
        "systems/tokyo-nova-axleration/templates/actor/parts/sidebar.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/header.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-abilities.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-combat.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-outfits.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-status.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-history.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-profile.hbs",
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/card-setup-app.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs",
        "systems/tokyo-nova-axleration/templates/parts/history-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/usage-list.hbs",
        "systems/tokyo-nova-axleration/templates/item/parts/skill-traits.hbs",
        "systems/tokyo-nova-axleration/templates/parts/bad-status-list.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-combo.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-bonus-rows.hbs",
        // 辞典カード(16-2。ブラウザの種別別カードとアイテム・ツールチップの共用部品)
        "systems/tokyo-nova-axleration/templates/app/dictionary-card.hbs",

        // === User Sheets ===
        "systems/tokyo-nova-axleration/templates/user/record-sheet.hbs",
    ];
    // チャットカードの統一規格(2026-09-05)。骨格と段は**短い別名のパーシャル**で登録する——
    // パーシャルブロック({{#> tnxCard}}…{{/tnxCard}})はパスでは書けないため。
    // カードを作る側はこの別名だけを使い、器・見出し・段のマークアップを各所で組まない。
    const cardPartials = {
        tnxCard:       "systems/tokyo-nova-axleration/templates/chat/parts/card.hbs",
        tnxCardField:  "systems/tokyo-nova-axleration/templates/chat/parts/card-field.hbs",
        tnxCardRow:    "systems/tokyo-nova-axleration/templates/chat/parts/card-row.hbs",
        tnxCardFold:   "systems/tokyo-nova-axleration/templates/chat/parts/card-fold.hbs",
        tnxCardText:   "systems/tokyo-nova-axleration/templates/chat/parts/card-text.hbs",
        tnxCardResult: "systems/tokyo-nova-axleration/templates/chat/parts/card-result.hbs",
    };
    await foundry.applications.handlebars.loadTemplates(cardPartials);
    return foundry.applications.handlebars.loadTemplates(templatePaths);
}

async function setupDefaultSkills(actor) {
    try {
        const packId = SKILL_PACKS.general;
        const pack = game.packs.get(packId);
        if (!pack) {
            ui.notifications.warn(`一般技能の辞典（${packId}）が見つからないため、初期技能を入れられませんでした。`);
            return;
        }

        // インデックスで対象を絞ってから個別取得する(2026-07-17 是正): getDocuments の一括
        // 再取得はパック内の全キャッシュ文書を新インスタンスへ差し替え、開いている辞典シートを
        // 孤児化させる(用途削除が画面に反映されない実因と同経路)。getDocument はキャッシュ優先で
        // 差し替えを起こさない
        const index = await pack.getIndex({
            fields: ["system.generalSkillCategory", "system.identificationKey"],
        });
        const wanted = [...index].filter(e =>
            e.system?.generalSkillCategory === 'initialSkill'
            || e.system?.identificationKey === 'society_nova'
        );
        const toImport = (await Promise.all(wanted.map(e => pack.getDocument(e._id))))
            .filter(Boolean);
        if (toImport.length === 0) {
            // 本システムはルールブックのデータを同梱していない(著作権配慮・README「著作権」)。
            // 辞典が空のままだと「新規キャストに初期技能が入らない」が**無言で**起きるため、
            // 理由を伝える(2026-09-07 ユーザー確定)
            ui.notifications.warn("一般技能の辞典が空のため、初期技能を入れられませんでした。"
                + "本システムはルールブックのデータを同梱していないため、辞典への登録は各自で行ってください。");
            return;
        }

        // 正規ソート順でソートし、sort 値を付与
        const sorted = [...toImport].sort((a, b) =>
            TnxSkillUtils.getSkillSortPosition(a.system.identificationKey)
            - TnxSkillUtils.getSkillSortPosition(b.system.identificationKey)
        );
        const itemsData = sorted.map((doc, idx) => {
            const data = doc.toObject();
            data.sort = (idx + 1) * 1000;
            return data;
        });

        await actor.createEmbeddedDocuments("Item", itemsData);
        console.log(`TokyoNOVA | Imported ${itemsData.length} default skills to ${actor.name}.`);
        ui.notifications.info(`${actor.name} に初期技能を ${itemsData.length} 個インポートしました。`);

    } catch (err) {
        console.error(`TokyoNOVA | Error importing default skills for ${actor.name}:`, err);
    }
}

/**
 * [All Clients] カードの増減で表示が変わる本システムのアプリを再描画する。
 *
 * 旧実装は `ui.windows`(ApplicationV1 のレジストリ)を走査していたが、本システムのアプリは
 * すべて ApplicationV2 なのでそこには 1 つも入らない——実際には**他モジュールの V1 ウィンドウ**を
 * 巻き込んで再描画していた。閉判定の `_closed` もコードのどこにも代入が無く、常に undefined で
 * 素通しだった(2026-09-07 是正)。
 *
 * 対象は id が `tnx-` で始まる、開いているアプリ。id は `foundry.applications.instances` の
 * キー=グローバルな名前空間で、本システムのアプリはすべてこの接頭辞を持つ(HUD・各パネル・
 * 記録シート)。開いていないアプリは対象外(カードが配られただけで勝手に開かない)。
 */
function handleRefreshSheets() {
    for (const app of foundry.applications.instances.values()) {
        if (app.rendered && String(app.id ?? "").startsWith("tnx-")) app.render(false);
    }
}

/**
 * 上記を束ねて呼ぶ。配札・山札リセット等の一括操作では createCard/deleteCard が枚数分
 * 連続発火するため、そのたびに全アプリを描き直さないようまとめる(遅延は従来と同じ 50ms)。
 */
let _refreshSheetsDebounced = null;
function refreshSheetsSoon() {
    _refreshSheetsDebounced ??= foundry.utils.debounce(handleRefreshSheets, 50);
    _refreshSheetsDebounced();
}

/**
 * ownerUserId に紐づく全キャストの消費経験点を集計し、User flag の EXP データを更新する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {User} ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
// ─── 抽出したまとまりのフック登録(2026-09-07 分割)。**トップレベルで呼ぶ**——元は
// ここで直接 Hooks.on していたため、登録の時機を変えないこと
registerEffectConfigInjection();
registerItemTransferHooks();
registerTroopNameSync();

Hooks.on("renderCompendiumDirectory", (_app, html) => injectDictionaryBrowserButton(html));

// ─── チャットカードの描画(2026-09-07 一本化) ───────────────────────────────
// 従来は renderChatMessageHTML を 15 回登録しており、メッセージ 1 枚の描画ごとに 15 個の
// コールバックが走っていた。さらに「上の checkRequest 描画の**後**に登録し…」のように
// **登録順への依存がコメントでしか表現されておらず**、行を並べ替えるだけで壊れる状態だった。
// 表にして 1 回だけ登録する。**この表の並び順が実行順**。
//
// - flag  : そのフラグを持つメッセージにだけ適用(省略=全メッセージ)
// - when  : 追加条件(フラグの値を受け取る)
// - render: (message, html, root) を受ける描画関数
//
// チャットログの初期描画(既存メッセージの一括レンダリング)は ready 発火前に走るため、
// 登録は**トップレベル**で行う(ready 内で登録するとリロード直後の表示分に効かない=
// ダメージカードの本文が殻のまま「内容がすべて消える」ように見えていた・2026-07-14 是正)。
const CHAT_CARD_RENDERERS = [
    // チャットの受付ボタン(ドロー/制御判定)を解決処理に配線する(フェーズ9-4)。
    // 効果決定カード(conditionDraw フラグ)は状態領域をライブ描画する(ボタン→結果の置換・2026-07-12)
    { render: (message, _html, root) => {
        bindConditionChatButtons(root);
        renderConditionDrawCard(message, root);
    } },
    // @UUID コンテンツリンクのカード・ツールチップ(16-x): チャット内の辞典アイテムリンクに
    // ホバーで辞典カードを出す。クリック挙動はコアのまま
    { render: (_message, _html, root) => { if (root) applyContentLinkCardTooltips(root); } },
    // 攻撃カード(12-2): 状態領域のライブ描画(未解決=系統別リアクションボタン/解決後=成否表示に置換)
    { flag: "attackCheck",    render: renderAttackCard },
    // 個別リアクションカード(12・複数対象一括・2026-07-15): GM＋対象所有者に whisper・解決で全体公開
    { flag: "attackReaction", render: renderReactionCard },
    // 報酬点の配布カード(12・2026-07-20): 対象行に受け取りボタン/受け取り済みをライブ描画
    { flag: "bountyGrant",    render: renderBountyGrantCard },
    // ハンドアウト送信カード(2026-08-12): コネの受け取りボタン/取得済みをライブ描画
    { flag: "handoutContact", render: renderHandoutCard },
    // ダメージ・カード(12-3): 台帳+状態領域のライブ描画(カード追加・適用で更新)
    { flag: "damageRoll",     render: renderDamageCard },
    // 神業カード(17-1/17-2): 打ち消された神業は中身が消える・見出しは打ち消しの発動点。
    // **効果トレイ(usageEffects)より前**に置く(打ち消し済みは効果エリアごと消すため)
    { flag: "miracle",        render: renderMiracleCard },
    // 用途の帰結行(2026-09-07): 治療・修理・改造の結果は帰結だけの短いカードを別に出さず、
    // その使用を表しているカードへ刻む
    { flag: "cardOutcome",    render: renderCardOutcome },
    // 用途の適用効果(2026-07-10): 対象所有者/GM が押すと対象へ AE を複製付与する
    { flag: "usageEffects",   render: renderUsageEffectButton },
    // 再判定(2026-07-11→2026-07-14 置き換え着地): 達成値を装飾する
    // (モード外クリック=allowRecheck の素の再判定・モード中=付与/修正の発動)
    { flag: "checkRecheck",   render: renderRecheckButton },
    // 種別タグを幅の上限に収める(入りきらない種別名は横に縮める・2026-09-06)。
    // **描画フックの時点ではまだ DOM に入っていない**(幅が 0 で測れない)ので次のフレームで当てる
    { render: (_message, html) => requestAnimationFrame(() => fitCardTags(html)) },
    // 判定要求カード(8-5): 目標値の可視性制御・「判定する」ボタン・結果の注入
    { flag: "checkRequest",   render: renderCheckRequestCard },
    // FS 進行判定(13-7): 成功した対象行に RL(=GM)へ「進行値に加算」ボタンを足す。
    // **上の checkRequest 描画(結果を statusEl に置く)の後**に置き、その結果表示に足す形にする
    { flag: "checkRequest", when: (f) => f.focusSystemKind === "progress",
      render: renderFocusProgressButton },
    // FS 支援判定: 結果確定で自動適用される(autoApplyFocusSupport が _onCheckResult で実行)。
    // ここは適用済みの表示(支援成立→対象の進行+1／支援失敗)のみ描画する
    { flag: "checkRequest", when: (f) => f.focusSystemKind === "support",
      render: renderFocusSupportNote },
];

Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    for (const { flag, when, render } of CHAT_CARD_RENDERERS) {
        if (!flag) { render(message, html, root); continue; }
        const data = message.getFlag(SYSTEM_ID, flag);
        if (!data) continue;
        if (when && !when(data)) continue;
        render(message, html, root);
    }
});

// @UUID コンテンツリンクのカード・ツールチップ: ジャーナルページも同じ扱いにする
Hooks.on("renderJournalEntryPageSheet", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root) applyContentLinkCardTooltips(root);
});

// FS判定のカット進行への合流(13-7③④): プロセス開始で進行/支援判定を自動送信する。
// メイン開始→その手番のキャストへ進行判定(ルール14)・イニシアチブ開始→AR残の参加者へ支援判定
// (ルール15)を、各実行中 FS について送る(境界イベントは GM 側発火＝autoSendFocusChecks が GM 実行)。
Hooks.on("tnxProcessStart", (combat, data) => {
    autoSendFocusChecks(combat, data?.phase);
});

// FS判定のカット連動(13-7⑥): カット境界(カットが1つ終わった=tnxCutEnd)で、実行中 FS(cut 型敗北)の
// 経過カットを +1 する。パネルのカット表示は cutLimit−経過 のカウントダウンで自動更新される。
Hooks.on("tnxCutEnd", () => {
    advanceFocusCuts();
});

Hooks.once("init", async function() {
    game.tnx = game.tnx || {}
    game.tnx.refreshSheets = handleRefreshSheets;

    // 効果の下書き置き場はアイテムディレクトリに出さない(組み立て中だけ存在する器)。
    // サイドバーの初回描画は ready より前なので、隠すフックの登録は init で行う
    registerEffectScratchHiding();

    // チャット通知のデフォルトを「チャットカード」から「通知バッジ」に変更する。
    // ユーザーが明示的に設定済みの場合はその値が優先される(デフォルト値のみの変更)。
    const chatNotifSetting = game.settings.settings.get("core.chatNotifications");
    if (chatNotifSetting) chatNotifSetting.default = "pip";
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });

    // 符号付き表記(判定修正の内訳等)。負値は "-n"、0以上は "+n"。ハードコードの "+" 前置だと
    // マイナス修正が "+-n" になるため(眼部損傷 -5 等)、必ず本ヘルパーで符号を付ける。
    Handlebars.registerHelper('signed', function(n) {
        const v = Number(n) || 0;
        return v >= 0 ? `+${v}` : `${v}`;
    });

    // アイテム名の表示マーカー(2026-06-12 ユーザー確定ルール)。実体は decoratedItemName
    // (identification.mjs・フェーズ16-2 で関数化=辞典ブラウザ/ツールチップのカードと共用)
    Handlebars.registerHelper('tnxDecoratedName', decoratedItemName);

    // 武器射程の表記(min/max が同じなら単一表記、異なるなら「近～超遠」形式)
    Handlebars.registerHelper('tnxRangeLabel', formatWeaponRangeLabel);
    // 効果一覧の「効果時間」列(15-1)。Foundry 標準の duration.label は本システムでは常に空
    // (実時間を使わないため)なので、効果に載せた TNX の持続を表示する
    Handlebars.registerHelper('tnxDurationLabel', durationLabelOf);

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;
    // 名前装飾(フェーズ12)のためネイティブ AE 適用の一点(Actor への `name`)だけ抑止する
    CONFIG.ActiveEffect.documentClass = TokyoNovaActiveEffect;

    // ActiveEffect の転送モードを新方式にする(フェーズ9-3)。
    // レガシー(true)では「アイテムに乗せた効果がアイテム自身に適用されない」(モードA 不成立)、
    // かつ v13 のトークンアクターで transfer:true が転送されないバグがある。
    // false にすると、transfer:false の効果はアイテム自身へ、transfer:true の効果は
    // アイテム上から親アクターへ仮想適用される(着地点 effectMod に正しく流れ込む)。
    CONFIG.ActiveEffect.legacyTransferral = false;

    // カット進行(戦闘システム・フェーズ13)の Combat/Combatant 派生クラスを登録。
    // 13-2 は「器」＝クラス新設・登録・カット開始シードのロジック集約まで。
    // プロセス状態機械・CS/AR 自動記帳・トラッカー UI は 13-3 以降。
    CONFIG.Combat.documentClass = TnxCombat;
    CONFIG.Combatant.documentClass = TnxCombatant;
    // カット進行のサイドバートラッカー(13-4)。既定のコンバットトラッカーを上書きする。
    CONFIG.ui.combat = TnxCombatTracker;

    // Actor DataModel の登録(全 Actor type)
    CONFIG.Actor.dataModels = {
      cast:   CastDataModel,
      guest:  GuestDataModel,
      troop:  TroopDataModel,
      extra:  ExtraDataModel,
    };

    // Item DataModel の登録(B-7b: styleSkill 追加、全 17 type 登録完了)
    CONFIG.Item.dataModels = {
      housingArea:  HousingAreaDataModel,
      organization: OrganizationDataModel,
      lifePath:     LifePathDataModel,
      armor:        ArmorDataModel,
      cyborg:       CyborgDataModel,
      combiner:     CombinerDataModel,
      general:      GeneralDataModel,
      ianus:        IanusDataModel,
      tron:         TronDataModel,
      vehicle:      VehicleDataModel,
      weapon:       WeaponDataModel,
      tap:          TapDataModel,
      residence:    ResidenceDataModel,
      miracle:      MiracleDataModel,
      generalSkill: GeneralSkillDataModel,
      style:        StyleDataModel,
      styleSkill:   StyleSkillDataModel,
    };

    // Card DataModel の登録(B-8: 全 3 type 登録完了)
    CONFIG.Card.dataModels = {
      playingCards: PlayingCardsDataModel,
      neuroCards:   NeuroCardsDataModel,
      other:        OtherDataModel,
    };

    // システム用のCONFIG名前空間を準備
    CONFIG.TNX = {};

    // フェイズのキーと、対応する翻訳キー（または直接の日本語名）を定義
    CONFIG.TNX.phaseLabels = {
        opening: "オープニング",
        research: "リサーチ",
        climax: "クライマックス",
        ending: "エンディング"
    };

    // トーキョーN◎VA の状態(BS・戦闘不能・負傷)を CONDITION_KINDS から生成する(フェーズ9-4)。
    // id = conditionKind。flags に conditionKind を持たせ、貼付時に condition として認識させる。
    // 順は CONDITION_KINDS の統合順(BS→戦闘不能→肉体→精神→社会)。効果値はインスタンス毎に詳細タブで設定。
    // hideFromList: トークン右クリック「ステータス効果の設定」からの付与でも、ダメージ適用と同様に
    // バッジのみ追加しシートのアクティブエフェクト一覧には行を出さない(2026-07-11 ユーザー確定)
    CONFIG.statusEffects = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
        id,
        name: conditionDisplayName(id),
        img:  def.img ?? "icons/svg/aura.svg",
        flags: { [SYSTEM_ID]: { conditionKind: id, hideFromList: true } },
    }));

    // トークンリソースバーの割当候補(フェーズ11-4)。トループの heads=人数/エニグマポイントが
    // HP のように機能する(Troops.md)。他 type はチャート式ダメージのためバー非対応。
    CONFIG.Actor.trackableAttributes = {
        troop: { bar: ["heads"], value: [] },
    };
    
    // Actor Sheetの登録
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaCastSheet, {
        types: ["cast"],
        makeDefault: true,
        label: "プロファイルシート"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaGuestSheet, {
        types: ["guest"],
        makeDefault: true,
        label: "プロファイルシート（ゲスト）"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaTroopSheet, {
        types: ["troop"],
        makeDefault: true,
        label: "プロファイルシート（トループ）"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaExtraSheet, {
        types: ["extra"],
        makeDefault: true,
        label: "プロファイルシート（エキストラ）"
    });

    // Item Sheetの登録
    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaStyleSheet, {
        types: ["style"],
        makeDefault: true,
        label: "スタイルシート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaMiracleSheet, {
        types: ["miracle"],
        makeDefault: true,
        label: "神業シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaGeneralSkillSheet, {
        types: ["generalSkill"],
        makeDefault: true,
        label: "一般技能シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaStyleSkillSheet, {
        types: ["styleSkill"],
        makeDefault: true,
        label: "スタイル技能シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaOrganizationSheet, {
        types: ["organization"],
        makeDefault: true,
        label: "組織シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaLifePathSheet, {
        types: ["lifePath"],
        makeDefault: true,
        label: "ライフパスシート"
    });

    // アウトフィット共通シート(フェーズ6-1〜)。型ごとの差分はシート内の
    // type 判定(サマリ構成・固有フィールドセット)で吸収する。
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaOutfitSheet, {
        types: ["general", "weapon", "armor", "cyborg", "ianus", "tron", "tap",
                "vehicle", "residence", "combiner"],
        makeDefault: true,
        label: "アウトフィットシート"
    });

    // 住宅エリア専用シート(アウトフィットではなく住宅施設への修正値の集合)
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaHousingAreaSheet, {
        types: ["housingArea"],
        makeDefault: true,
        label: "住宅エリアシート"
    });

    // Journal Sheetの登録
    foundry.documents.collections.Journal.registerSheet("tokyo-nova", TnxScenarioSheet, {
        makeDefault: false,
        label: "アクトシート",
    });

    // FS判定シート(フェーズ12-5): JournalEntryPage 型 focusSystem の専用シート
    // FS判定シート(2026-07-21 是正): JournalEntry のシート。JournalEntry はサブタイプを
    // 持てないため、アクトシートと同じく「選択可能なシート＋flags」で表す
    foundry.documents.collections.Journal.registerSheet("tokyo-nova", TnxFocusSystemSheet, {
        makeDefault: false,
        label: "FS判定シート",
    });

    // ドロー表: コア RollTable のカードドロー拡張（シート置換なし・フック注入のみ）
    registerDrawTableHooks();

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

    // プレイヤーリストの右クリックメニューに「レコードシートを開く」を追加する。
    // 自分の分は全員、他人の分は GM のみ表示。
    Hooks.on("getUserContextOptions", (_html, options) => {
        options.push({
            name: "レコードシートを開く",
            icon: '<i class="fas fa-id-card"></i>',
            condition: (li) => {
                const el = li instanceof Element ? li : li[0];
                const userId = el?.dataset?.userId ?? el?.dataset?.documentId;
                if (!userId) return false;
                return game.user.isGM || userId === game.user.id;
            },
            callback: (li) => {
                const el = li instanceof Element ? li : li[0];
                const userId = el?.dataset?.userId ?? el?.dataset?.documentId;
                if (!userId) return;
                const user = game.users.get(userId);
                if (!user) return;
                // 既に開いていれば最前面に出す
                const appId = `tnx-record-sheet-${user.id}`;
                const existing = foundry.applications?.instances?.get(appId);
                if (existing) { existing.bringToFront(); return; }
                new TnxRecordSheet(user).render(true);
            },
        });
    });

    // 判定・ダメージへの特殊処理の正規の置き場=チャットカードの右クリックメニュー(GM のみ表示・
    // 2026-07-14 ユーザー確定)。用途フラグ(再判定を付与/判定を修正/ダメージを修正)のアイテムロールは
    // 同じ内部機能への例外的な外部アクセス(クリック待ち経由=メニュー不要)。
    // ※登録は init で行う: ChatLog のコンテキストメニューは ready 発火前のサイドバー描画時に
    // 構築されるため、ready 内の登録では間に合わない(実機で項目が出ず 2026-07-14 修正)
    Hooks.on("getChatMessageContextOptions", (_app, options) => {
        const msgOf = (li) => {
            const el = li instanceof Element ? li : li[0];
            return game.messages.get(el?.dataset?.messageId);
        };
        options.push(
            {
                name: "再判定（この判定をやり直す）",
                icon: '<i class="fas fa-rotate-right"></i>',
                condition: (li) => {
                    if (!game.user.isGM) return false;
                    const m = msgOf(li);
                    return !!m?.getFlag(SYSTEM_ID, "checkRecheck") && !TnxCheckFlow.recheckBlockReason(m);
                },
                callback: (li) => TnxCheckFlow.startRecheck(msgOf(li)),
            },
            {
                name: "達成値を修正（手動）",
                icon: '<i class="fas fa-pen"></i>',
                // スナップショット持ちのカードに限る: 継続処理系(移動/治療等)は達成値だけ書き換えると
                // 適用済みの帰結と乖離し、事後修正のライブ描画もスナップショット持ちでしか動かない
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SYSTEM_ID, "checkRecheck"),
                callback: (li) => TnxCheckFlow.manualEditAchievement(msgOf(li)),
            },
            {
                name: "ダメージを修正（手動）",
                icon: '<i class="fas fa-burst"></i>',
                // 達成値の手動修正と同じ最終裁定ツール=適用済みでも制限しない(2026-07-14 ユーザー確定)
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SYSTEM_ID, "damageRoll"),
                callback: async (li) => {
                    await manualEditDamage(msgOf(li));
                },
            },
            {
                name: "ダメージ処理をリセット",
                icon: '<i class="fas fa-rotate-left"></i>',
                // 攻撃カードの damageRolled を戻し「ダメージカードを出す」ボタンを復活させる=算出の
                // やり直し(2026-07-14 ユーザー確定)。出済みのダメージカードは残る(整理は手動)。
                // タイミング系ゲート(再判定・事後修正)もリセット後は自然に再び開く
                condition: (li) => {
                    if (!game.user.isGM) return false;
                    const f = msgOf(li)?.getFlag(SYSTEM_ID, "attackCheck");
                    return !!f && f.damageRolled === true;
                },
                callback: async (li) => {
                    await applyAttackPatch(msgOf(li), { damageRolled: false });
                    ui.notifications.info("ダメージ処理をリセットしました（出済みのダメージカードは必要に応じて削除してください）。");
                },
            },
        );
    });

    // v13: 標準ボタン行(header-actions)の直後に「アクトシートを作成」ボタンを 2 段目として挿入する。
    Hooks.on("renderJournalDirectory", (app, html) => {
        if (!game.user.isGM) return;

        const createEntryButton = html.querySelector('[data-action="createEntry"]');
        if (!createEntryButton) return;

        /** シートクラスを指定してジャーナルを作り、開く。 */
        const makeCreateButton = (label, icon, className, name, sheetClass, extraFlags = {}) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>`;
            button.addEventListener('click', async () => {
                const newJournal = await JournalEntry.create({
                    name,
                    flags: { core: { sheetClass }, ...extraFlags },
                });
                newJournal?.sheet.render(true);
            });
            return button;
        };

        // .action-buttons 内に追加し、flex-wrap で 2 段目に折り返させる（幅が自動で揃う）
        const actionsRow = createEntryButton.closest('.action-buttons') ?? createEntryButton.parentElement;
        actionsRow.style.flexWrap = 'wrap';
        actionsRow.appendChild(makeCreateButton(
            'アクトシートを作成', 'fa-file-medical', 'tnx-create-act-button',
            '新規アクトシート', `tokyo-nova.${TnxScenarioSheet.name}`,
        ));
        // FS判定シート: 空の設定フラグを入れて作る(これが「FS判定シートである」印になり、
        // 起動フォームの読み込み元の絞り込みに使われる)
        actionsRow.appendChild(makeCreateButton(
            'FS判定シートを作成', 'fa-bullseye', 'tnx-create-act-button',
            '新規FS判定', `tokyo-nova.${TnxFocusSystemSheet.name}`,
            { [FOCUS_SYSTEM_FLAG.scope]: { [FOCUS_SYSTEM_FLAG.key]: defaultFocusSystemData() } },
        ));
    });

    Hooks.on("preCreateActor", (actor, data, options, userId) => {
        // guest はセッション履歴以外キャストとデータ的に同一(フェーズ11-3)のため、部位プリセットも流し込む
        if (data.type !== "cast" && data.type !== "guest") return;

        // 部位スロット集合: 未設定なら全アクター共通プリセットを流し込む(フェーズ10)
        const hasPartSlots = Array.isArray(data.system?.partSlots) && data.system.partSlots.length > 0;
        if (!hasPartSlots) {
            const preset = getPartSlotPreset();
            if (preset.length) {
                actor.updateSource({ "system.partSlots": foundry.utils.deepClone(preset) });
            }
        }

        // 以下の所有権設定はキャスト(プレイヤー作成)のみ。ゲストは RL の持ち物のため既定のまま
        if (data.type !== "cast") return;

        const ownership = data.ownership || {};
        ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        const user = game.users.get(userId);
        if (user && !user.isGM) {
            ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        } else {
            ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
        }
        actor.updateSource({ ownership: ownership });
    });

    /**
     * アイテム作成時の権限設定
     * GMでないユーザーが作成した場合、オーナー権限を付与する
     */
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        // 一般技能がエキストラ直下に作られる場合(辞典インポート・ドロップ等の全経路)、
        // エキストラは固定値判定しか行えないため、元データの「判定」等の固定値以外の用途を
        // 自動削除し、固定値用途が無ければ自動追加する(2026-07-04 確定)
        if (data.type === "generalSkill" && item.parent?.type === "extra") {
            const original = data.system?.actions ?? [];
            const kept = original.filter(a => a.type === "check" && Number.isFinite(a.fixedResult));
            if (!kept.length) {
                kept.push({
                    _id:             foundry.utils.randomID(),
                    type:            "check",
                    // 用途名の既定は空(2026-07-17): 実効名=親アイテム名
                    name:            "",
                    description:     "",
                    timing:          { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
                    target:          "blank",
                    effects:         [],
                    skillRefs:       [],
                    weaponRefs:      [],
                    damageType:      "",
                    checkBonuses:    [],
                    damageBonuses:   [],
                    fixedResult:     10,
                });
            }
            item.updateSource({ "system.actions": kept });
            return;
        }

        // 一般技能: 用途が未設定の場合に「判定」用途を1件自動挿入する
        // baseSkillRef には親アイテム自身の ID を設定する（用途が判定の起点技能を明示的に保持）
        if (data.type === "generalSkill" && !(data.system?.actions?.length)) {
            item.updateSource({
                "system.actions": [{
                    _id:             foundry.utils.randomID(),
                    type:            "check",
                    // 用途名の既定は空(2026-07-17): 実効名=親アイテム名
                    name:            "",
                    description:     "",
                    timing:          { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
                    target:          "blank",
                    effects:         [],
                    baseSkillRef:    { itemId: item._id ?? "" },
                    skillRefs:       [],
                    weaponRefs:      [],
                    damageType:      "",
                    checkBonuses:    [],
                    damageBonuses:   [],
                    // 消費既定は空(2026-07-17 ユーザー指示=無条件の「親×1」既定行は全廃)
                    consumeTargets:  [],
                }],
            });
        }

        // 作成者がGMの場合はデフォルト処理に任せる（通常はOwnerになる）
        const user = game.users.get(userId);
        if (user && user.isGM) return;

        // 既存の権限設定を取得、または初期化
        const ownership = data.ownership || {};

        // 作成者にオーナー権限(3)を付与
        ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

        // FVTT v12 API: updateSourceを使用して更新
        item.updateSource({ ownership: ownership });
    });

    Hooks.on("preCreateCard", (card) => {
        const parentPile = card.parent;

        // 既存の切り札上限チェック処理
        if (!parentPile || !parentPile.getFlag(SYSTEM_ID, "isTrumpPile")) {
            return true;
        }
        if (parentPile.cards.size >= 1) {
            ui.notifications.warn("切り札置き場はすでにいっぱいです。");
            return false;
        }
        return true;
    });

    Hooks.on("createActor", async (actor, options, userId) => {
        // 自身が作成したアクターのみ対象
        if (userId !== game.user.id) return;
    
        // キャストの場合：ダイアログで確認せずに手札作成は行わない
        if (actor.type === "cast") {
            // デフォルト設定の更新
            await actor.update({
                "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                "prototypeToken.actorLink": true,
                "prototypeToken.sight.enabled": true,
                "prototypeToken.sight.range": 1000
            });
            setupDefaultSkills(actor);
        }

        // ゲスト: 名前あり NPC＝リンクトークン。基本13技能もキャスト同様に流し込む(フェーズ11-3。
        // disposition は敵味方が場合によるため既定のまま)
        if (actor.type === "guest") {
            await actor.update({ "prototypeToken.actorLink": true });
            setupDefaultSkills(actor);
        }

        // トループ: heads(人数/エニグマポイント)をリソースバーへ既定割当(フェーズ11-4)。
        // 判定はキャストと同じため基本13技能も流し込む。トークンは非リンク既定(複数部隊を並べる)
        if (actor.type === "troop") {
            await actor.update({
                "prototypeToken.bar1.attribute": "heads",
                "prototypeToken.displayBars": CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
            });
            // 分身は本体からの再同期で全アイテムを写すため 13 技能を流し込まない(2026-07-08 修正。
            // 非同期シードが再同期(全削除→コピー)の後に着地して二重取得になる競合の防止)
            if (actor.system.troopMode !== "bunshin") setupDefaultSkills(actor);
        }

        // エキストラ: 名前ありの端役＝リンクトークン。基本は名前のみのため技能は流し込まない(フェーズ11-5)
        if (actor.type === "extra") {
            await actor.update({ "prototypeToken.actorLink": true });
        }
    });

    // **同期のフックにする**: Foundry の pre 系フックは戻り値を同期で見るため、async にすると
    // `return false` が Promise になり削除を止められない。止めたつもりの削除がそのまま通り、
    // 後から届く update が「もう無い文書」に当たってサーバがエラーを返していた(KI-051・2026-09-05)。
    // 中で必要な非同期処理は投げっぱなしにする(止める判断は同期で済ませてから行う)。
    Hooks.on("preDeleteItem", (item) => {
        if (item.type === "miracle" && item.actor) {
            // 母数(uses.max)が2以上なら削除でなく-1(多重取得の1つを外す)。2026-07-18 uses 一本化
            const update = miracleRemovalUpdate(item.system);
            if (update) {
                item.update(update);   // 削除は下で止めるので、この更新は投げっぱなしでよい
                ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                return false;
            }
        }
        if (item.type === "style" && item.actor) {
            // 対応する神業を1つだけ削除する(このフックはレベル1のスタイル削除時にのみ動作する想定)。
            // スタイルの削除自体は止めないので、非同期の後始末として流す
            const miracleUuid = item.system.miracle?.id;
            const actor = item.actor;
            const styleName = item.name;
            if (miracleUuid) {
                (async () => {
                    try {
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const itemToDelete = actor.items.find(i => i.type === "miracle" && i.name === sourceMiracle.name);
                        if (!itemToDelete) return;
                        await itemToDelete.delete();
                        ui.notifications.info(`スタイル「${styleName}」の削除に伴い、神業「${itemToDelete.name}」を1つ削除しました。`);
                    } catch (e) {
                        console.error(`TokyoNOVA | Error deleting associated Divine Work for style ${styleName}:`, e);
                    }
                })();
            }
            return true;
        }
    });

    // pre 系は同期(理由は preDeleteItem のコメント)。非同期の連動は中の IIFE で流す
    Hooks.on("preUpdateItem", (item, changes) => {
        // スタイルアイテム以外の更新は無視 (既存の処理)
        if (item.type === "style" && item.actor) {
            const oldLevel = item.system.level || 1;
            const newLevel = foundry.utils.getProperty(changes, "system.level");
    
            // レベル変更時の神業母数(uses.max)連動(2026-07-18 uses 一本化):
            // 母数 = 連動スタイルの合計レベル(上限3・「母数=スタイルレベルと同一」ユーザー確定)。
            // 万能神業(ファイト！等)による増加は AE で uses.max に乗る(ここでは基礎値のみ維持)——
            // AE は実効値 uses.maxTotal へ着地する(2026-08-09・KI-038 で着地点を新設)。
            if (newLevel !== undefined && newLevel !== oldLevel) {
                (async () => {
                    try {
                        const miracleUuid = item.system.miracle?.id;
                        if (!miracleUuid) return;
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const existingMiracle = item.actor.items.find(i => i.type === 'miracle' && i.name === sourceMiracle.name);
                        if (!existingMiracle) return;

                        // 連動スタイル(同じ神業を指す)の合計レベル(更新中は newLevel を使う)→ 上限3
                        const allLinkedStyles = item.actor.items.filter(i => i.type === 'style' && i.system.miracle?.id === miracleUuid);
                        const totalStyleLevel = allLinkedStyles.reduce((sum, s) =>
                            sum + (s.id === item.id ? newLevel : (s.system.level || 1)), 0);
                        const newMax = Math.max(1, Math.min(3, totalStyleLevel));
                        const curMax = usesMaxBaseOf(existingMiracle.system);
                        if (newMax !== curMax) {
                            const spent = Math.min(Number(existingMiracle.system.uses?.spent) || 0, newMax);
                            await existingMiracle.update({ "system.uses.max": String(newMax), "system.uses.spent": spent });
                            ui.notifications.info(`神業「${existingMiracle.name}」の母数を${newMax > curMax ? "+" : "-"}1しました。`);
                        }
                    } catch (e) { console.error(`TokyoNOVA | Error updating Divine Work usage count:`, e); }
                })();

                // レベルが3になったら、役割を「ペルソナ」「キー」に強制設定
                if (newLevel === 3) {
                    foundry.utils.setProperty(changes, "system.isPersona", true);
                    foundry.utils.setProperty(changes, "system.isKey", true);
                } 
                // レベルが3から下がったら、役割を「シャドウ」にリセット
                else if (oldLevel === 3 && newLevel < 3) {
                    foundry.utils.setProperty(changes, "system.isPersona", false);
                    foundry.utils.setProperty(changes, "system.isKey", false);
                }
            }
        }
    });

    /**
     * Cardの子ドキュメントが作成された際にUIを更新するフック。
     * カードが手札や捨て札に移動した（描画された、プレイされた）場合などに作動します。
     */
    // GM 専用: シーンコントロールに「判定要求」ボタンを追加（フェーズ 8-5）
    // V13: controls は配列ではなくグループ名をキーとするオブジェクト
    // FS判定パネルは**全員**に出す(PL の参照手段を兼ねる・2026-07-20 ユーザー指示)
    Hooks.on("getSceneControlButtons", (controls) => {
        let tokenGroup;
        if (Array.isArray(controls)) {
            tokenGroup = controls.find(c => c.name === "tokens" || c.name === "token");
        } else if (controls instanceof Map) {
            tokenGroup = controls.get("tokens") ?? controls.get("token");
        } else {
            tokenGroup = controls?.["tokens"] ?? controls?.["token"];
        }
        if (!tokenGroup) return;
        // 全員可視のパネル起動ボタン: シナリオコントロール(14-3)・FS判定(12-5)
        const panelTools = [
            {
                name:    "tnxScenarioControl",
                title:   "シナリオコントロール",
                icon:    "fas fa-film",
                button:  true,
                onChange: () => openScenarioPanel(),
                visible: true,
            },
            {
                name:    "tnxFocusSystem",
                title:   "FS判定",
                icon:    "fas fa-bullseye",
                button:  true,
                onChange: () => openFocusSystemPanel(),
                visible: true,
            },
        ];
        const tools = tokenGroup.tools;
        for (const tool of panelTools) {
            if (Array.isArray(tools)) tools.push(tool);
            else if (tools instanceof Map) tools.set(tool.name, tool);
            else if (tools && typeof tools === "object") tools[tool.name] = tool;
            else tokenGroup.tools = { [tool.name]: tool };
        }
    });

    // シナリオコントロールパネルと HUD の情報項目(14-9)の表示は台本(アクトシートのフラグ)に
    // 追随する(14-3)。実行状態(sessionState)の変化は設定の onChange が再描画する。
    Hooks.on("updateJournalEntry", (doc) => {
        if (doc.id && doc.id === getSessionState().actId) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });

    // 登場状態(Actor フラグ)の変化にパネルの「登場中」表示・チームのゲートを追随させる(14-5)。
    // 名前の非公開(14-8)も同じ一覧の表示を変えるため同じ購読に乗せる。
    // 担当キャラクターのゴースト切替は HUD のステータス表示(14-7)にも反映する
    Hooks.on("updateActor", (actor, changes) => {
        const f = changes.flags?.[SYSTEM_ID];
        const appearanceKeys = ["appearing", "-=appearing", "appearingHidden", "-=appearingHidden"];
        // ゴースト切替(2026-08-22)はチップのトグル表示を変えるため、パネルも追随させる
        if ((f && appearanceKeys.some(key => key in f)) || changes.system?.isGhost !== undefined) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
        }
        // HUD のステータス表示(自分+参加者パネル)は担当キャラクターの登場状態・ゴーストにも
        // 依存するため、担当キャラクターであれば誰のものでも HUD を追随させる
        if ((changes.system?.isGhost !== undefined || (f && appearanceKeys.some(key => key in f)))
            && game.users.some(u => u.character?.id === actor.id)) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });

    // HUD のステータス表示(14-7)・参加者パネルの追随: シーンプレイヤー(User flag)・
    // 手札の割り当て変更はどのユーザーの分でも HUD に映る
    Hooks.on("updateUser", (user, changes) => {
        if (changes.flags?.[SYSTEM_ID]) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });
    // 参加者パネルは接続中ユーザーのみ並べるため、入退室でも HUD を追随させる
    Hooks.on("userConnected", () => {
        foundry.applications.instances.get("tnx-hud")?.render(false);
    });
    for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
        Hooks.on(hook, (effect) => {
            if (effect.parent?.id && game.users.some(u => u.character?.id === effect.parent.id)) {
                foundry.applications.instances.get("tnx-hud")?.render(false);
            }
        });
    }

    // 登場状態 ⇄ アクティブ盤面のトークン存在の双方向同期(2026-08-23 改修: 登場=トークン
    // 配置・退場=トークン削除・ゴースト=不可視。フラグ→トークンは activeGM が代行)
    registerAppearanceTokenSync();

    // 時間境界の購読=失効・リセット・回復の適用本体(15-1)。13-6/14-2 が発火してきた
    // 境界イベントに、ここで初めて購読者が付く(適用は activeGM のみ)
    registerTimeBoundaries();

    // 逮捕令状(社会17)の適用=チーム離脱→退場→登場不可の期限(15-7・activeGM のみ)
    registerForcedExitWounds();

    // サブシーンの表示はドキュメントを書き換えず、クライアント側で背景テクスチャを差し替える
    // (14-4 是正・シーン読み込みを走らせない)。適用フラグの更新(updateScene)と canvasReady で
    // 再適用し、パネルの「適用中」表示も追随させる
    Hooks.on("updateScene", (scene) => {
        foundry.applications.instances.get("tnx-subscene-panel")?.render(false);
        if (scene.id === canvas?.scene?.id) refreshSubSceneBackground();
    });
    Hooks.on("canvasReady", () => refreshSubSceneBackground());

    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        // V13: controls はグループ名をキーとするオブジェクト（キーは複数形）
        // V12 以前: 配列
        let tokenGroup;
        if (Array.isArray(controls)) {
            tokenGroup = controls.find(c => c.name === "tokens" || c.name === "token");
        } else if (controls instanceof Map) {
            tokenGroup = controls.get("tokens") ?? controls.get("token");
        } else {
            tokenGroup = controls?.["tokens"] ?? controls?.["token"];
        }
        if (!tokenGroup) return;
        const newTools = {
            tnxCheckRequest: {
                name:    "tnxCheckRequest",
                title:   "判定要求",
                icon:    "fas fa-cards",
                button:  true,
                onChange: () => new TnxRlRequestApp().render(true),
                visible: true,
            },
            // RL 任意ダメージ付与(フェーズ12・2026-07-20): 判定を経由しないギミックのダメージ。
            // 対象はレティクルで明示する
            tnxGrantDamage: {
                name:    "tnxGrantDamage",
                title:   "ダメージ付与",
                icon:    "fas fa-burst",
                button:  true,
                onChange: () => openRlGrantDamage(),
                visible: true,
            },
            // RL 任意の状態・効果付与(フェーズ12・2026-07-20)
            tnxGrantEffect: {
                name:    "tnxGrantEffect",
                title:   "状態・効果の付与",
                icon:    "fas fa-hand-sparkles",
                button:  true,
                onChange: () => openRlGrantEffect(),
                visible: true,
            },
            // 報酬点の配布(前金・フェーズ12・2026-07-20。負数で没収)
            tnxGrantBounty: {
                name:    "tnxGrantBounty",
                title:   "報酬点の配布",
                icon:    "fas fa-coins",
                button:  true,
                onChange: () => openRlGrantBounty(),
                visible: true,
            },
            // サブシーン(フェーズ14-4): 名前付き盤面状態の保存・切替(RL 専用の道具)
            tnxSubScenes: {
                name:    "tnxSubScenes",
                title:   "サブシーン",
                icon:    "fas fa-images",
                button:  true,
                onChange: () => openSubScenePanel(),
                visible: true,
            },
        };
        const tools = tokenGroup.tools;
        for (const [key, tool] of Object.entries(newTools)) {
            if (Array.isArray(tools)) {
                tools.push(tool);
            } else if (tools instanceof Map) {
                tools.set(key, tool);
            } else if (tools && typeof tools === "object") {
                tools[key] = tool;
            } else {
                tokenGroup.tools = { ...(tokenGroup.tools ?? {}), [key]: tool };
            }
        }
    });

    Hooks.on("createCard", () => refreshSheetsSoon());

    /**
     * Cardの子ドキュメントが削除された際にUIを更新するフック。
     * カードが山札や手札から移動した（描画された、プレイされた）場合などに作動します。
     */
    Hooks.on("deleteCard", () => refreshSheetsSoon());
});

Hooks.once("ready", async function() {
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

});
// ─── CS・AR のカット進行連動(フェーズ10-5 / 11 → 13-2〜13-4 で TnxCombat へ集約) ─────
// シートの「CS」「AR」表示は自動制御(カット進行中=カレント・現在AR/それ以外=CS・付与値)。
// カット進行の終了・参加/離脱で該当アクターを再準備(reset)し、開いているシートを再描画する。
// カット進行の開始は TnxCombat.startCombat の override が一括処理する(core の combatStart フックは
// update の**前**に発火するため、フック内からの別 update は本体更新に上書きされ競合する＝実機で発覚。
// フェーズ状態・turn・シードを単一フローにまとめた)。
// 以後の進行はサブターンモデル(nextTurn 1本=advanceCut・トラッカー UI から起動)。
// 途中参加(createCombatant)は開始済みカットへの参加としてそのアクターだけシードする。

// round の変わる combat 更新(カット進行の開始・次カット)で全クライアントのアクターを再準備する。
// core の updateCombatantActors は render のみで派生(inCombat)を再計算しないため、開始前に
// シードされた値の表示切替(CS=カレント表示・AR 数値表示)がここで追随する
Hooks.on("updateCombat", (combat, changed) => {
    if ("round" in (changed ?? {})) {
        TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
    }
});

Hooks.on("deleteCombat", (combat) => {
    TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
});

Hooks.on("createCombatant", async (combatant) => {
    if (!combatant.parent?.started || !combatant.actor) return;
    await TnxCombat.seedStartValues([combatant.actor]);
    TnxCombat.refreshDisplays([combatant.actor]);
});

Hooks.on("deleteCombatant", (combatant) => {
    if (combatant.actor) TnxCombat.refreshDisplays([combatant.actor]);
});
