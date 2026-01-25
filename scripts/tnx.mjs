import { TokyoNovaCastSheet } from './actor/tnx-cast-sheet.mjs';
import { TokyoNovaItem } from './item/item.mjs';
import { TokyoNovaStyleSheet } from './item/tnx-style-sheet.mjs';
import { TokyoNovaMiracleSheet } from './item/tnx-miracle-sheet.mjs';
import { TokyoNovaSkillSheet } from './item/tnx-skill-sheet.mjs';
import { TnxScenarioSheet } from './journal/tnx-scenario-sheet.mjs';
import { TnxActionHandler } from './module/tnx-action-handler.mjs';
import { TnxHud } from './module/tnx-hud.mjs';

async function preloadHandlebarsTemplates() {
    const templatePaths = [
        // === Actor Sheets ===
        "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",

        // === Item Sheets ===
        "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/skill-sheet.hbs",

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

        // === Partials ===
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs"
    ];
    return loadTemplates(templatePaths);
}

/**
 * 新しいキャストにデフォルトの手札と切り札置き場を作成・関連付けする
 * @param {Actor} actor 作成されたアクター
 */
async function setupDefaultCardPilesForCast(actor) {
    if (actor.type !== "cast") return;

    try {
        const updates = {};
        const ownership = {
            default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
            [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
        };

        // 1. 手札用 Cards ドキュメントを作成 (既存の処理)
        const handPileName = game.i18n.format("TNX.Actor.Cards.DefaultHandPileName", {actorName: actor.name});
        const handPile = await Cards.create({
            name: handPileName,
            type: "hand",
            description: `キャスト「${actor.name}」のデフォルト手札です。`,
            img: "icons/svg/card-hand.svg",
            ownership: ownership
        });
        if (handPile) {
            updates["system.handPileId"] = handPile.uuid;
            updates["system.handMaxSize"] = 4;
        }

        // 2. 切り札用 Cards ドキュメントを新規作成
        const trumpPileName = game.i18n.format("TNX.Actor.Cards.DefaultTrumpPileName", {actorName: actor.name});
        const trumpPile = await Cards.create({
            name: trumpPileName,
            type: "pile",
            description: `キャスト「${actor.name}」の切り札置き場です。ニューロカードを1枚だけ格納できます。`,
            img: "icons/svg/card-hand.svg",
            ownership: ownership,
            // このカード束を「切り札用」として識別するためのフラグを設定
            flags: {
                "tokyo-nova-axleration": {
                    isTrumpPile: true
                }
            }
        });
        if (trumpPile) {
            updates["system.trumpCardPileId"] = trumpPile.uuid;
        }

        // 3. アクターの情報を一括で更新
        if (Object.keys(updates).length > 0) {
            await actor.update(updates);
        }

    } catch (err) {
        console.error(`TokyoNOVA | Error setting up default piles for cast ${actor.name}:`, err);
    }
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

Hooks.once("init", async function() {  
    game.tnx = game.tnx || {};
    game.tnx.refreshSheets = handleRefreshSheets;
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;

    // システム用のCONFIG名前空間を準備
    CONFIG.TNX = {};

    // フェイズのキーと、対応する翻訳キー（または直接の日本語名）を定義
    CONFIG.TNX.phaseLabels = {
        opening: "オープニング",
        research: "リサーチ",
        climax: "クライマックス",
        ending: "エンディング"
    };
    
    // Actor Sheetの登録
    Actors.unregisterSheet("core", ActorSheet);
    Actors.registerSheet("tokyo-nova", TokyoNovaCastSheet, {
        types: ["cast"],
        makeDefault: true,
        label: "プロファイルシート"
    });
    
    // Item Sheetの登録
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

    Items.registerSheet("tokyo-nova", TokyoNovaSkillSheet, {
        types: ["skill"],
        makeDefault: true,
        label: "技能シート"
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
            const input = html.find(`[name="tokyo-nova-axleration.${settingName}"]`);
            if (!input.length) return;
            const currentValue = game.settings.get("tokyo-nova-axleration", settingName);
            const select = $(`<select name="tokyo-nova-axleration.${settingName}"></select>`);
            select.append(`<option value="">- 選択 -</option>`);
            collection.filter(filter).forEach(doc => {
                const option = $(`<option value="${doc.uuid}">${doc.name}</option>`);
                if (doc.uuid === currentValue) option.attr('selected', true);
                select.append(option);
            });
            input.replaceWith(select);
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
        const autoLoadCheckbox = html.find('[name="tokyo-nova-axleration.autoLoadFromScenario"]');
        const manualSelects = html.find(
            `[name$=".cardDeckId"], [name$=".discardPileId"], [name$=".neuroDeckId"], 
             [name$=".scenePileId"], [name$=".accessCardPileId"], [name$=".gmTrumpDiscardId"]`
        );
    
        const toggleManualSettings = () => {
            const isDisabled = autoLoadCheckbox.is(":checked");
            manualSelects.prop("disabled", isDisabled);
        };
    
        autoLoadCheckbox.on("change", toggleManualSettings);
        toggleManualSettings();
    });

    Hooks.on("renderJournalDirectory", (app, html, data) => {
        if (!game.user.isGM) return;

        const createButton = html.find(".create-document");
        createButton.html('<i class="far fa-plus-square"></i> 作成');
        createButton.off("click").on("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            $('.tnx-create-menu').remove();

            const menuHtml = `
                <div class="tnx-create-menu">
                    <ul>
                        <li data-creation-type="base"><i class="fas fa-file-alt"></i> 資料を作成</li>
                        <li data-creation-type="act-sheet"><i class="fas fa-file-medical"></i> アクトシートを作成</li>
                    </ul>
                </div>
            `;
            const menu = $(menuHtml);
            $('body').append(menu);
            const buttonPos = createButton.offset();
            menu.css({ top: buttonPos.top + createButton.outerHeight(), left: buttonPos.left });

            menu.find('li').on('click', async (ev) => {
                const creationType = ev.currentTarget.dataset.creationType;
                let newJournal;
                if (creationType === "base") {
                    // 通常のジャーナルを作成
                    newJournal = await JournalEntry.create({ name: "新規資料" });
                } else if (creationType === "act-sheet") {
                    // ▼▼▼【ここが最重要の修正点です】▼▼▼
                    // core.sheetClassフラグに、使用したいシートクラスのIDを指定して作成
                    newJournal = await JournalEntry.create({
                        name: "新規アクトシート",
                        flags: {
                            core: {
                                sheetClass: `tokyo-nova.${TnxScenarioSheet.name}`
                            }
                        }
                    });
                }
                menu.remove();
                newJournal?.sheet.render(true);

            });
            
            const closeMenu = (e) => {
                if (!$(e.target).closest('.tnx-create-menu').length) {
                    menu.remove();
                    $(document).off('click', closeMenu);
                }
            };
            setTimeout(() => $(document).on('click', closeMenu), 10);
        });
    });

    /**
     * ホットバーが描画された際に、デフォルトで折りたたむためのフック
     */
    Hooks.on("renderHotbar", (app, html, data) => {
        // #action-bar（マクロが並んでいる部分）を取得
        const actionBar = html[0].querySelector("#action-bar");

        // action-barが存在し、かつ .collapsed クラスを持っていない（＝展開されている）場合のみ処理
        if (actionBar && !actionBar.classList.contains("collapsed")) {
            // 折りたたみボタン(#bar-toggle)を探してクリックイベントを発生させる
            const toggleButton = html[0].querySelector("#bar-toggle");
            toggleButton?.click();
        }
    });

    Hooks.on("preCreateActor", (actor, data, options, userId) => {
        if (data.type !== "cast") return;

        const ownership = data.ownership || {};
        ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
        actor.updateSource({ ownership: ownership });
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
        if (typeof data.value !== 'number') {
            ui.notifications.warn(game.i18n.localize("TNX.WarnNotNeuroCard"));
            return false;
        }
        return true;
    });

    Hooks.on("createActor", (actor, options, userId) => {
        if (!options.temporary && userId === game.user.id) {
            actor.update({
                "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                "prototypeToken.actorLink": true,
                "prototypeToken.sight.enabled": true,
                "prototypeToken.sight.range": 1000
            });
            setupDefaultCardPilesForCast(actor);
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
        // この処理は "cast" タイプのアクターにのみ適用します
        if (actor.type !== "cast") {
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
            ui.notifications.info(`関連するカード置き場 ${cardNames} を削除します...`);
            const deletionPromises = docsToDelete.map(doc => doc.delete());
            await Promise.all(deletionPromises);
            ui.notifications.info(`関連カード置き場の削除が完了しました。`);
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
        if (item.type == "style" && item.actor) {
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
     * アクターが更新された際に、関連するカードドキュメントの所有権や名前を更新するフック
     */
    Hooks.on("updateActor", async (actor, diff, options, userId) => {
        // アクターの名前と所有権のいずれも変更されていない場合は、ここで処理を終了
        if (diff.name === undefined && diff.ownership === undefined) {
            return;
        }

        // "cast"タイプのアクターのみを対象とする
        if (actor.type !== "cast") {
            return;
        }

        // --- 所有権の同期処理 ---
        // diff.ownershipに変更があった場合のみ実行
        if (diff.ownership) {
            try {
                const gmUser = game.users.find(u => u.isGM && u.active);
                const gmId = gmUser?.id;

                const newCardOwnership = {
                    default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
                };
                if (gmId) {
                    newCardOwnership[gmId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
                }

                for (const [userId, level] of Object.entries(actor.ownership)) {
                    if (userId !== "default") {
                        newCardOwnership[userId] = level;
                    }
                }

                // 手札の権限を同期
                if (actor.system.handPileId) {
                    const handPile = await fromUuid(actor.system.handPileId);
                    if (handPile) {
                        await handPile.update({ ownership: newCardOwnership });
                    }
                }
        
                // 切り札の権限を同期
                if (actor.system.trumpCardPileId) {
                    const trumpPile = await fromUuid(actor.system.trumpCardPileId);
                    if (trumpPile) {
                        await trumpPile.update({ ownership: newCardOwnership });
                    }
                }
            } catch (err) {
                console.error(`TokyoNOVA | Failed to sync card pile ownership for actor ${actor.name}:`, err);
            }
        }

        // --- 名前の同期処理 ---
        // diff.nameに変更があった場合のみ実行
        if (diff.name) {
            let needsRender = false;
            try {
                // 手札の名前を更新
                if (actor.system.handPileId) {
                    const handPile = await fromUuid(actor.system.handPileId);
                    if (handPile) {
                        const newHandName = game.i18n.format("TNX.Actor.Cards.DefaultHandPileName", { actorName: actor.name });
                        if (handPile.name !== newHandName) {
                            await handPile.update({ name: newHandName });
                            needsRender = true;
                        }
                    }
                }

                // 切り札の名前を更新
                if (actor.system.trumpCardPileId) {
                    const trumpPile = await fromUuid(actor.system.trumpCardPileId);
                    if (trumpPile) {
                        const newTrumpName = game.i18n.format("TNX.Actor.Cards.DefaultTrumpPileName", { actorName: actor.name });
                        if (trumpPile.name !== newTrumpName) {
                            await trumpPile.update({ name: newTrumpName });
                            needsRender = true;
                        }
                    }
                }
            } catch (e) {
                console.error(`TokyoNOVA | Failed to update linked card pile names for actor ${actor.name}`, e);
            }

            // 名前の変更が実際にあった場合、開かれているアクターシートを再描画
            if (needsRender && actor.sheet?.rendered) {
                actor.sheet.render(true);
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
    game.tnx = game.tnx || {};
    game.tnx.hud = new TnxHud();
    game.tnx.hud.render(true);
    
    const defaultMaxSize = game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");
    const castActors = game.actors.filter(a => a.type === 'cast');

    for (const actor of castActors) {
        // アクティブエフェクトによる修正値を取得
        // 'system.handMaxSizeMod' などのカスタム属性をエフェクトで変更することを想定
        const effects = actor.effects.filter(e => !e.disabled);
        let effectMod = 0;
        for (const effect of effects) {
            for (const change of effect.changes) {
                if (change.key === 'system.handMaxSizeMod') { // このキーはアクターのデータモデルに合わせてください
                    effectMod += parseInt(change.value) || 0;
                }
            }
        }
        
        // 最終的な上限値を計算
        const finalMaxSize = defaultMaxSize + effectMod;

        // アクターのデータと比較し、変更があれば更新
        if (actor.system.handMaxSize !== finalMaxSize) {
            await actor.update({ 'system.handMaxSize': finalMaxSize });
            console.log(`TokyoNOVA | ${actor.name} の手札上限を ${finalMaxSize} に更新しました。`);
        }
    }

    Hooks.on("renderApplicationV2", async (app, html) => {
        if ( !(app instanceof foundry.applications.sheets.UserConfig) ) return;
    
        const targetUser = app.document;
        if (!targetUser) return;
        
        const systemId = "tokyo-nova-axleration";
        const flags = targetUser.flags[systemId] || {};
        let handUuid = flags.handId || "";
        let trumpUuid = flags.trumpPileId || "";
        let needsUpdate = false;
    
        // --- リンク切れのチェック ---
        if (handUuid && !(await fromUuid(handUuid))) {
            handUuid = "";
            needsUpdate = true;
        }
        if (trumpUuid && !(await fromUuid(trumpUuid))) {
            trumpUuid = "";
            needsUpdate = true;
        }
    
        // --- データに不正なリンクがあった場合 ---
        if (needsUpdate) {
            // ユーザーデータを更新して、無効なリンクをクリーンアップする
            await targetUser.update({
                [`flags.${systemId}.handId`]: handUuid,
                [`flags.${systemId}.trumpPileId`]: trumpUuid
            });
            // データを更新すると自動で再描画が走るため、現在の描画処理はここで中断する
            // これにより、UIが二重に描画される不具合を防ぐ
            return;
        }
    
        // --- 「使用中」判定ロジック (修正版) ---
        // 他のユーザーが使用しているカード置き場のIDをすべて収集する
        const linkedPileIds = new Set();
        game.users.forEach(user => {
            // 自分自身のユーザー設定は「使用中」の判定から除外する
            if (user.id === targetUser.id) return;
    
            const userFlags = user.flags[systemId] || {};
            if (userFlags.handId) linkedPileIds.add(userFlags.handId);
            if (userFlags.trumpPileId) linkedPileIds.add(userFlags.trumpPileId);
        });
    
        // --- 権限レベルごとの分類 ---
        const cardOptions = {
            hands: { owner: [], limited: [], observer: [] },
            piles: { owner: [], limited: [], observer: [] }
        };
        const ownershipLevels = { 3: 'owner', 2: 'limited', 1: 'observer' };
    
        for (const cards of game.cards) {
            let perm = cards.ownership[targetUser.id];
            if (perm === undefined) { perm = cards.ownership.default; }
            const levelKey = ownershipLevels[perm];
            
            if (levelKey) {
                const data = {
                    uuid: cards.uuid, name: cards.name,
                    isLinked: linkedPileIds.has(cards.uuid), // 判定ロジックをシンプル化
                    isSelected: false
                };
                if (cards.type === 'hand') {
                    data.isSelected = (cards.uuid === handUuid);
                    cardOptions.hands[levelKey].push(data);
                } else if (cards.type === 'pile') {
                    data.isSelected = (cards.uuid === trumpUuid);
                    cardOptions.piles[levelKey].push(data);
                }
            }
        }
        
        const templatePath = `systems/${systemId}/templates/parts/user-config-cards.hbs`;
        const templateData = { 
            cardOptions,
            selectedHandId: handUuid,
            selectedTrumpPileId: trumpUuid
        };
    
        // --- テンプレート描画とイベントリスナー設定 ---
        renderTemplate(templatePath, templateData).then(renderedHtml => {
            const form = html;
            if (form) {
                const footer = form.querySelector("footer.form-footer");
                const container = document.createElement('div');
                container.innerHTML = renderedHtml;
    
                container.querySelectorAll('[data-action="release-flag"]').forEach(button => {
                    button.addEventListener('click', async (event) => {
                        const flagName = event.currentTarget.dataset.flag;
                        if (flagName) {
                            await targetUser.unsetFlag(systemId, flagName);
                            app.render(true);
                        }
                    });
                });
    
                if (footer) {
                    footer.insertAdjacentElement('beforebegin', container);
                } else {
                    form.insertAdjacentElement('beforeend', container);
                }
                app.setPosition({ height: "auto" });
            }
        });
    });
});