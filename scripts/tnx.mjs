import { TokyoNovaCastSheet } from './actor/tnx-cast-sheet.mjs';
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
import { TokyoNovaStyleSheet } from './item/tnx-style-sheet.mjs';
import { TokyoNovaMiracleSheet } from './item/tnx-miracle-sheet.mjs';
import { TokyoNovaGeneralSkillSheet } from './item/tnx-general-skill-sheet.mjs';
import { TokyoNovaStyleSkillSheet } from './item/tnx-style-skill-sheet.mjs';
import { TokyoNovaOrganizationSheet } from './item/tnx-organization-sheet.mjs';
import { TnxScenarioSheet } from './journal/tnx-scenario-sheet.mjs';
import { TnxActionHandler } from './module/tnx-action-handler.mjs';
import { TnxHud } from './module/tnx-hud.mjs';
import { TnxRecordSheet } from './module/tnx-record-sheet.mjs';
import { recordCastOwnerUser } from './module/cast-ownership.mjs';
import { getUserFlagData, calcHistoryExpTotal, TNX_FLAG_SCOPE } from './module/user-flag-schema.mjs';
import { calcSharedSpent, buildCastHistorySyncUpdate, mergeHistories, separateHistoryByOrigin } from './module/exp-sync.mjs';

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

        // === Journal Sheets ===
        "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",

        // === Chat ===
        "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs",

        // === Dialogs ===
        "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deck-creation-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/rich-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/unlink-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/usage-creation-dialog.hbs",

        // === Partials ===
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs",
        "systems/tokyo-nova-axleration/templates/parts/history-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/usage-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/bad-status-list.hbs",

        // === User Sheets ===
        "systems/tokyo-nova-axleration/templates/user/record-sheet.hbs",
    ];
    return loadTemplates(templatePaths);
}

async function setupDefaultSkills(actor) {
    try {
        // system.jsonで定義したパック名 "system-id.pack-name"
        const packId = "tokyo-nova-axleration.general-skills";
        const pack = game.packs.get(packId);

        if (!pack) {
            console.warn(`TokyoNOVA | General skills pack '${packId}' not found.`);
            return;
        }

        // パック内の全ドキュメントを取得
        const documents = await pack.getDocuments();
        if (documents.length === 0) return;

        // アクターに埋め込むためのデータオブジェクト配列を作成
        // toObject() でIDをリセットして新規アイテムとして扱えるようにする
        const itemsData = documents.map(doc => doc.toObject());
        console.log(itemsData);

        // アクターにアイテムを一括作成
        await actor.createEmbeddedDocuments("Item", itemsData);
        
        console.log(`TokyoNOVA | Imported ${itemsData.length} default skills to ${actor.name}.`);
        ui.notifications.info(`${actor.name} に初期技能を ${itemsData.length} 個インポートしました。`);

    } catch (err) {
        console.error(`TokyoNOVA | Error importing default skills for ${actor.name}:`, err);
    }
}

/**
 * [All Clients] 開かれている関連シートを全て再描画する
 */
function handleRefreshSheets() {
    console.log("TokyoNOVA | Refresh request received by client.");
    // game.tnx.hudが存在し、かつ閉じられていない場合に再描画
    if (game.tnx?.hud && !game.tnx.hud._closed) {
        game.tnx.hud.render(true);
    }
    for (const app of Object.values(ui.windows)) {
        if (!app._closed) {
            app.render(true);
        }
    }
}

/**
 * ownerUserId に紐づく全キャストの消費経験点を集計し、User flag の EXP データを更新する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {User} ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function syncCastExpToUser(ownerUser) {
    const linkedCasts = game.actors.filter(
        a => a.type === 'cast' && a.system.ownerUserId === ownerUser.uuid && a.system.syncWithOwner
    );

    const castExpList = linkedCasts.map(a => ({
        spent:      Number(a.system.exp?.spent)      || 0,
        additional: Number(a.system.exp?.additional) || 0,
    }));

    const newSpent = calcSharedSpent(castExpList);
    const { exp: { total: currentTotal, spent: currentSpent } } = getUserFlagData(ownerUser);

    if (currentSpent === newSpent) return;

    await ownerUser.update({
        [`flags.${TNX_FLAG_SCOPE}.exp.spent`]: newSpent,
        [`flags.${TNX_FLAG_SCOPE}.exp.value`]: currentTotal - newSpent,
    }, { syncing: true });
}

/**
 * ownerUserId が新規に記録された時点で、cast の history と User flag の history を
 * 双方向マージして両者を揃える初回同期を行う。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  cast タイプの Actor(ownerUserId 設定済み)
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function performInitialHistorySync(castActor, ownerUser) {
    if (!castActor.system.syncWithOwner) return;
    const castHistory = castActor.system.history ?? {};
    const { history: userHistory } = getUserFlagData(ownerUser);
    const mergedHistory = mergeHistories(castHistory, userHistory);
    const newTotal = calcHistoryExpTotal(mergedHistory);

    // User flag: merged history 全エントリ + exp.total を更新
    // syncing: true で updateUser フックのループを防ぐ
    const flagUpdate = { [`flags.${TNX_FLAG_SCOPE}.exp.total`]: newTotal };
    for (const [id, entry] of Object.entries(mergedHistory)) {
        flagUpdate[`flags.${TNX_FLAG_SCOPE}.history.${id}`] = entry;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // cast: system.history を merged に差分同期
    // syncing: true で updateActor フックのループを防ぐ
    const castHistoryUpdate = buildCastHistorySyncUpdate(castActor.system.history, mergedHistory);
    if (!foundry.utils.isEmpty(castHistoryUpdate)) {
        await castActor.update(castHistoryUpdate, { calcExp: false, syncing: true });
    }

    // exp.spent / exp.value を User flag に反映(syncCastExpToUser は syncing: true で書く)
    await syncCastExpToUser(ownerUser);

    // cast の exp.total / spent / value を User flag の新しい total に基づいて更新
    await TokyoNovaCastSheet.updateCastExp(castActor);
}

/**
 * syncWithOwner が ON→OFF になった際に、cast と User flag から相互の由来エントリを除去する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  同期を切った cast タイプの Actor
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function performUnsyncSeparation(castActor, ownerUser) {
    const castUuid = castActor.uuid;

    // cast から User 由来(origin !== castUuid)のエントリを削除
    const castHistory = castActor.system.history ?? {};
    const { ownedByOther: castForeignEntries } = separateHistoryByOrigin(castHistory, castUuid);
    const castUpdate = {};
    for (const id of Object.keys(castForeignEntries)) {
        castUpdate[`system.history.-=${id}`] = null;
    }
    if (!foundry.utils.isEmpty(castUpdate)) {
        await castActor.update(castUpdate, { calcExp: false, syncing: true });
    }

    // User flag からこの cast 由来(origin === castUuid)のエントリを削除
    const { history: userHistory } = getUserFlagData(ownerUser);
    const { ownedByOrigin: castEntriesInUser, ownedByOther: remainingUserHistory } = separateHistoryByOrigin(userHistory, castUuid);
    const newTotal = calcHistoryExpTotal(remainingUserHistory);
    const flagUpdate = { [`flags.${TNX_FLAG_SCOPE}.exp.total`]: newTotal };
    for (const id of Object.keys(castEntriesInUser)) {
        flagUpdate[`flags.${TNX_FLAG_SCOPE}.history.-=${id}`] = null;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // 分離後の EXP 再集計(sync 中の他キャスト分のみが残る)
    await syncCastExpToUser(ownerUser);
    await TokyoNovaCastSheet.updateCastExp(castActor);

    // ownerUser の update は syncing:true で行うため updateUser フックの再描画が
    // スキップされる。由来分離完了後に明示的に再描画する。
    const recordSheet = foundry.applications?.instances?.get(`tnx-record-sheet-${ownerUser.id}`);
    if (recordSheet?.rendered) recordSheet.render();
}

Hooks.once("init", async function() {
    game.tnx = game.tnx || {}
    game.tnx.refreshSheets = handleRefreshSheets;
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;

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

    // トーキョーN◎VA バッドステータス定義
    // id: システム内部で使うID, label: 表示名
    CONFIG.statusEffects = [
        { id: "panic", name: "恐慌", img: "icons/svg/terror.svg" },
        { id: "poison", name: "邪毒", img: "icons/svg/poison.svg" },
        { id: "pressure", name: "重圧", img: "icons/svg/down.svg" },
        { id: "weakness", name: "衰弱", img: "icons/svg/degen.svg" },
        { id: "capture", name: "捕縛", img: "icons/svg/net.svg" },
        { id: "doped-major", name: "酩酊(大)", img: "icons/svg/daze.svg" },
        { id: "doped-minor", name: "酩酊(小)", img: "icons/svg/sleep.svg" },
        { id: "confusion", name: "狼狽", img: "icons/svg/explosion.svg" },
        { id: "fear", name: "萎縮", img: "icons/svg/cowled.svg" }, // User specified 'Fear' for 萎縮
        { id: "hatred", name: "憎悪", img: "icons/svg/fire.svg" },
        { id: "interference", name: "電子妨害", img: "icons/svg/lightning.svg" }
    ];
    
    // Actor Sheetの登録
    Actors.unregisterSheet("core", ActorSheet);
    Actors.registerSheet("tokyo-nova", TokyoNovaCastSheet, {
        types: ["cast"],
        makeDefault: true,
        label: "プロファイルシート"
    });
    
    // Item Sheetの登録
    Items.unregisterSheet("core", ItemSheet);
    Items.registerSheet("tokyo-nova", TokyoNovaStyleSheet, {
        types: ["style"],
        makeDefault: true,
        label: "スタイルシート"
    });

    Items.registerSheet("tokyo-nova", TokyoNovaMiracleSheet, {
        types: ["miracle"],
        makeDefault: true,
        label: "神業シート"
    });

    Items.registerSheet("tokyo-nova", TokyoNovaGeneralSkillSheet, {
        types: ["generalSkill"],
        makeDefault: true,
        label: "一般技能シート"
    });

    Items.registerSheet("tokyo-nova", TokyoNovaStyleSkillSheet, {
        types: ["styleSkill"],
        makeDefault: true,
        label: "スタイル技能シート"
    });

    Items.registerSheet("tokyo-nova", TokyoNovaOrganizationSheet, {
        types: ["organization"],
        makeDefault: true,
        label: "組織シート"
    });

    // Journal Sheetの登録
    Journal.registerSheet("tokyo-nova", TnxScenarioSheet, {
        makeDefault: false,
        label: "アクトシート"
    });

    // --- システム設定の登録 ---
    game.settings.register("tokyo-nova-axleration", "defaultHandMaxSize", {
        name: "デフォルトの手札上限数",
        hint: "各ユーザーの手札上限の基本となる枚数を設定します。ユーザーが個別に設定していない場合、この値が適用されます。",
        scope: "world",
        config: true,
        type: Number,
        default: 4,
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "shuffleOnDeckReset", {
        name: "山札リセット時にシャッフル",
        hint: "山札のリセット（全回収）や捨て札の回収を行った際、自動的に山札をシャッフルします。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false // デフォルトはOFF
    });

    game.settings.register("tokyo-nova-axleration", "activeScenarioId", {
        name: "現在のアクトシート",
        hint: "HUDが自動でカード情報を読み込む対象のアクトシート（ジャーナル）を選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true,
    });

    game.settings.register("tokyo-nova-axleration", "autoLoadFromScenario", {
        name: "アクトシートから自動で読み込む",
        hint: "このチェックを入れると、上記で指定されたアクトシートから山札・捨て札の情報を自動で読み込みます。",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "cardDeckId", {
        name: "山札の登録",
        hint: "「自動で読み込む」のチェックを外した場合に、HUDが参照する山札（Cardsドキュメント）を直接選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "discardPileId", {
        name: "捨て札の登録",
        hint: "「自動で読み込む」のチェックを外した場合に、HUDが参照する捨て札（Cardsドキュメント）を直接選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "neuroDeckId", {
        name: "ニューロデッキの登録",
        hint: "「自動で読み込む」を外した場合に、HUDが参照するニューロデッキ（Deck）を選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "scenePileId", {
        name: "シーンカード置き場の登録",
        hint: "「自動で読み込む」を外した場合に、HUDが参照するシーンカード置き場（Pile）を選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "accessCardPileId", {
        name: "アクセスカード置き場の登録",
        hint: "「自動で読み込む」を外した場合に、HUDが参照するアクセスカード置き場（Hand）を選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });

    game.settings.register("tokyo-nova-axleration", "gmTrumpDiscardId", {
        name: "RL切り札捨て場の登録",
        hint: "「自動で読み込む」を外した場合に、HUDが参照するRL切り札捨て場（Pile）を選択します。",
        scope: "world",
        config: true,
        type: String,
        default: "",
        requiresReload: true
    });
    
    Hooks.on("renderSettingsConfig", (app, html, data) => {
        // --- ドロップダウン生成ヘルパー関数 ---
        const createDropdown = (settingName, collection, filter) => {
            const input = html.querySelector(`[name="tokyo-nova-axleration.${settingName}"]`);
            if (!input) return;
            const currentValue = game.settings.get("tokyo-nova-axleration", settingName);
            const select = document.createElement('select');
            select.name = `tokyo-nova-axleration.${settingName}`;
            const defaultOption = document.createElement('option');
            defaultOption.value = "";
            defaultOption.textContent = "- 選択 -";
            select.appendChild(defaultOption);
            collection.filter(filter).forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.uuid;
                option.textContent = doc.name;
                if (doc.uuid === currentValue) option.selected = true;
                select.appendChild(option);
            });
            input.parentNode.replaceChild(select, input);
        };

        // --- 各設定をドロップダウンに変換 ---
        createDropdown("activeScenarioId", game.journal, j => j.sheet instanceof TnxScenarioSheet);
        createDropdown("cardDeckId", game.cards, c => c.type === 'deck');
        createDropdown("discardPileId", game.cards, c => c.type === 'pile');
        createDropdown("neuroDeckId", game.cards, c => c.type === 'deck');
        createDropdown("scenePileId", game.cards, c => c.type === 'pile');
        createDropdown("accessCardPileId", game.cards, c => c.type === 'hand');
        createDropdown("gmTrumpDiscardId", game.cards, c => c.type === 'pile');

        // --- チェックボックスに応じて項目を無効化する処理 ---
        const autoLoadCheckbox = html.querySelector('[name="tokyo-nova-axleration.autoLoadFromScenario"]');
        const manualSelects = html.querySelectorAll(
            '[name$=".cardDeckId"], [name$=".discardPileId"], [name$=".neuroDeckId"], [name$=".scenePileId"], [name$=".accessCardPileId"], [name$=".gmTrumpDiscardId"]'
        );

        const toggleManualSettings = () => {
            const isDisabled = autoLoadCheckbox.checked;
            manualSelects.forEach(el => { el.disabled = isDisabled; });
        };

        autoLoadCheckbox.addEventListener("change", toggleManualSettings);
        toggleManualSettings();
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

    // v13: [data-action="createEntry"] の直後に「アクトシートを作成」ボタンを挿入する。
    // 「資料を作成」はコア標準ボタンに委ねる。
    Hooks.on("renderJournalDirectory", (app, html, data) => {
        if (!game.user.isGM) return;

        const createEntryButton = html.querySelector('[data-action="createEntry"]');
        if (!createEntryButton) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = '<i class="fas fa-file-medical"></i> アクトシートを作成';
        button.addEventListener('click', async () => {
            const newJournal = await JournalEntry.create({
                name: "新規アクトシート",
                flags: {
                    core: {
                        sheetClass: `tokyo-nova.${TnxScenarioSheet.name}`
                    }
                }
            });
            newJournal?.sheet.render(true);
        });

        createEntryButton.insertAdjacentElement('afterend', button);
    });

    Hooks.on("preCreateActor", (actor, data, options, userId) => {
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

    Hooks.on("preCreateCard", (card, data, options, userId) => {
        const parentPile = card.parent;

        // 既存の切り札上限チェック処理
        if (!parentPile || !parentPile.getFlag("tokyo-nova-axleration", "isTrumpPile")) {
            return true;
        }
        if (parentPile.cards.size >= 1) {
            ui.notifications.warn(game.i18n.localize("TNX.WarnTrumpPileFull"));
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
    });

    Hooks.on("preDeleteItem", async (item, options, userId) => {
        if (item.type === "miracle" && item.actor) {
            const usage = item.system.usageCount;
            if (usage.value > 1) {
                const newValue = usage.value - 1;
                const newTotal = Math.max(0, usage.total - 1);
                await item.update({
                    'system.usageCount.value': newValue,
                    'system.usageCount.total': newTotal
                });
                ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                return false;
            }
        }
        if (item.type === "style" && item.actor) {
            try {
                // このフックはレベル1のスタイル削除時にのみ動作する想定
                // 対応する神業を1つだけ削除する
                const miracleUuid = item.system.miracle?.id;
                if (miracleUuid) {
                    const sourceMiracle = await fromUuid(miracleUuid);
                    if (sourceMiracle) {
                        const miracleNameToDelete = sourceMiracle.name;
                        const actor = item.actor;
                        const itemToDelete = actor.items.find(i => i.type === 'miracle' && i.name === miracleNameToDelete);
    
                        if (itemToDelete) {
                            await itemToDelete.delete();
                            ui.notifications.info(`スタイル「${item.name}」の削除に伴い、神業「${itemToDelete.name}」を1つ削除しました。`);
                        }
                    }
                }
            } catch (e) {
                console.error(`TokyoNOVA | Error deleting associated Divine Work for style ${item.name}:`, e);
            }
            return true;
        }
    });

    Hooks.on("preDeleteActor", async (actor, options, userId) => {
        // ■修正: 対象アクターの判定
        // キャスト(cast) のみが対象
        const isCast = actor.type === "cast";
        
        if (!isCast) {
            return true;
        }

        // ■追加: リンク済みキャストの除外判定
        // キャストであり、かつプレイヤーIDが設定されている場合は、
        // カードの実体はプレイヤー側にあるとみなして削除確認を行わない
        if (isCast && actor.system.playerId) {
            return true;
        }
    
        // 1. アクターに直接リンクされているカードドキュメントのUUIDを収集します
        const linkedUuids = [
            actor.system.handPileId,
            actor.system.trumpCardPileId
        ].filter(uuid => !!uuid); // 空のIDを除外します
    
        // リンクされたドキュメントがなければ、通常の削除処理を続行します
        if (linkedUuids.length === 0) {
            return true;
        }
    
        // 2. UUIDから実際のカードドキュメントを取得します
        const docsToDelete = (await Promise.all(
            linkedUuids.map(uuid => fromUuid(uuid))
        )).filter(doc => doc); // 存在しないドキュメント(null)を除外します
    
        if (docsToDelete.length === 0) {
            return true;
        }
    
        // 3. ユーザーに削除を確認するダイアログを表示します
        const cardNames = docsToDelete.map(doc => `「${doc.name}」`).join("、");
        const content = `<p>アクター「${actor.name}」を削除しようとしています。</p>
                         <p>このアクターに直接リンクされている、以下のカード置き場（手札・切り札）も一緒に削除しますか？</p>
                         <p><strong>${cardNames}</strong></p>
                         <p>この操作は元に戻せません。</p>`;
    
        const confirmed = await Dialog.confirm({
            title: "関連カード置き場の削除確認",
            content: content,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
    
        // 4. 確認された場合、収集したドキュメントを削除します
        if (confirmed) {
            const deletionPromises = docsToDelete.map(doc => doc.delete());
            await Promise.all(deletionPromises);
        }
    
        // ユーザーの選択に関わらず、アクター本体の削除処理は常に続行します
        return true;
    });

    Hooks.on("preUpdateItem", async(item, changes) => {
        // 更新されるアイテムが神業の場合の処理
        if (item.type === "miracle") {
            // 「使用済み(isUsed)」フラグが true → false に変更されたかチェック
            const newIsUsed = foundry.utils.getProperty(changes, "system.isUsed");
            if (item.system.isUsed === true && newIsUsed === false) {
                
                //残り使用回数(total)を最大値(value + mod)にリセットする
                const usage = item.system.usageCount;
                const value = usage.value || 0;
                const mod = usage.mod || 0;
                const newTotal = value + mod;
    
                // 進行中の更新データ(changes)に、totalの変更を追加する
                foundry.utils.setProperty(changes, "system.usageCount.total", newTotal);
                ui.notifications.info(`神業「${item.name}」の使用回数がリセットされました。`);
            }
        }
    
        // スタイルアイテム以外の更新は無視 (既存の処理)
        if (item.type === "style" && item.actor) {
            const oldLevel = item.system.level || 1;
            const newLevel = foundry.utils.getProperty(changes, "system.level");
    
            // レベル変更時の神業使用回数 増減処理
            if (newLevel !== undefined && newLevel !== oldLevel) {
                (async () => {
                    try {
                        const miracleUuid = item.system.miracle?.id;
                        if (!miracleUuid) return;
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const existingMiracle = item.actor.items.find(i => i.type === 'miracle' && i.name === sourceMiracle.name);
                        if (!existingMiracle) return;
    
                        const usage = existingMiracle.system.usageCount;
                        const currentValue = usage.value || 1;
                        const currentTotal = usage.total || 0;
    
                        if (newLevel > oldLevel) {
                            // レベル上昇時の処理
                            const newValue = Math.min(3, currentValue + 1);
                            const newTotal = newValue + (usage.mod || 0);
                            await existingMiracle.update({ "system.usageCount.value": newValue, "system.usageCount.total": newTotal });
                            ui.notifications.info(`神業「${existingMiracle.name}」の母数が+1されました。`);
                        } else {
                            // レベル減少時の処理（修正版）
                            
                            // この神業に関連する、アクターが所持する全スタイルを取得
                            const allLinkedStyles = item.actor.items.filter(i => i.type === 'style' && i.system.miracle?.id === miracleUuid);
                            
                            // スタイルの合計レベルを計算（更新中のアイテムは newLevel を使用）
                            const totalStyleLevel = allLinkedStyles.reduce((sum, s) => {
                                if (s.id === item.id) return sum + newLevel;
                                return sum + (s.system.level || 1);
                            }, 0);

                            // 「現在の神業母数」が「新しい合計スタイルレベル」より大きい場合のみ減らす
                            if (currentValue > totalStyleLevel) {
                                const newValue = Math.max(1, currentValue - 1);
                                const newTotal = Math.max(0, currentTotal - 1);
                                await existingMiracle.update({ "system.usageCount.value": newValue, "system.usageCount.total": newTotal });
                                ui.notifications.info(game.i18n.format("TNX.Notification.MiracleCountDecreased", { name: existingMiracle.name }));
                            }
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
    Hooks.on("createCard", (cardDocument, options, userId) => {
        console.log(`TokyoNOVA | Card created in ${cardDocument.parent.name}. Refreshing UIs.`);
        setTimeout(() => game.tnx.refreshSheets(), 50);
    });

    /**
     * Cardの子ドキュメントが削除された際にUIを更新するフック。
     * カードが山札や手札から移動した（描画された、プレイされた）場合などに作動します。
     */
    Hooks.on("deleteCard", (cardDocument, options, userId) => {
        console.log(`TokyoNOVA | Card deleted from ${cardDocument.parent.name}. Refreshing UIs.`);
        setTimeout(() => game.tnx.refreshSheets(), 50);
    });
});

Hooks.once("ready", async function() {
    game.tnx = game.tnx || {}
    game.tnx.hud = new TnxHud();
    game.tnx.hud.render(true);

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

    const recalcActorExp = (item) => {
        if (item.parent && item.parent.type === 'cast') {
            TokyoNovaCastSheet.updateCastExp(item.parent);
        }
    };

    Hooks.on('createItem', (item) => recalcActorExp(item));
    Hooks.on('deleteItem', (item) => recalcActorExp(item));
    Hooks.on('updateItem', (item, diff, options) => recalcActorExp(item));

    Hooks.on('updateActor', async (actor, diff, options, userId) => {
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

        const flagDiff = diff.flags?.[TNX_FLAG_SCOPE];
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