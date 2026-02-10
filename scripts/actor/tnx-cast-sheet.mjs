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
    _calculateTotalExp = TnxHistoryMixin._calculateTotalExp;

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
        
        // リンク情報の取得（ボタン表示用）
        if (this.actor.system.playerId) {
            context.playerActor = await fromUuid(this.actor.system.playerId);
        }

        if (context.playerActor) {
            const historyMap = context.playerActor.system.history || {};
            context.history = this._prepareHistoryForDisplay(historyMap);
        } else {
            // なければ自身の履歴
            const historyMap = this.actor.system.history || {};
            context.history = this._prepareHistoryForDisplay(historyMap);
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
        // 経験点合計の補正ロジック（既存ママ）
        if (updateData["system.exp.total"] !== undefined) {
            const historySum = updateData["system.exp.total"];
            const additional = Number(this.actor.system.exp.additional) || 0;
            updateData["system.exp.total"] = historySum + additional;
        }

        const playerId = this.actor.system.playerId;
        
        // --- A. プレイヤーとリンクしている場合 ---
        if (playerId) {
            const playerActor = await fromUuid(playerId);
            if (playerActor) {
                // 1. プレイヤーアクターを更新（正：共有データの更新）
                // updateDataは system.history.xxx などの形式
                await playerActor.update(updateData);

                // 2. 自分自身の更新（選別して適用）
                // 他人の履歴データで自身のローカル履歴を汚染しないようにする
                const localUpdate = {};
                const localHistory = this.actor.system.history || {};

                for (const [key, value] of Object.entries(updateData)) {
                    // 経験点関連は同期する
                    if (key.startsWith("system.exp.")) {
                        localUpdate[key] = value;
                        continue;
                    }

                    // 履歴データの判定
                    if (key.startsWith("system.history")) {
                        // キー形式: system.history.<ID> または system.history.<ID>.<prop>
                        const parts = key.split(".");
                        
                        // ID部分の抽出（system.history 直下の更新でない場合）
                        if (parts.length >= 3) {
                            const historyId = parts[2];
                            
                            // 条件: ローカルに既に存在する履歴、または新規追加(オブジェクトごとの代入)の場合のみ更新
                            // ※編集(prop単位)の場合は、ローカルにIDがない＝他人の履歴なのでスキップ
                            if (localHistory[historyId]) {
                                // 自身の履歴の更新 -> 反映
                                localUpdate[key] = value;
                            } else if (parts.length === 3 && typeof value === 'object' && value !== null) {
                                // 新規追加（と推測される） -> 反映
                                localUpdate[key] = value;
                            }
                        }
                    } else {
                        // その他のデータ
                        localUpdate[key] = value;
                    }
                }

                // 選別したデータのみで自身を更新
                if (!foundry.utils.isEmpty(localUpdate)) {
                    await this.actor.update(localUpdate);
                }
            }
        } 
        
        // --- B. リンクしていない場合 ---
        else {
            // 通常通り自身を更新
            await this.actor.update(updateData);
        }
        
        // 再計算（消費経験点の同期など）
        TokyoNovaCastSheet.updateCastExp(this.actor);
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
        const generalSkills = this.actor.items
            .filter(i => i.type === 'generalSkill')
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));
        
        context.generalSkills = generalSkills; 

        // 列への分割
        const halfIndex = Math.ceil(generalSkills.length / 2);
        context.generalSkillColumns = [
            generalSkills.slice(0, halfIndex), 
            generalSkills.slice(halfIndex)
        ];
        
        // スタイル技能
        context.styleSkills = this.actor.items
            .filter(i => i.type === 'styleSkill')
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));

        const skillOptions = TnxSkillUtils.getSkillOptions();
        
        context.styleSkills.forEach(item => {
            if (item.type === 'styleSkill') {
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
        html.find('.unlink-player-btn').click(this._onUnlinkPlayer.bind(this));

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
            ev.stopPropagation(); 

            const row = ev.currentTarget.closest('.style-skill-row');
            
            if (row) {
                const event = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: ev.clientX,
                    clientY: ev.clientY,
                    buttons: 2 
                });
                row.dispatchEvent(event);
            }
        });

        const draggableCards = html.find('.hand-cards-display .card-in-hand');
        draggableCards.each((i, el) => {
            el.setAttribute('draggable', true);
            el.addEventListener('dragstart', (event) => {
                event.stopPropagation();
                const dragData = {
                    sourceType: 'actor-hand-card',
                    cardId: el.dataset.cardId,
                    actorId: this.actor.id
                };
                event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
            });
        });

        this._activateContextMenus(html);
    }

    _activateContextMenus(html) {
        const itemDeleteCallback = async header => {
            const itemId = header.data('itemId');
            const item = this.actor.items.get(itemId);
            if (!item) return;
    
            // --- 神業の使用回数を減らす処理 ---
            if (item.type === 'miracle') {
                const usage = item.system.usageCount;
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    const newTotal = Math.max(0, usage.total - 1);
                    await item.update({
                        'system.usageCount.value': newValue,
                        'system.usageCount.total': newTotal
                    });
                    ui.notifications.info(game.i18n.format("TNX.Notification.MiracleCountDecreased", { name: item.name }));
                    return; 
                }
            }
    
            // --- スタイルのレベルを下げる処理 ---
            if (item.type === 'style' && item.system.level > 1) {
                await item.update({'system.level': item.system.level - 1});
                return; 
            }
    
            // --- 上記以外の場合、アイテムを完全に削除 ---
            await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        };

        const itemContextMenu = [{
            name: "SHEET.ItemDelete",
            icon: '<i class="fas fa-trash"></i>',
            condition: header => !!header.data('itemId'),
            callback: itemDeleteCallback
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
                callback: itemDeleteCallback
            }
        ];
        new ContextMenu(html, '[data-context-menu="miracle-view"]', miracleViewMenu);
        
        const unlinkMenu = [{
            name: game.i18n.localize("TNX.UnlinkCards"),
            icon: '<i class="fas fa-unlink"></i>',
            callback: panel => this.actor.update({ [panel.data('unlinkPath')]: "" })
        }];
        new ContextMenu(html, '[data-context-menu-type="unlink"]', unlinkMenu);

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
                callback: itemDeleteCallback
            }
        ];

        new ContextMenu(html, ".style-skills-list .style-skill-row", styleSkillOptions);
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

    async _onDrop(event) {
        const data = TextEditor.getDragEventData(event);

        if (data.type === "Actor") {
            const sourceActor = await fromUuid(data.uuid);
            
            if (sourceActor && sourceActor.type === "player") {
                if (sourceActor.uuid === this.actor.uuid) return false;

                // 1. キャストの現在の履歴を取得
                const castHistory = this.actor.system.history || {};
                
                // 2. プレイヤーの現在の履歴を取得
                const playerHistory = sourceActor.system.history || {};

                // 3. 履歴をマージ（キャストの履歴をプレイヤーに追加）
                // キー（ID）が重複することは稀ですが、万が一重複した場合はキャスト側が優先される形か、
                // あるいはプレイヤー側を生かすかは状況によりますが、ここでは単純マージします。
                const mergedHistory = { ...playerHistory, ...castHistory };

                // 4. プレイヤーシート側の履歴を更新
                await sourceActor.update({
                    "system.history": mergedHistory
                });

                // 5. キャストシートをプレイヤーにリンク
                // 手札・切り札IDの同期も含める
                const updateData = {
                    "system.playerId": sourceActor.uuid
                };
                if (sourceActor.system.handPileId) {
                    updateData["system.handPileId"] = sourceActor.system.handPileId;
                }
                if (sourceActor.system.trumpCardPileId) {
                    updateData["system.trumpCardPileId"] = sourceActor.system.trumpCardPileId;
                }

                // キャスト自身の履歴は**上書きしない**（元データを残すため）
                await this.actor.update(updateData);
                
                // 経験点再計算
                await TokyoNovaCastSheet.updateCastExp(this.actor);
                
                return true;
            }
        }

        return super._onDrop(event);
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

    async _onItemDelete(event) {
        event.preventDefault();
        const li = $(event.currentTarget).closest(".item");
        const itemId = li.data("itemId");
        const item = this.actor.items.get(itemId);

        if (!item) return;

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

    _applyTextSqueezing() {
        if (!this.element) return;
        
        const elements = this.element.find('.squeeze-text');
        
        elements.each((i, el) => {
            const parent = el.parentElement;
            
            const parentStyle = getComputedStyle(parent);
            const parentWidth = parent.clientWidth;
            const paddingLeft = parseFloat(parentStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(parentStyle.paddingRight) || 0;
            const availableWidth = parentWidth - paddingLeft - paddingRight - 2;
            
            const contentWidth = el.scrollWidth;

            const isSkewedLabel = el.classList.contains('skill-label-content');

            let transformBase = '';
            if (isSkewedLabel) {
                transformBase = 'skewX(25deg)';
            } else {
                transformBase = '';
            }

            if (contentWidth > availableWidth) {
                const scale = availableWidth / contentWidth;
                el.style.transform = `${transformBase} scaleX(${scale * 0.95})`;
            } else {
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
            content: chatContent, 
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

        const { isPersona, isKey } = clickedItem.system;
        let nextIsPersona, nextIsKey;
        if (!isPersona && !isKey)      { nextIsPersona = true;  nextIsKey = false; } 
        else if (isPersona && !isKey)  { nextIsPersona = false; nextIsKey = true;  } 
        else if (!isPersona && isKey)  { nextIsPersona = true;  nextIsKey = true;  } 
        else                           { nextIsPersona = false; nextIsKey = false; } 

        const updates = [];
        const allStyles = this.actor.items.filter(i => i.type === 'style');

        for (const style of allStyles) {
            if (style.system.level === 3) continue;

            const updateData = { _id: style.id };
            let needsUpdate = false;

            if (style.id === clickedItem.id) {
                updateData['system.isPersona'] = nextIsPersona;
                updateData['system.isKey'] = nextIsKey;
                needsUpdate = true;
            } else {
                let resetPersona = false;
                let resetKey = false;

                if (nextIsPersona && style.system.isPersona) {
                    resetPersona = true;
                }
                if (nextIsKey && style.system.isKey) {
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

        if (updates.length > 0) {
            await this.actor.updateEmbeddedDocuments("Item", updates);
        }
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
        if (!originalMiracle) return;
    
        let targetMiracle = originalMiracle;
        let useAsOther = false; 
    
        if (originalMiracle.system.isAll) {
            useAsOther = await Dialog.confirm({
                title: game.i18n.localize("TNX.ConfirmUseAsOtherTitle"),
                content: `<p>${game.i18n.format("TNX.ConfirmUseAsOtherContent", { name: originalMiracle.name })}</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
    
            if (useAsOther) {
                const miracleChoices = game.items.filter(i => 
                    i.type === 'miracle' && i.name !== originalMiracle.name
                );
    
                if (miracleChoices.length === 0) {
                    ui.notifications.warn("ワールドに選択可能な神業が存在しません。");
                    return; 
                }
    
                const selectedId = await TargetSelectionDialog.prompt({
                    title: game.i18n.localize("TNX.SelectOmniMiracleTitle"),
                    label: game.i18n.format("TNX.SelectOmniMiracleContent", { name: originalMiracle.name }),
                    options: miracleChoices.map(dw => ({ value: dw.id, label: dw.name })),
                    selectLabel: game.i18n.localize("TNX.Select")
                });
    
                if (!selectedId) return; 
    
                const selectedWork = game.items.get(selectedId);
                if (!selectedWork) {
                    ui.notifications.error("選択された神業が見つかりませんでした。");
                    return;
                }
                
                targetMiracle = selectedWork;
            }
        }
    
        const remainingUses = originalMiracle.system.usageCount.total || 0;
        if (remainingUses <= 0) {
            ui.notifications.warn(`神業「${originalMiracle.name}」はこれ以上使用できません。`);
            return;
        }
    
        await originalMiracle.update({
            "system.usageCount.total": remainingUses - 1,
            "system.isUsed": remainingUses - 1 === 0 
        });
    
        const originalDescription = await TextEditor.enrichHTML(originalMiracle.system.description, { async: true });
        let nestedContent = ''; 
    
        if (useAsOther && targetMiracle.id !== originalMiracle.id) {
            const selectedDescription = await TextEditor.enrichHTML(targetMiracle.system.description, { async: true });
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
            content: chatContent, 
            flags: { "core.canPopout": true }
        });
    
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
        panel.slideToggle(200);
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

        const confirmed = await RichConfirmDialog.prompt({
            title: game.i18n.localize("TNX.ConfirmUseTrumpCardTitle"),
            content: game.i18n.format("TNX.ConfirmUseTrumpCardContent", { cardName: `<strong>${cardName}</strong>` }),
            img: cardImg,
            description: cardDescription,
            mainButtonLabel: game.i18n.localize("TNX.Use")
        });

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

    async _onGrowthChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const name = input.name; 
        const newValue = parseInt(input.value, 10) || 0;
        await this.actor.update({ [name]: newValue });
    }

    async _onSkillPropertyChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const itemId = input.closest('.item').dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const target = input.dataset.target; 
        let newLevel = item.system.level;
        let updateData = {};

        if (target === "level") {
            newLevel = parseInt(input.value, 10) || 0;
            updateData["system.level"] = newLevel;
        } else if (target === "suit") {
            const suitKey = input.dataset.suit;
            const isChecked = input.checked;
            updateData[`system.suits.${suitKey}`] = isChecked;

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
        
        if (newLevel === oldLevel) {
            await item.update(updateData);
            return;
        }

        const expCostPerLevel = this._getSkillExpCost(item);
        
        // 【修正】system直下のプロパティを参照
        const isInitialOnomastic = (item.type === 'generalSkill') && 
                                   (item.system.generalSkillCategory === 'onomasticSkill') &&
                                   (item.system.onomasticSkill?.isInitial);

        let totalCost = 0;

        if (isInitialOnomastic) {
            const oldPaidLevel = Math.max(0, oldLevel - 1);
            const newPaidLevel = Math.max(0, newLevel - 1);
            totalCost = (newPaidLevel - oldPaidLevel) * expCostPerLevel;
        } else {
            const diff = newLevel - oldLevel;
            totalCost = diff * expCostPerLevel;
        }

        const currentExp = this.actor.system.exp.value;

        if (totalCost > 0 && totalCost > currentExp) {
            if (target === "level") {
                input.value = oldLevel;
            } else if (target === "suit") {
                input.checked = !input.checked; 
            }
            return;
        }

        if (totalCost !== 0) {
            const newExp = currentExp - totalCost;
            await this.actor.update({ "system.exp.value": newExp });
        }

        await item.update(updateData);
    }

    _prepareMiraclesForDisplay(miracles) {
        const slots = [];
        miracles.forEach(item => {
            const itemData = item.toObject(false);
            const usage = itemData.system.usageCount;
    
            if (typeof usage !== 'object' || usage === null) {
                console.error(`アイテム「${item.name}」のusageCountが不正なデータです:`, usage);
                return; 
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
     * 【修正】アイテム作成ハンドラ
     * item.type ごとに適切な system データを初期化
     */
    async _onItemCreate(event) {
        event.preventDefault();
        const header = event.currentTarget;
        const type = header.dataset.type; // "generalSkill", "styleSkill", "outfit" etc.
        
        // 1. 一般技能 (generalSkill)
        if (type === 'generalSkill') {
            const itemData = {
                name: "新規一般技能",
                type: "generalSkill",
                system: {
                    level: 0,
                    generalSkillCategory: "onomasticSkill" // 【修正】system直下に設定
                }
            };
            return await Item.create(itemData, {parent: this.actor});
        } 
        
        // 2. スタイル技能 (styleSkill)
        else if (type === 'styleSkill') {
            const itemData = {
                name: "新規スタイル技能",
                type: "styleSkill",
                system: {
                    level: 0
                }
            };
            return await Item.create(itemData, {parent: this.actor});
        }
        
        // その他のアイテムタイプ
        return await Item.create({name: `新規${type}`, type: type}, {parent: this.actor});
    }

    /**
     * 【修正】経験点コスト取得ヘルパー
     * system直下のプロパティを参照するように修正
     */
    _getSkillExpCost(item) {
        const system = item.system;
        
        if (item.type === 'generalSkill') {
            // 【修正】system.generalSkillCategory を参照
            const genCategory = system.generalSkillCategory;
            if (genCategory === 'onomasticSkill') {
                return system.onomasticSkill?.expCost || 5;
            }
            if (genCategory === 'initialSkill') {
                return system.initialSkill?.expCost || 10;
            }
            return 10;
        }
        
        if (item.type === 'styleSkill') {
            // 【修正】system.styleSkillCategory を参照
            const styleCategory = system.styleSkillCategory;
            
            if (styleCategory === 'special') return system.special?.expCost || 10;
            if (styleCategory === 'performance') return system.performance?.expCost || 2;
            if (styleCategory === 'secret') return system.secret?.expCost || 20; 
            if (styleCategory === 'mystery') return system.mystery?.expCost || 50; 
            return 10;
        }

        return 0;
    }

    async _getHistoryData() {
        if (this.actor.system.playerId) {
            const player = await fromUuid(this.actor.system.playerId);
            if (player) {
                return foundry.utils.deepClone(player.system.history || []);
            }
        }
        return foundry.utils.deepClone(this.actor.system.history || []);
    }

    async _saveHistoryData(newHistory) {
        await this.actor.update({ "system.history": newHistory });

        if (this.actor.system.playerId) {
            try {
                const player = await fromUuid(this.actor.system.playerId);
                if (player) {
                    const sortedHistory = [...newHistory];
                    this._sortHistory(sortedHistory);
                    
                    const currentTotal = Number(this.actor.system.exp.total) || 0;

                    await player.update({ 
                        "system.history": sortedHistory,
                        "system.exp.total": currentTotal
                    });
                }
            } catch (e) {
                console.warn("Failed to sync with linked Record Sheet:", e);
            }
        }
    }

    async _updateExpTotal(diff) {
        const currentTotal = Number(this.actor.system.exp.total) || 0;
        await this.actor.update({
            "system.exp.total": currentTotal + diff
        });
    }

    /**
     * ▼▼▼ 追加: プレイヤーリンク解除処理 ▼▼▼
     */
    async _onUnlinkPlayer(event) {
        event.preventDefault();
        
        // 念のためIDがない場合は処理しない
        if (!this.actor.system.playerId) return;

        const confirm = await Dialog.confirm({
            title: game.i18n.localize("TNX.Common.Unlink"),
            content: `<p>${game.i18n.localize("TNX.ConfirmUnlinkPlayer")}</p>`,
            defaultYes: false
        });

        if (confirm) {
            await this.actor.update({ "system.playerId": "" });
        }
    }

    static async updateCastExp(actor) {
        if (!actor || actor.type !== 'cast') return;

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
        let totalItemCost = 0;
        actor.items.forEach(item => {
             totalItemCost += this._calcSingleItemCost(item);
        });
        const realSpent = totalAbilityCost + totalItemCost;
        const initialExp = 170;


        const additional = Number(actor.system.exp.additional) || 0;
        let historyTotal = 0;
        
        let player = null;
        if (actor.system.playerId) {
            try {
                const doc = await fromUuid(actor.system.playerId);
                if (doc) {
                    player = doc;
                    historyTotal = Number(doc.system.exp.total) || 0;
                }
            } catch (e) { console.warn(e); }
        } else {
            const history = actor.system.history || {};
            historyTotal = Object.values(history).reduce((sum, entry) => sum + (Number(entry.exp) || 0), 0);
        }

        const newTotal = additional + historyTotal;
        const newValue = (newTotal + initialExp) - realSpent;
        const newActorSpent = realSpent - initialExp;

        if (actor.system.exp.total !== newTotal || actor.system.exp.value !== newValue || actor.system.exp.spent !== newActorSpent) {
             await actor.update({
                 "system.exp.total": newTotal,
                 "system.exp.spent": newActorSpent,
                 "system.exp.value": newValue
             }, { calcExp: false });
        }
    }

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
     * 【修正】経験点コスト計算ロジック
     * system直下のプロパティを参照するように修正
     */
    static _calcSingleItemCost(item) {
        const system = item.system;
        const level = Number(system.level) || 0;
        
        // A. 一般技能
        if (item.type === 'generalSkill') {
            if (level <= 0) return 0;
            // 【修正】system.generalSkillCategory
            const genCat = system.generalSkillCategory;
            
            if (genCat === 'onomasticSkill') {
                let costPerLevel = Number(system.onomasticSkill?.expCost) || 5;
                if (system.onomasticSkill?.isInitial) {
                    return Math.max(0, level - 1) * costPerLevel;
                }
                return level * costPerLevel;
            } 
            else if (genCat === 'initialSkill') {
                let costPerLevel = Number(system.initialSkill?.expCost) || 10;
                return Math.max(0, level - 1) * costPerLevel;
            } 
            else {
                return level * 5; 
            }
        } 
        
        // B. スタイル技能
        else if (item.type === 'styleSkill') {
             if (level <= 0) return 0;
             let costPerLevel = 10;
             // 【修正】system.styleSkillCategory
             const sCat = system.styleSkillCategory;
             if (sCat === 'secret') costPerLevel = 20;
             else if (sCat === 'mystery') costPerLevel = 50;
             else if (sCat === 'special') costPerLevel = 10;
             
             return level * costPerLevel;
        }

        // C. その他のコストを持つアイテム
        return Number(item.system.expCost) || 0;
    }
}