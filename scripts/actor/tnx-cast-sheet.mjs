import {
    RichConfirmDialog,
    CardSelectionDialog,
    TargetSelectionDialog
} from '../module/tnx-dialog.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';
import { TnxSkillUtils } from '../module/tnx-skill-utils.mjs';
import { TnxHistoryMixin } from '../module/tnx-history-mixin.mjs';

export class TokyoNovaCastSheet extends ActorSheet {
    _prepareHistoryForDisplay = TnxHistoryMixin._prepareHistoryForDisplay;

    // イベントハンドラ
    _onHistoryAdd = TnxHistoryMixin._onHistoryAdd;
    _onHistoryDelete = TnxHistoryMixin._onHistoryDelete;
    _onHistoryChange = TnxHistoryMixin._onHistoryChange;

    constructor(...args) {
        super(...args);
        this._isEditMode = this.actor.isOwner ? false : false;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "actor", "cast"],
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",
            width: 950,
            height: 1000,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "abilities" }],
            dragDrop: [{ dragSelector: ".item-list .item, .style-skills-list .item", dropSelector: "form" }],
            scrollY: [".sheet-body", ".profile-sidebar", ".tab.abilities"]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.actor.system;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;

        context.TNX = {
            SUITS: {
                spade:   { label: "TNX.Suits.spade",   icon: "fa-solid fa-spade" },
                club:    { label: "TNX.Suits.club",    icon: "fa-solid fa-club" },
                heart:   { label: "TNX.Suits.heart",   icon: "fa-solid fa-heart" },
                diamond: { label: "TNX.Suits.diamond", icon: "fa-solid fa-diamond" }
            }
        };

        const allStyles = this.actor.items.filter(i => i.type === 'style');
        const allMiracles = this.actor.items.filter(i => i.type === 'miracle');
        context.equippedAffiliations = this.actor.items.filter(i => i.type === 'organization');
        context.affiliationDisplay = context.equippedAffiliations[0]?.name || game.i18n.localize("TNX.Actor.Profile.Unaffiliated");
        
        context.styleSlots = this._prepareStyleSlots(allStyles);
        const miracleSlotsData = this._prepareMiraclesForDisplay(allMiracles);
        context.miracleSlots = [...miracleSlotsData];
        while (context.miracleSlots.length < 3) {
            context.miracleSlots.push({ isEmpty: true });
        }
        context.miracleSlots = context.miracleSlots.slice(0, 3);

        context.miracleSlotsForView = [...miracleSlotsData];
        while (context.miracleSlotsForView.length < 3) {
            context.miracleSlotsForView.push({
                name: game.i18n.format("TNX.Ui.Label.MiracleSlot", {number: context.miracleSlotsForView.length + 1}),
                isPlaceholder: true,
                _id: `placeholder-${context.miracleSlotsForView.length}`
            });
        }
        context.miracleSlotsForView = context.miracleSlotsForView.slice(0, 3);
        
        context.processedStylesForView = this._prepareStylesForView(allStyles);

        const historyMap = this.actor.system.history || {};
        context.history = this._prepareHistoryForDisplay(historyMap);
        
        // リンク情報の取得（ボタン表示用）
        if (this.actor.system.recordSheetId) {
            context.recordSheet = await fromUuid(this.actor.system.recordSheetId);
        }

        await this._getCardPileData(context);
        this._getCitizenRankData(context);
        this._getAbilitiesData(context, allStyles);
        this._prepareSkillsData(context);

        return context;
    }

    /**
     * ▼▼▼ 実装: Mixinから呼ばれる更新処理 ▼▼▼
     * 自分を更新し、リンクがあればレコードシートの「履歴」も更新する
     */
    async _performHistoryUpdate(updateData) {
        // 1. 自分自身の更新
        await this.actor.update(updateData);

        // 2. レコードシートへの一方通行同期
        if (this.actor.system.recordSheetId) {
            try {
                const recordSheet = await fromUuid(this.actor.system.recordSheetId);
                if (recordSheet) {
                    // updateDataから "system.history" 関連のキーのみを抽出して同期する
                    // (exp.totalの差分更新などが含まれる場合があるが、
                    //  totalの同期は updateCastExp で厳密に行うため、ここでは履歴データのみを送るのが安全)
                    
                    const historyUpdate = {};
                    for (const [key, value] of Object.entries(updateData)) {
                        if (key.startsWith("system.history")) {
                            historyUpdate[key] = value;
                        }
                    }
                    
                    if (!foundry.utils.isEmpty(historyUpdate)) {
                        await recordSheet.update(historyUpdate);
                    }
                }
            } catch (e) {
                console.warn("Linked Record Sheet update failed:", e);
            }
        }
    }

    _prepareStyleSlots(styles) {
        const slots = [];
        styles.forEach(item => {
            const itemData = item.toObject(false);
            itemData.isEmpty = false;
            itemData.isPersona = item.system.level === 3 ? true : item.system.isPersona;
            itemData.isKey = item.system.level === 3 ? true : item.system.isKey;
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(itemData.isPersona, itemData.isKey);
            itemData.roleIndicatorClass = this._getRoleIndicatorClass(itemData.isPersona, itemData.isKey);
            for (let i = 0; i < item.system.level; i++) {
                if (slots.length < 3) {
                    slots.push(itemData);
                }
            }
        });
        while (slots.length < 3) {
            slots.push({ isEmpty: true });
        }
        return slots;
    }

    _prepareStylesForView(styles) {
        return styles.map(item => {
            const itemData = item.toObject(false);
            const level = item.system.level || 1;
            const isPersona = level === 3 ? true : item.system.isPersona;
            const isKey = level === 3 ? true : item.system.isKey;
            
            itemData.repeatedName = Array(level).fill(item.name).join('=');
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(isPersona, isKey);
            return itemData;
        });
    }
    
    _prepareGenericSlots(items, maxSlots) {
        const slots = [];
        for (let i = 0; i < maxSlots; i++) {
            const item = items[i];
            if (item) {
                slots.push({ ...item.toObject(false), isEmpty: false });
            } else {
                slots.push({ isEmpty: true });
            }
        }
        return slots;
    }

    /**
     * @private
     */
    _prepareSkillsData(context) {
        const allSkills = this.actor.items.filter(i => i.type === 'skill').sort((a, b) => (a.sort || 0) - (b.sort || 0));
        
        // 一般技能 (generalSkill)
        const generalSkills = allSkills.filter(s => s.system.category === 'generalSkill');
        context.generalSkills = generalSkills; // 編集モード等で全件リストが必要な場合用

        // ▼▼▼ 修正: 閲覧モード用にデータを「列」の配列にまとめる ▼▼▼
        const halfIndex = Math.ceil(generalSkills.length / 2);
        context.generalSkillColumns = [
            generalSkills.slice(0, halfIndex), // 1列目 (左)
            generalSkills.slice(halfIndex)     // 2列目 (右)
        ];
        
        // スタイル技能 (styleSkill)
        context.styleSkills = allSkills.filter(s => s.system.category === 'styleSkill');

        const skillOptions = TnxSkillUtils.getSkillOptions();
        
        context.styleSkills.forEach(item => {
            // styleSkillの場合のみviewを生成
            if (item.system.category === 'styleSkill') {
                item.view = TnxSkillUtils.prepareStyleSkillView(item.system, skillOptions);
            }
        });
    }

    activateListeners(html) {
        super.activateListeners(html);

        TnxHistoryMixin.activateHistoryListeners.call(this, html);

        html.find('.edit-mode-toggle').on('click', this._onToggleEditMode.bind(this));
        html.find('.item-edit').on('click', this._onOpenItemSheet.bind(this));
        html.find('.view-mode-style-summary .style-summary-item').on('click', this._onRollStyleDescription.bind(this));
        html.find('.skill-property-change').on('change', this._onSkillPropertyChange.bind(this));
        html.find('.item-delete').on('click', this._onItemDelete.bind(this));
        html.find('.item-create').on('click', this._onItemCreate.bind(this));
        html.find('.record-sheet-open').click(this._onOpenRecordSheet.bind(this));

        if (this.isEditable) {
            html.find('.ability-main-inputs input[name$=".growth"], .ability-main-inputs input[name$=".controlGrowth"]')
                .on('change', this._onGrowthChange.bind(this));
        }

        html.on('click', '[data-action]:not(.edit-mode-toggle)', (event) => {
            const target = $(event.currentTarget);
            if (target.hasClass('style-summary-item')) return;
            
            const action = target.data('action');
            if (!action) return;

            const handler = this[`_on${action.charAt(0).toUpperCase() + action.slice(1)}`];
            if (handler) {
                handler.bind(this)(event);
            } else {
                console.warn(`Action "${action}" was not found in the sheet controller.`);
            }
        });

        html.find('.style-skills-list .item-menu-trigger').click(ev => {
            ev.preventDefault();
            ev.stopPropagation(); // ボタンの親へのクリック伝播を止める

            // クリックされたボタンに最も近い「行」要素を取得（jQueryオブジェクトからDOM要素を取り出す）
            const row = ev.currentTarget.closest('.style-skill-row');
            
            if (row) {
                // ブラウザ標準の右クリックイベント(contextmenu)を作成
                // 座標(clientX, clientY)を渡すことで、マウスカーソルの位置にメニューが出ます
                const event = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: ev.clientX,
                    clientY: ev.clientY,
                    buttons: 2 // 右ボタンが押された状態をシミュレート
                });

                // 行要素に対してイベントを送り込む
                row.dispatchEvent(event);
            }
        });

        // シート内の手札カードをドラッグ可能にする
        const draggableCards = html.find('.hand-cards-display .card-in-hand');
        draggableCards.each((i, el) => {
            el.setAttribute('draggable', true);
            el.addEventListener('dragstart', (event) => {
                event.stopPropagation();
                
                // ドラッグするデータに「アクターの手札から」という情報と
                // カードID、アクターIDを格納する
                const dragData = {
                    sourceType: 'actor-hand-card',
                    cardId: el.dataset.cardId,
                    actorId: this.actor.id
                };
                event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
            });
        });

        // ▼▼▼ コンテキストメニューの呼び出しを復活 ▼▼▼
        this._activateContextMenus(html);
    }

    // ▼▼▼ コンテキストメニューのロジックを復活 ▼▼▼
    _activateContextMenus(html) {
        // ▼▼▼ 新しい削除ロジック ▼▼▼
        const itemDeleteCallback = async header => {
            const itemId = header.data('itemId');
            const item = this.actor.items.get(itemId);
            if (!item) return;
    
            // --- 神業の使用回数を減らす処理 ---
            if (item.type === 'miracle') {
                const usage = item.system.usageCount;
                // 使用回数(母数)が1より大きい場合
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    const newTotal = Math.max(0, usage.total - 1);
                    await item.update({
                        'system.usageCount.value': newValue,
                        'system.usageCount.total': newTotal
                    });
                    ui.notifications.info(game.i18n.format("TNX.Notification.MiracleCountDecreased", { name: item.name }));
                    return; // アイテムを削除せずに処理を終了
                }
            }
    
            // --- スタイルのレベルを下げる処理 ---
            if (item.type === 'style' && item.system.level > 1) {
                await item.update({'system.level': item.system.level - 1});
                return; // アイテムを削除せずに処理を終了
            }
    
            // --- 上記以外の場合、アイテムを完全に削除 ---
            await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        };

        const itemContextMenu = [{
            name: "SHEET.ItemDelete",
            icon: '<i class="fas fa-trash"></i>',
            condition: header => !!header.data('itemId'),
            callback: itemDeleteCallback // 共通の削除コールバックを使用
        }];
        new ContextMenu(html, '.item-button[data-context-menu="item-edit"]', itemContextMenu);
        
        const miracleViewMenu = [
            {
                name: "閲覧",
                icon: '<i class="fas fa-eye"></i>',
                condition: header => !!header.data('itemId'),
                callback: header => this.actor.items.get(header.data('itemId'))?.sheet.render(true)
            },
            {
                name: "削除",
                icon: '<i class="fas fa-trash"></i>',
                condition: header => this.isEditable && !!header.data('itemId'),
                callback: itemDeleteCallback // こちらも共通の削除コールバックを使用
            }
        ];
        new ContextMenu(html, '[data-context-menu="miracle-view"]', miracleViewMenu);
        
        const unlinkMenu = [{
            name: game.i18n.localize("TNX.UnlinkCards"),
            icon: '<i class="fas fa-unlink"></i>',
            callback: panel => this.actor.update({ [panel.data('unlinkPath')]: "" })
        }];
        new ContextMenu(html, '[data-context-menu-type="unlink"]', unlinkMenu);

        // スタイル技能用の共通メニュー定義
        const styleSkillOptions = [
            {
                name: "SHEET.ItemEdit",
                icon: '<i class="fas fa-edit"></i>',
                callback: header => {
                    const itemId = header.data("itemId") || header.closest('[data-item-id]').data('itemId');
                    const item = this.actor.items.get(itemId);
                    item?.sheet.render(true);
                }
            },
            {
                name: "SHEET.ItemDelete",
                icon: '<i class="fas fa-trash"></i>',
                callback: itemDeleteCallback // 共通削除ロジックを使用
            }
        ];

        // ② 行自体を「右クリック (contextmenu)」したときのメニュー
        // CSSセレクタ: .style-skills-list 内の .style-skill-row
        new ContextMenu(html, ".style-skills-list .style-skill-row", styleSkillOptions);

        const recordLinkMenu = [
            {
                name: "TNX.Common.Unlink", 
                icon: '<i class="fas fa-unlink"></i>',
                callback: () => this.actor.update({ "system.recordSheetId": "" })
            }
        ];
        new ContextMenu(html, '.record-link-container', recordLinkMenu);
    }
    
    async _getCardPileData(context) {
        const handPileData = await this._fetchLinkedCardPile(context.system.handPileId, "system.handPileId");
        if (handPileData) {
            context.handPile = handPileData;
        } else {
            context.handPile = null;
        }

        const trumpPileData = await this._fetchLinkedCardPile(context.system.trumpCardPileId, "system.trumpCardPileId");
        if (trumpPileData) {
            context.trumpCardPile = trumpPileData;
            context.trumpCard = trumpPileData.cards?.[0] || null;
        } else {
            context.trumpCardPile = null;
            context.trumpCard = null;
        }
    }

    async _fetchLinkedCardPile(uuid, updatePath) {
        if (!uuid) return null;
        try {
            const doc = await fromUuid(uuid);
            if (doc) {
                const data = doc.toObject(false);
                data.cards = Array.from(doc.cards.values()).map(c => c.toObject(false));
                return data;
            }
        } catch (e) {
            console.error(`TokyoNOVA | Failed to retrieve linked card pile (UUID: ${uuid})`, e);
            if (this.isEditable) this.actor.update({ [updatePath]: "" });
        }
        return null;
    }
    
    _getCitizenRankData(context) {
        const currentCitizenRank = context.system.citizenRank;
        const citizenRankMap = { "A": "A", "B+": "B+", "B": "B", "B-": "B-", "C+": "C+", "C": "C", "C-": "C-", "X": "X"};
        context.citizenRankOptionsForSelect = Object.entries(citizenRankMap).map(([value, labelKey]) => ({
            value: value,
            label: game.i18n.localize(labelKey),
            selected: value === currentCitizenRank
        }));
    }

    _getAbilitiesData(context, equippedStyles) {
        context.system.abilities = {};
        const abilityKeys = ["reason", "passion", "life", "mundane"];
        const abilityLabels = { "reason": game.i18n.format("TNX.Ability.Reason", { suit: "♠" }),
                                "passion": game.i18n.format("TNX.Ability.Passion", { suit: "♣" }),
                                "life": game.i18n.format("TNX.Ability.Life", { suit: "♥" }),
                                "mundane": game.i18n.format("TNX.Ability.Mundane", { suit: "♦" })
                              };
        
        for (const key of abilityKeys) {
            const ability = context.system[key];
            let styleTotalValue = 0;
            let styleTotalControl = 0;
            const styleContributions = equippedStyles.map(style => {
                const styleValue = style.system[key]?.value || 0;
                const styleControl = style.system[key]?.control || 0;
                const level = style.system.level || 1;
                styleTotalValue += styleValue * level;
                styleTotalControl += styleControl * level;
                return { name: style.name, value: styleValue * level, control: styleControl * level, level: level };
            });
            
            context.system.abilities[key] = {
                label: abilityLabels[key],
                growth: ability.growth,
                controlGrowth: ability.controlGrowth,
                mod: ability.mod,
                controlMod: ability.controlMod,
                effectMod: ability.effectMod,
                controlEffectMod: ability.controlEffectMod,
                styleContributions,
                totalValue: (ability.growth || 0) + styleTotalValue + (ability.mod || 0) + (ability.effectMod || 0),
                totalControl: (ability.controlGrowth || 0) + styleTotalControl + (ability.controlMod || 0) + (ability.controlEffectMod || 0)
            };
        }
    }

    async _onDropItem(event, data) {
        if (!this.actor.isOwner) return false;
        
        let item;
        if (data.uuid) {
            item = await fromUuid(data.uuid);
        } else {
            item = await Item.fromDropData(data);
        }
        if (!item) return;
        
        if (this.actor.uuid === item.parent?.uuid) {
            return this._onSortItem(event, item.toObject());
        }

        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;
    
        // === 既存のスタイル処理 ===
        if (item.type === "style" && dropArea === "style") {
            const allStyles = this.actor.items.filter(i => i.type === 'style');
            const totalLevel = allStyles.reduce((sum, s) => sum + (s.system.level || 1), 0);
            const existingItem = allStyles.find(i => i.name === item.name);
            
            if (existingItem) {
                if (totalLevel >= 3) {
                    ui.notifications.warn("これ以上スタイルレベルを上げられません。");
                    return false;
                }
                const currentLevel = existingItem.system.level || 1;
                await existingItem.update({ 'system.level': currentLevel + 1 });
                return existingItem;
            } else {
                const itemData = item.toObject();
                if (!itemData.system.level) itemData.system.level = 1;
                if (totalLevel + itemData.system.level > 3) {
                    ui.notifications.warn("スタイルの合計レベルが3を超えてしまいます。");
                    return false;
                }
                const createdItems = await this.actor.createEmbeddedDocuments("Item", [itemData]);
                const createdStyle = createdItems[0];

                if (createdStyle) {
                    const miracleUuid = createdStyle.system.miracle?.id;
                    if (miracleUuid) {
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (sourceMiracle) {
                            const allMiracles = this.actor.items.filter(i => i.type === 'miracle');
                            const existingMiracle = allMiracles.find(i => i.name === sourceMiracle.name);

                            if (existingMiracle) {
                                const usage = existingMiracle.system.usageCount;
                                const mod = usage.mod || 0;
                                const newValue = Math.min(3, (usage.value || 0) + 1);
                                const newTotal = newValue + mod;
                                
                                ui.notifications.info(`神業「${existingMiracle.name}」の母数が+1されました。`);
                                await existingMiracle.update({
                                    'system.usageCount.value': newValue,
                                    'system.usageCount.total': newTotal
                                });
                            } else {
                                if (allMiracles.length >= 3) {
                                    ui.notifications.warn(`神業は3種類までしか所有できません。`);
                                } else {
                                    const miracleData = sourceMiracle.toObject();
                                    if (!foundry.utils.hasProperty(miracleData, "system.usageCount.value")) {
                                        const mod = foundry.utils.getProperty(miracleData, "system.usageCount.mod") || 0;
                                        foundry.utils.setProperty(miracleData, "system.usageCount", { value: 1, total: 1 + mod, mod: mod, used: 0 });
                                    }
                                    await this.actor.createEmbeddedDocuments("Item", [miracleData]);
                                    ui.notifications.info(`神業「${miracleData.name}」がスタイル「${createdStyle.name}」から追加されました。`);
                                }
                            }
                        }
                    }
                }
                return createdStyle;
            }
        }
    
        // === 既存の神業処理 ===
        if (item.type === "miracle" && dropArea === "miracle") {
            const allMiracles = this.actor.items.filter(i => i.type === 'miracle');
            const existingItem = allMiracles.find(i => i.name === item.name);
            if (existingItem) {
                const usage = existingItem.system.usageCount;
                const mod = usage.mod || 0;
                const newValue = Math.min(3, (usage.value || 0) + 1);
                const newTotal = newValue + mod;
                
                ui.notifications.info(`神業「${existingItem.name}」の母数が+1されました。`);
                return existingItem.update({
                    'system.usageCount.value': newValue,
                    'system.usageCount.total': newTotal
                });
            } else {
                if (allMiracles.length >= 3) {
                    ui.notifications.warn(`神業は3種類までしか所有できません。`);
                    return false;
                }
                const itemData = item.toObject();
                if (!foundry.utils.hasProperty(itemData, "system.usageCount.value")) {
                    const mod = foundry.utils.getProperty(itemData, "system.usageCount.mod") || 0;
                    foundry.utils.setProperty(itemData, "system.usageCount", { value: 1, total: 1 + mod, mod: mod, used: 0 });
                }
                return this.actor.createEmbeddedDocuments("Item", [itemData]);
            }
        }
        
        // === 既存の制限付きアイテム処理 ===
        const itemLimits = { organization: { limit: 1, area: 'affiliation' } };
        const rule = itemLimits[item.type];
        if (rule && rule.area === dropArea) {
            const count = this.actor.items.filter(i => i.type === item.type).length;
            if (count >= rule.limit) {
                ui.notifications.warn(`${item.name}は${rule.limit}つまでしか所有できません。`);
                return false;
            }
            return this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
        }

        if (item.type === "record") {
            if (!this._isEditMode) return false;
            const uuid = data.uuid || item.uuid;

            // キャスト側の履歴(Local)のみを使用
            const localMap = this.actor.system.history || {};

            // レコードシートからの読み込み（マージ）は行わない（要望2）
            
            // リンク情報の保存
            await this.actor.update({ "system.recordSheetId": uuid });

            // ただし、リンクした瞬間「キャストの履歴」を「レコードシート」に書き込む（同期開始）
            // ID衝突しない限り追記となる
            await item.update({ 
                "system.history": localMap
                // totalも同期すべきだが、直後のupdateCastExpに任せても良い
            });
            
            // 経験点の整合性を取るため再計算を実行
            TokyoNovaCastSheet.updateCastExp(this.actor);

            ui.notifications.info(`${item.name} をリンクしました。`);
            return false;
        }
        
        return super._onDropItem(event, data);
    }

    async _onDropCardPile(event, data) {
        event.preventDefault();
        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;
        if (!dropArea) return false;
        const droppedDoc = await fromUuid(data.uuid);
        if (!droppedDoc) return false;
        if (dropArea === 'hand-pile' && droppedDoc.type === 'hand') {
            await this.actor.update({ "system.handPileId": data.uuid });
            return true;
        } 
        if (dropArea === 'trump-card-pile' && droppedDoc.type === 'pile') {
            await this.actor.update({ "system.trumpCardPileId": data.uuid });
            return true;
        }
        return false;
    }

    /**
     * 【追加】アイテム削除ボタンが押されたときの処理
     * @private
     */
    async _onItemDelete(event) {
        event.preventDefault();
        const li = $(event.currentTarget).closest(".item");
        const itemId = li.data("itemId");
        const item = this.actor.items.get(itemId);

        if (!item) return;

        // 確認ダイアログを表示（誤操作防止のため）
        const confirm = await Dialog.confirm({
            title: game.i18n.localize("SHEET.ItemDelete"),
            content: `<p>${game.i18n.format("SHEET.Delete", {name: item.name})}</p>`
        });

        if (confirm) {
            await item.delete();
            li.slideUp(200, () => this.render(false));
        }
    }

    async _render(force = false, options = {}) {
        await super._render(force, options);
        const refreshFlag = this.actor.getFlag("tokyo-nova-axleration", "refreshSheet");
        if (refreshFlag) {
            await this.actor.unsetFlag("tokyo-nova-axleration", "refreshSheet");
        }
        if (this.element && this.element[0]) {
            const sheetElement = this.element[0];
            if (this._isEditMode && this.isEditable) {
                sheetElement.classList.remove("view-mode");
                sheetElement.classList.add("edit-mode");
            } else {
                sheetElement.classList.remove("edit-mode");
                sheetElement.classList.add("view-mode");
            }
            this._applyTextSqueezing();
        }
    }

    /**
     * .squeeze-text クラスを持つ要素に対し、親要素の幅に合わせて長体(scaleX)を適用する
     * @private
     */
    _applyTextSqueezing() {
        if (!this.element) return;
        
        const elements = this.element.find('.squeeze-text');
        
        elements.each((i, el) => {
            const parent = el.parentElement;
            
            // 親要素のパディングを除いた利用可能幅を計算
            const parentStyle = getComputedStyle(parent);
            const parentWidth = parent.clientWidth;
            const paddingLeft = parseFloat(parentStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(parentStyle.paddingRight) || 0;
            // 少し余裕を持たせるためにさらに-2px
            const availableWidth = parentWidth - paddingLeft - paddingRight - 2;
            
            // コンテンツの幅を取得
            const contentWidth = el.scrollWidth;

            // 一般技能（平行四辺形）かどうかを判定
            const isSkewedLabel = el.classList.contains('skill-label-content');

            // ベースとなる transform を決定
            let transformBase = '';
            if (isSkewedLabel) {
                // 一般技能は斜め変形が必要
                transformBase = 'skewX(25deg)';
            } else {
                // 表のセル内は変形なし、中央基準
                transformBase = '';
            }

            // 幅が溢れている場合、scaleX を追加
            if (contentWidth > availableWidth) {
                const scale = availableWidth / contentWidth;
                // 0.95倍でギリギリ感を緩和
                el.style.transform = `${transformBase} scaleX(${scale * 0.95})`;
            } else {
                // 溢れていない場合も、skewX 等のベース変形は適用する必要がある
                el.style.transform = transformBase;
            }
        });
    }
    
    _onOpenItemSheet(event) {
        event.preventDefault();
        const itemId = event.currentTarget.dataset.itemId;
        this.actor.items.get(itemId)?.sheet.render(true);
    }

    async _onRollStyleDescription(event) {
        event.preventDefault();
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;
    
        // --- ここからが修正箇所 ---
        const enrichedDescription = await TextEditor.enrichHTML(item.system.description, { async: true });
        const flavorText = `<h3>スタイル: ${item.name}</h3>`;
        const chatContent = `
        <details class="tnx-chat-card" open>
            <summary>${flavorText}</summary>
            <div class="card-content">
                ${enrichedDescription}
            </div>
        </details>
        `;
    
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: chatContent, // flavorは使わず、contentにすべてを格納
            flags: { "core.canPopout": true }
        });
    }

    async _onToggleStyleRole(event) {
        event.preventDefault();
        event.stopPropagation();
        const itemId = event.currentTarget.closest('[data-item-id]').dataset.itemId;
        const clickedItem = this.actor.items.get(itemId);
        if (!this.isEditable || !clickedItem) return;

        if (clickedItem.system.level === 3) {
            return ui.notifications.warn("スタイルレベルが3のため、役割は「ペルソナ」と「キー」で固定されています。");
        }

        // --- ▼▼▼【ここからが新しいロジック】▼▼▼ ---

        // 1. クリックされたアイテムの「次の」役割を決定する
        const { isPersona, isKey } = clickedItem.system;
        let nextIsPersona, nextIsKey;
        if (!isPersona && !isKey)      { nextIsPersona = true;  nextIsKey = false; } // シャドウ -> ペルソナ
        else if (isPersona && !isKey)  { nextIsPersona = false; nextIsKey = true;  } // ペルソナ -> キー
        else if (!isPersona && isKey)  { nextIsPersona = true;  nextIsKey = true;  } // キー -> ペルソナ+キー
        else                           { nextIsPersona = false; nextIsKey = false; } // ペルソナ+キー -> シャドウ

        // 2. アクターが持つ全スタイルの更新データを作成する
        const updates = [];
        const allStyles = this.actor.items.filter(i => i.type === 'style');

        for (const style of allStyles) {
            // スタイルがレベル3の場合は役割を操作しない
            if (style.system.level === 3) continue;

            const updateData = { _id: style.id };
            let needsUpdate = false;

            if (style.id === clickedItem.id) {
                // クリックされたアイテムは、次の役割に更新
                updateData['system.isPersona'] = nextIsPersona;
                updateData['system.isKey'] = nextIsKey;
                needsUpdate = true;
            } else {
                // 他のアイテムは、役割が重複していたら解除する
                let resetPersona = false;
                let resetKey = false;

                if (nextIsPersona && style.system.isPersona) {
                    // これからペルソナになるスタイルがあり、このスタイルがペルソナの場合
                    resetPersona = true;
                }
                if (nextIsKey && style.system.isKey) {
                    // これからキーになるスタイルがあり、このスタイルがキーの場合
                    resetKey = true;
                }

                if (resetPersona) {
                    updateData['system.isPersona'] = false;
                    needsUpdate = true;
                }
                if (resetKey) {
                    updateData['system.isKey'] = false;
                    needsUpdate = true;
                }
            }
            if (needsUpdate) {
                updates.push(updateData);
            }
        }

        // 3. 必要な更新をまとめて実行する
        if (updates.length > 0) {
            await this.actor.updateEmbeddedDocuments("Item", updates);
        }
        // --- ▲▲▲【ここまで】▲▲▲ ---
    }
    
    _getRoleIndicatorSymbol(isPersona, isKey) {
        if (isPersona && isKey) return "◎●";
        if (isPersona) return "◎";
        if (isKey) return "●";
        return "";
    }

    _getRoleIndicatorClass(isPersona, isKey) {
        if (isPersona && isKey) return "role-pk";
        if (isPersona) return "role-p";
        if (isKey) return "role-k";
        return "role-shadow";
    }

    async _onUseMiracle(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest('[data-item-id]').dataset.itemId;
        const originalMiracle = this.actor.items.get(itemId);
        console.log("▼▼▼ 神業使用時のデータチェック ▼▼▼");
        console.log("取得したアイテムオブジェクト:", originalMiracle);
        console.log("システムデータ(system):", originalMiracle?.system);
        if (!originalMiracle) return;
    
        let targetMiracle = originalMiracle;
        let useAsOther = false; // 他の神業として使用するかどうかのフラグ
    
        // ▼▼▼ 万能神業(isAll)の場合のロジック ▼▼▼
        if (originalMiracle.system.isAll) {
            // --- 1. 最初の確認ダイアログ ---
            useAsOther = await Dialog.confirm({
                title: game.i18n.localize("TNX.ConfirmUseAsOtherTitle"),
                content: `<p>${game.i18n.format("TNX.ConfirmUseAsOtherContent", { name: originalMiracle.name })}</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
    
            // --- 2. 「はい」が選択された場合のみ、神業選択に移る ---
            if (useAsOther) {
                const miracleChoices = game.items.filter(i => 
                    i.type === 'miracle' && i.name !== originalMiracle.name
                );
    
                if (miracleChoices.length === 0) {
                    ui.notifications.warn("ワールドに選択可能な神業が存在しません。");
                    return; // ここで処理を中断
                }
    
                const selectedId = await TargetSelectionDialog.prompt({
                    title: game.i18n.localize("TNX.SelectOmniMiracleTitle"),
                    label: game.i18n.format("TNX.SelectOmniMiracleContent", { name: originalMiracle.name }),
                    options: miracleChoices.map(dw => ({ value: dw.id, label: dw.name })),
                    selectLabel: game.i18n.localize("TNX.Select")
                });
    
                if (!selectedId) return; // 神業選択がキャンセルされた場合は終了
    
                const selectedWork = game.items.get(selectedId);
                if (!selectedWork) {
                    ui.notifications.error("選択された神業が見つかりませんでした。");
                    return;
                }
                
                targetMiracle = selectedWork;
            }
        }
    
        // --- 使用回数のチェックと消費は「元の」神業で行う ---
        const remainingUses = originalMiracle.system.usageCount.total || 0;
        if (remainingUses <= 0) {
            ui.notifications.warn(`神業「${originalMiracle.name}」はこれ以上使用できません。`);
            return;
        }
    
        await originalMiracle.update({
            "system.usageCount.total": remainingUses - 1,
            "system.isUsed": remainingUses - 1 === 0 // 残り回数が0になったら使用済みに
        });
    
        // --- チャットメッセージの作成と送信 (ここからが修正箇所) ---
        const originalDescription = await TextEditor.enrichHTML(originalMiracle.system.description, { async: true });
        let nestedContent = ''; // ネストされるコンテンツ用の変数
    
        // 「はい」を選び、かつ実際に別の神業が選択された場合に追記
        if (useAsOther && targetMiracle.id !== originalMiracle.id) {
            const selectedDescription = await TextEditor.enrichHTML(targetMiracle.system.description, { async: true });
            // ネスト部分を <details> タグで囲みます
            nestedContent = `
                <details class="nested-description">
                    <summary><h4>発動効果: ${targetMiracle.name}</h4></summary>
                    <div class="card-content">
                        ${selectedDescription}
                    </div>
                </details>
            `;
        }

        const miracleName = originalMiracle.name;
        const miracleFurigana = originalMiracle.system.furigana;
        let nameHtml;

        if (miracleFurigana) {
            nameHtml = `<ruby>${miracleName}<rt>${miracleFurigana}</rt></ruby>`;
        } else {
            nameHtml = miracleName;
        }
    
        const flavorText = `<h3>神業: ${nameHtml}</h3>`;
        // 全体を <details> タグで囲み、flavorText を <summary> に入れます
        const chatContent = `
        <details class="tnx-chat-card">
            <summary>${flavorText}</summary>
            <div class="card-content">
                ${originalDescription}
                ${nestedContent}
            </div>
        </details>
        `;
    
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: chatContent, // flavorは使わず、contentにすべてを格納
            flags: { "core.canPopout": true }
        });
    
        // --- 通知メッセージ ---
        const notificationMessage = (useAsOther && targetMiracle.id !== originalMiracle.id)
            ? `神業「${originalMiracle.name}」を使用し、「${targetMiracle.name}」の効果を発動しました。`
            : `神業「${originalMiracle.name}」を使用しました。`;
            
        ui.notifications.info(notificationMessage);
    }
    
    _onToggleEditMode(event) {
        event.preventDefault();
        this._isEditMode = !this._isEditMode;
        this.render(false);
    }
    
    _onToggleAbilityDetails(event) {
        event.preventDefault();
        const toggle = $(event.currentTarget);
        const panel = toggle.closest('.ability-block').find('.ability-details-panel');
        
        // パネルを開閉する
        panel.slideToggle(200);
        
        // アイコンのクラスをトグル（切り替え）する
        const icon = toggle.find('i');
        icon.toggleClass('fa-chevron-down fa-chevron-up');
    }

    _onOpenHandSheet(event) {
        event.preventDefault();
        const handPileId = this.actor.system.handPileId;
        if (handPileId) fromUuid(handPileId).then(doc => doc?.sheet.render(true));
    }

    _onOpenTrumpCardSheet(event) {
        event.preventDefault();
        const trumpCardPileId = this.actor.system.trumpCardPileId;
        if (trumpCardPileId) fromUuid(trumpCardPileId).then(doc => doc?.sheet.render(true));
    }

    async _onPlayCard(event) {
        event.preventDefault();
        const cardId = event.currentTarget.dataset.cardId;
        await TnxActionHandler.playCard(cardId, { actor: this.actor });
    }

    async _onDrawCard(event) {
        event.preventDefault();
        await TnxActionHandler.drawCard({ actor: this.actor });
    }

    async _onUseTrumpCard(event) {
        event.preventDefault();
        const trumpCardPileId = this.actor.system.trumpCardPileId;
        if (!trumpCardPileId) return ui.notifications.warn("切り札が設定されていません。");
        
        const trumpPile = await fromUuid(trumpCardPileId);
        if (!trumpPile || trumpPile.cards.size === 0) return ui.notifications.warn("使用できる切り札がありません。");
        
        const trumpCard = trumpPile.cards.values().next().value;
        const cardName = trumpCard.name || "名前不明のカード";
        const cardImg = trumpCard.faces[0]?.img || trumpCard.img || CONST.DEFAULT_TOKEN;
        const cardDescription = trumpCard.description || "";

        // RichConfirmDialogを呼び出して確認
        const confirmed = await RichConfirmDialog.prompt({
            title: game.i18n.localize("TNX.ConfirmUseTrumpCardTitle"),
            content: game.i18n.format("TNX.ConfirmUseTrumpCardContent", { cardName: `<strong>${cardName}</strong>` }),
            img: cardImg,
            description: cardDescription,
            mainButtonLabel: game.i18n.localize("TNX.Use")
        });

        // 確認された場合のみ、useTrumpを呼び出す
        if (confirmed) {
            await TnxActionHandler.useTrump(trumpCard.id, { actor: this.actor });
        }
    }

    async _onPassToOther(event) {
        event.preventDefault();
        const sourceHand = await fromUuid(this.actor.system.handPileId);
        if (!sourceHand || sourceHand.cards.size === 0) return ui.notifications.warn("渡せるカードが手札にありません。");
        const cards = Array.from(sourceHand.cards.values()).map(c => c.toObject(false));
        const selectedCardsIds = await CardSelectionDialog.prompt({
            title: game.i18n.localize("TNX.SelectCardsToPassTitle"),
            content: game.i18n.localize("TNX.SelectCardsToPassContent"),
            cards,
            passLabel: game.i18n.localize("TNX.Pass")
        });
        if (!selectedCardsIds || selectedCardsIds.length === 0) return;
        const otherActors = game.actors.filter(a => a.id !== this.actor.id && a.type === 'cast');
        if (otherActors.length === 0) return ui.notifications.warn(game.i18n.localize("TNX.NoOtherActorsFound"));
        const targetActorId = await TargetSelectionDialog.prompt({
            title: game.i18n.localize("TNX.SelectTargetActorTitle"),
            label: game.i18n.localize("TNX.SelectTargetActorContent"),
            options: otherActors.map(a => ({ value: a.id, label: a.name })),
            selectLabel: game.i18n.localize("TNX.Pass")
        });
        if (!targetActorId) return;
        const targetActor = game.actors.get(targetActorId);
        if (!targetActor?.system.handPileId) return ui.notifications.warn(`${targetActor.name}に手札が設定されていません。`);
        await TnxActionHandler.passCards(this.actor.id, targetActorId, selectedCardsIds);
    }

    /**
     * 能力値・制御値の成長が変更されたときに経験点を自動計算・消費するハンドラ
     * @param {Event} event 変更イベント
     * @private
     */
    async _onGrowthChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const name = input.name; 
        const newValue = parseInt(input.value, 10) || 0;

        // 計算はせず、入力された値を保存するだけ
        await this.actor.update({ [name]: newValue });
    }

    /**
     * 【追加】技能のレベルやスートが変更されたときの処理
     * レベルの手動変更、およびスートチェック時の自動レベル計算を行います
     */
    async _onSkillPropertyChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const itemId = input.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const target = input.dataset.target;
        let updateData = {};

        if (target === "level") {
            updateData["system.level"] = parseInt(input.value, 10) || 0;
        } else if (target === "suit") {
            const suitKey = input.dataset.suit;
            const isChecked = input.checked;
            updateData[`system.suits.${suitKey}`] = isChecked;

            // スート数からレベルを決定
            const currentSuits = item.system.suits;
            let newLevel = 0;
            const suitKeys = ["spade", "club", "heart", "diamond"];
            for (const key of suitKeys) {
                if (key === suitKey) {
                    if (isChecked) newLevel++;
                } else {
                    if (currentSuits[key]) newLevel++;
                }
            }
            updateData["system.level"] = newLevel;
        }

        // アイテムを更新するだけ
        await item.update(updateData);
    }

    /**
     * 神業アイテムの表示用データを、使用回数に基づいて生成します。
     * @param {Array<Item>} miracles アクターが所有する神業アイテムの配列
     * @returns {Array<Object>} 表示用の神業データ配列
     * @private
     */
    _prepareMiraclesForDisplay(miracles) {
        const slots = [];
        miracles.forEach(item => {
            const itemData = item.toObject(false);
            const usage = itemData.system.usageCount;
    
            // データがオブジェクトでない場合のエラー回避処理を追加
            if (typeof usage !== 'object' || usage === null) {
                console.error(`アイテム「${item.name}」のusageCountが不正なデータです:`, usage);
                return; // このアイテムの処理をスキップ
            }
    
            const maxUses = (usage.value || 0) + (usage.mod || 0);
            const remainingUses = usage.total || 0;
    
            for (let i = 0; i < maxUses; i++) {
                const isDisabled = i >= remainingUses;
                slots.push({
                    ...itemData,
                    isPlaceholder: false,
                    instanceIndex: i,
                    isDisabled: isDisabled
                });
            }
        });
        return slots;
    }

    /**
     * 【変更点2】アイテム作成ハンドラ
     * ヘッダーの+ボタンを押した際の処理
     */
    async _onItemCreate(event) {
        event.preventDefault();
        const header = event.currentTarget;
        const type = header.dataset.type; // "skill"
        const category = header.dataset.category; // "generalSkill" or "styleSkill"
        
        const itemData = {
            name: category === 'generalSkill' ? "新規一般技能" : "新規スタイル技能",
            type: type,
            system: {
                category: category,
                level: 0, // 初期レベル
            }
        };

        // 要件: 一般技能の場合は onomasticSKill (固有名詞技能) を初期選択
        if (category === 'generalSkill') {
            foundry.utils.setProperty(itemData, "system.generalSkill.generalSkillCategory", "onomasticSkill");
        }
        
        // 要件: スタイル技能の場合は styleSkill を初期選択 (template.jsonの初期値が既にstyleSkillであれば不要ですが念の為)
        if (category === 'styleSkill') {
            // styleSkillカテゴリの初期設定が必要であればここに記述
            // 例: 特定のスタイル技能種別など
        }

        return await Item.create(itemData, {parent: this.actor});
    }

    /**
     * 【変更点3】技能プロパティ変更時の処理（経験点消費の実装）
     */
    async _onSkillPropertyChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const itemId = input.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const target = input.dataset.target; // "level" または "suit"
        let newLevel = item.system.level;
        let updateData = {};

        // 変更後のレベルを計算
        if (target === "level") {
            newLevel = parseInt(input.value, 10) || 0;
            updateData["system.level"] = newLevel;
        } else if (target === "suit") {
            const suitKey = input.dataset.suit;
            const isChecked = input.checked;
            updateData[`system.suits.${suitKey}`] = isChecked;

            // スート数からレベルを再計算
            const currentSuits = item.system.suits;
            newLevel = 0;
            const suitKeys = ["spade", "club", "heart", "diamond"];
            for (const key of suitKeys) {
                if (key === suitKey) {
                    if (isChecked) newLevel++;
                } else {
                    if (currentSuits[key]) newLevel++;
                }
            }
            updateData["system.level"] = newLevel;
        }

        // --- 経験点消費ロジック ---
        const oldLevel = item.system.level || 0;
        
        // レベルが変わっていない場合は更新のみ
        if (newLevel === oldLevel) {
            await item.update(updateData);
            return;
        }

        // コストの取得
        const expCostPerLevel = this._getSkillExpCost(item);
        
        // ▼▼▼【修正】初期取得技能のコスト計算ロジック ▼▼▼
        // 一般技能かつ固有名詞技能で、初期取得フラグが立っているか確認
        const isInitialOnomastic = (item.system.category === 'generalSkill') && 
                                   (item.system.generalSkill?.generalSkillCategory === 'onomasticSkill') &&
                                   (item.system.generalSkill?.onomasticSkill?.isInitial);

        let totalCost = 0;

        if (isInitialOnomastic) {
            // 初期取得の場合、Lv1までは無料とみなす
            // つまり、Lv2以上になっている分のみコストを支払う必要がある
            // 計算式: max(0, level - 1) * unitCost
            const oldPaidLevel = Math.max(0, oldLevel - 1);
            const newPaidLevel = Math.max(0, newLevel - 1);
            totalCost = (newPaidLevel - oldPaidLevel) * expCostPerLevel;
        } else {
            // 通常計算
            const diff = newLevel - oldLevel;
            totalCost = diff * expCostPerLevel;
        }
        // ▲▲▲【ここまで】▲▲▲

        const currentExp = this.actor.system.exp.value;

        // 経験点が足りない場合（コストが正の数、かつ所持経験点より多い場合）
        if (totalCost > 0 && totalCost > currentExp) {
            // 入力値を元に戻す
            if (target === "level") {
                input.value = oldLevel;
            } else if (target === "suit") {
                input.checked = !input.checked; 
            }
            return;
        }

        // アクターの経験点更新
        if (totalCost !== 0) {
            const newExp = currentExp - totalCost;
            await this.actor.update({ "system.exp.value": newExp });
            
            const actionText = totalCost > 0 ? "消費" : "回復";
        }

        // アイテムの更新
        await item.update(updateData);
    }

    /**
     * 【追加】技能ごとの経験点コストを取得するヘルパー
     */
    _getSkillExpCost(item) {
        const system = item.system;
        
        // 一般技能
        if (system.category === 'generalSkill') {
            const genCategory = system.generalSkill.generalSkillCategory;
            
            // 固有名詞技能 (onomasticSKill) -> 5点
            if (genCategory === 'onomasticSkill') {
                return system.generalSkill.onomasticSkill.expCost || 5;
            }
            
            // 初期技能 (initialSkill) -> 10点 (Lv2以降の成長コスト)
            // system.json/template.jsonの定義に従い値を取得
            if (genCategory === 'initialSkill') {
                return system.generalSkill.initialSkill.expCost || 10;
            }
            
            // デフォルト
            return 10;
        }
        
        // スタイル技能
        if (system.category === 'styleSkill') {
            const styleCategory = system.styleSkill.styleSkillCategory;
            
            if (styleCategory === 'special') return system.styleSkill.special.expCost || 10;
            if (styleCategory === 'performance') return system.styleSkill.performance.expCost || 2;
            if (styleCategory === 'secret') return system.styleSkill.secret.expCost || 20; // 秘技
            if (styleCategory === 'mystery') return system.styleSkill.mystery.expCost || 50; // 奥義
            
            return 10;
        }

        return 0;
    }

    /**
     * 最新の履歴データを取得する。
     * リンクされたレコードシートがある場合は、必ずそこから最新データをfetchする。
     */
    async _getHistoryData() {
        if (this.actor.system.recordSheetId) {
            const recordSheet = await fromUuid(this.actor.system.recordSheetId);
            if (recordSheet) {
                // ディープクローンして返す（参照渡しによる予期せぬ変更を防ぐため）
                return foundry.utils.deepClone(recordSheet.system.history || []);
            }
        }
        return foundry.utils.deepClone(this.actor.system.history || []);
    }

    /**
     * 履歴データの保存（キャストシート固有：リンク先への同期も行う）
     */
    async _saveHistoryData(newHistory) {
        // 1. アクター自身の更新
        await this.actor.update({ "system.history": newHistory });

        // 2. リンクされたレコードシートへの同期
        if (this.actor.system.recordSheetId) {
            try {
                const recordSheet = await fromUuid(this.actor.system.recordSheetId);
                if (recordSheet) {
                    // 同じソートロジックを適用
                    const sortedHistory = [...newHistory];
                    this._sortHistory(sortedHistory);
                    
                    // レコードシート側の exp.total も同期させる
                    const currentTotal = Number(this.actor.system.exp.total) || 0;

                    await recordSheet.update({ 
                        "system.history": sortedHistory,
                        "system.exp.total": currentTotal
                    });
                }
            } catch (e) {
                console.warn("Failed to sync with linked Record Sheet:", e);
            }
        }
    }

    /**
     * 経験点合計の更新
     */
    async _updateExpTotal(diff) {
        const currentTotal = Number(this.actor.system.exp.total) || 0;
        await this.actor.update({
            "system.exp.total": currentTotal + diff
        });
        // Note: updateCastExpフックが別途走るため、valueの自動計算はそちらで行われる
    }

    async _onOpenRecordSheet(event) {
        event.preventDefault();
        if (this.actor.system.recordSheetId) {
            const item = await fromUuid(this.actor.system.recordSheetId);
            item?.sheet.render(true);
        }
    }

    /**
     * アクターの全データを元に経験点を再計算し、spentとvalueを更新する
     */
    static async updateCastExp(actor) {
        if (!actor || actor.type !== 'cast') return;

        // 1. 能力値成長コストの計算 (既存通り)
        const abilities = ["reason", "passion", "life", "mundane"];
        let totalAbilityCost = 0;
        const allStyles = actor.items.filter(i => i.type === 'style');
        
        for (const key of abilities) {
            let styleValue = 0;
            let styleControl = 0;
            allStyles.forEach(s => {
                const level = Number(s.system.level) || 1;
                styleValue += (Number(s.system[key]?.value) || 0) * level;
                styleControl += (Number(s.system[key]?.control) || 0) * level;
            });
            
            const abilityData = actor.system[key];
            
            const baseVal = styleValue + (Number(abilityData.mod) || 0) + (Number(abilityData.effectMod) || 0);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.growth, baseVal, false);

            const baseCtrl = styleControl + (Number(abilityData.controlMod) || 0) + (Number(abilityData.controlEffectMod) || 0);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.controlGrowth, baseCtrl, true);
        }

        // 2. アイテムコストの計算 (既存通り)
        let totalItemCost = 0;
        actor.items.forEach(item => {
             totalItemCost += this._calcSingleItemCost(item);
        });

        // 3. アクターの更新
        const currentTotal = Number(actor.system.exp.total) || 0;
        const initialOffset = -170; 
        
        const newSpent = initialOffset + totalAbilityCost + totalItemCost;
        const newValue = currentTotal - newSpent;

        if (actor.system.exp.spent !== newSpent || actor.system.exp.value !== newValue) {
             await actor.update({
                 "system.exp.spent": newSpent,
                 "system.exp.value": newValue
             }, { calcExp: false });
             
             if (actor.system.recordSheetId) {
                try {
                    const recordSheet = await fromUuid(actor.system.recordSheetId);
                    if (recordSheet) {
                        // spent, value は同期しない（要望1）
                        // total は履歴由来の増加として同期する
                        if (recordSheet.system.exp.total !== currentTotal) {
                            await recordSheet.update({
                                "system.exp.total": currentTotal
                            });
                        }
                    }
                } catch (e) {
                    console.warn("Failed to sync exp to Record Sheet:", e);
                }
             }
             // ▲▲▲
        }
    }

    /**
     * 能力値1つ分の成長コスト計算
     */
    static _calcSingleAbilityCost(growth, base, isControl) {
        const g = Number(growth) || 0;
        if (g <= 0) return 0;
        
        const threshold = isControl ? 17 : 11;
        const costLow = 20; 
        const costHigh = 40; 
        
        let cost = 0;
        for (let i = 1; i <= g; i++) {
            const currentVal = base + i;
            cost += (currentVal < threshold) ? costLow : costHigh;
        }
        return cost;
    }

    /**
     * アイテム1つ分の経験点コストを計算 (特定技能の免除ルール含む)
     */
    static _calcSingleItemCost(item) {
        // 技能以外のアイテム対応
        if (item.type !== 'skill') {
             return Number(item.system.expCost) || 0;
        }
        
        const system = item.system;
        const level = Number(system.level) || 0;
        if (level <= 0) return 0;

        let costPerLevel = 0;
        
        // A. 一般技能
        if (system.category === 'generalSkill') {
            const genCat = system.generalSkill?.generalSkillCategory;
            
            // 1. 固有名詞技能 (Onomastic)
            if (genCat === 'onomasticSkill') {
                costPerLevel = Number(system.generalSkill.onomasticSkill?.expCost) || 5;
                // 初期取得チェックがある場合は Lv1 分が無料
                if (system.generalSkill.onomasticSkill?.isInitial) {
                    return Math.max(0, level - 1) * costPerLevel;
                }
            } 
            // 2. 初期一般技能 (Initial)
            else if (genCat === 'initialSkill') {
                costPerLevel = Number(system.generalSkill.initialSkill?.expCost) || 10;
                // 初期一般技能は Lv1 分が無料
                return Math.max(0, level - 1) * costPerLevel;
            } 
            // 3. その他
            else {
                costPerLevel = 5; 
            }
        
        // B. スタイル技能
        } else if (system.category === 'styleSkill') {
             const sCat = system.styleSkill?.styleSkillCategory;
             if (sCat === 'secret') costPerLevel = 20;
             else if (sCat === 'mystery') costPerLevel = 50;
             else if (sCat === 'special') costPerLevel = 10;
             else costPerLevel = 10;
        }

        return level * costPerLevel;
    }
}