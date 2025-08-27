import {
    RichConfirmDialog,
    CardSelectionDialog,
    TargetSelectionDialog
} from '../module/tnx-dialog.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';

export class TokyoNovaCastSheet extends ActorSheet {

    constructor(...args) {
        super(...args);
        this._isEditMode = this.actor.isOwner ? false : false;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "actor", "cast"],
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",
            width: 850,
            height: 900,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "abilities" }],
            dragDrop: [{ dragSelector: null, dropSelector: "form" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.actor.system;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;

        const allStyles = this.actor.items.filter(i => i.type === 'style');
        const allDivineWorks = this.actor.items.filter(i => i.type === 'divine_work');
        context.equippedAffiliations = this.actor.items.filter(i => i.type === 'organization');
        context.affiliationDisplay = context.equippedAffiliations[0]?.name || game.i18n.localize("TNX.Unaffiliated");
        
        context.styleSlots = this._prepareStyleSlots(allStyles);
        const divineWorkSlotsData = this._prepareDivineWorksForDisplay(allDivineWorks);
        context.divineWorkSlots = [...divineWorkSlotsData];
        while (context.divineWorkSlots.length < 3) {
            context.divineWorkSlots.push({ isEmpty: true });
        }
        context.divineWorkSlots = context.divineWorkSlots.slice(0, 3);

        context.divineWorkSlotsForView = [...divineWorkSlotsData];
        while (context.divineWorkSlotsForView.length < 3) {
            context.divineWorkSlotsForView.push({
                name: `神業${context.divineWorkSlotsForView.length + 1}`,
                isPlaceholder: true,
                _id: `placeholder-${context.divineWorkSlotsForView.length}`
            });
        }
        context.divineWorkSlotsForView = context.divineWorkSlotsForView.slice(0, 3);
        
        context.processedStylesForView = this._prepareStylesForView(allStyles);

        await this._getCardPileData(context);
        this._getCitizenRankData(context);
        this._getAbilitiesData(context, allStyles);

        return context;
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
            
            itemData.repeatedName = Array(level).fill(item.name).join('、');
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

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.edit-mode-toggle').on('click', this._onToggleEditMode.bind(this));
        html.find('.view-mode-style-summary .style-summary-item').on('click', this._onRollStyleDescription.bind(this));

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
            if (item.type === 'divine_work') {
                const usage = item.system.usageCount;
                // 使用回数(母数)が1より大きい場合
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    const newTotal = Math.max(0, usage.total - 1);
                    await item.update({
                        'system.usageCount.value': newValue,
                        'system.usageCount.total': newTotal
                    });
                    ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
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
        
        const divineWorkViewMenu = [
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
        new ContextMenu(html, '[data-context-menu="divine-work-view"]', divineWorkViewMenu);
        
        const unlinkMenu = [{
            name: game.i18n.localize("TNX.UnlinkCards"),
            icon: '<i class="fas fa-unlink"></i>',
            callback: panel => this.actor.update({ [panel.data('unlinkPath')]: "" })
        }];
        new ContextMenu(html, '[data-context-menu-type="unlink"]', unlinkMenu);
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
        const abilityLabels = { "reason": "TNX.Reason", "passion": "TNX.Passion", "life": "TNX.Life", "mundane": "TNX.Mundane" };
        
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
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (err) { return false; }
        
        if (data.type === "Cards") return this._onDropCardPile(event, data);
        if (data.type === "Item") return this._onDropItem(event, data);
        return false;
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

    async _onDropItem(event, data) {
        const item = await Item.fromDropData(data);
        if (!item) return;
        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;
    
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
                return existingItem.update({ 'system.level': currentLevel + 1 });
            } else {
                const itemData = item.toObject();
                if (!itemData.system.level) itemData.system.level = 1;
                if (totalLevel + itemData.system.level > 3) {
                    ui.notifications.warn("スタイルの合計レベルが3を超えてしまいます。");
                    return false;
                }
                return this.actor.createEmbeddedDocuments("Item", [itemData]);
            }
        }
    
        if (item.type === "divine_work" && dropArea === "divine_work") {
            const allDivineWorks = this.actor.items.filter(i => i.type === 'divine_work');
            const existingItem = allDivineWorks.find(i => i.name === item.name);
            if (existingItem) {
                const usage = existingItem.system.usageCount;
                const mod = usage.mod || 0;
                const newValue = Math.min(3, (usage.value || 0) + 1);
                const newTotal = newValue + mod; // ご指示通りtotalを再計算
                
                ui.notifications.info(`神業「${existingItem.name}」の母数が+1されました。`);
                return existingItem.update({
                    'system.usageCount.value': newValue,
                    'system.usageCount.total': newTotal
                });
            } else {
                if (allDivineWorks.length >= 3) {
                    ui.notifications.warn(`神業は3種類までしか所有できません。`);
                    return false;
                }
                const itemData = item.toObject();
                // データ移行ロジック
                if (!foundry.utils.hasProperty(itemData, "system.usageCount.value")) {
                    const mod = foundry.utils.getProperty(itemData, "system.usageCount.mod") || 0;
                    foundry.utils.setProperty(itemData, "system.usageCount", { value: 1, total: 1 + mod, mod: mod, used: 0 });
                }
                return this.actor.createEmbeddedDocuments("Item", [itemData]);
            }
        }
        
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
        return false;
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
        }
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
        const item = this.actor.items.get(itemId);
        if (!this.isEditable || !item) return;

        if (item.system.level === 3) {
            return ui.notifications.warn("スタイルレベルが3のため、役割は「ペルソナ」と「キー」で固定されています。");
        }

        let { isPersona, isKey } = item.system;
        if (!isPersona && !isKey) { isPersona = true; isKey = false; }
        else if (isPersona && !isKey) { isPersona = false; isKey = true; }
        else if (!isPersona && isKey) { isPersona = true; isKey = true; }
        else { isPersona = false; isKey = false; }
        
        await item.update({ 'system.isPersona': isPersona, 'system.isKey': isKey });
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

    async _onUseDivineWork(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest('[data-item-id]').dataset.itemId;
        const originalDivineWork = this.actor.items.get(itemId);
        console.log("▼▼▼ 神業使用時のデータチェック ▼▼▼");
        console.log("取得したアイテムオブジェクト:", originalDivineWork);
        console.log("システムデータ(system):", originalDivineWork?.system);
        if (!originalDivineWork) return;
    
        let targetDivineWork = originalDivineWork;
        let useAsOther = false; // 他の神業として使用するかどうかのフラグ
    
        // ▼▼▼ 万能神業(isAll)の場合のロジック ▼▼▼
        if (originalDivineWork.system.isAll) {
            // --- 1. 最初の確認ダイアログ ---
            useAsOther = await Dialog.confirm({
                title: game.i18n.localize("TNX.ConfirmUseAsOtherTitle"),
                content: `<p>${game.i18n.format("TNX.ConfirmUseAsOtherContent", { name: originalDivineWork.name })}</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
    
            // --- 2. 「はい」が選択された場合のみ、神業選択に移る ---
            if (useAsOther) {
                const divineWorkChoices = game.items.filter(i => 
                    i.type === 'divine_work' && i.name !== originalDivineWork.name
                );
    
                if (divineWorkChoices.length === 0) {
                    ui.notifications.warn("ワールドに選択可能な神業が存在しません。");
                    return; // ここで処理を中断
                }
    
                const selectedId = await TargetSelectionDialog.prompt({
                    title: game.i18n.localize("TNX.SelectOmniDivineWorkTitle"),
                    label: game.i18n.format("TNX.SelectOmniDivineWorkContent", { name: originalDivineWork.name }),
                    options: divineWorkChoices.map(dw => ({ value: dw.id, label: dw.name })),
                    selectLabel: game.i18n.localize("TNX.Select")
                });
    
                if (!selectedId) return; // 神業選択がキャンセルされた場合は終了
    
                const selectedWork = game.items.get(selectedId);
                if (!selectedWork) {
                    ui.notifications.error("選択された神業が見つかりませんでした。");
                    return;
                }
                
                targetDivineWork = selectedWork;
            }
        }
    
        // --- 使用回数のチェックと消費は「元の」神業で行う ---
        const remainingUses = originalDivineWork.system.usageCount.total || 0;
        if (remainingUses <= 0) {
            ui.notifications.warn(`神業「${originalDivineWork.name}」はこれ以上使用できません。`);
            return;
        }
    
        await originalDivineWork.update({
            "system.usageCount.total": remainingUses - 1,
            "system.isUsed": remainingUses - 1 === 0 // 残り回数が0になったら使用済みに
        });
    
        // --- チャットメッセージの作成と送信 (ここからが修正箇所) ---
        const originalDescription = await TextEditor.enrichHTML(originalDivineWork.system.description, { async: true });
        let nestedContent = ''; // ネストされるコンテンツ用の変数
    
        // 「はい」を選び、かつ実際に別の神業が選択された場合に追記
        if (useAsOther && targetDivineWork.id !== originalDivineWork.id) {
            const selectedDescription = await TextEditor.enrichHTML(targetDivineWork.system.description, { async: true });
            // ネスト部分を <details> タグで囲みます
            nestedContent = `
                <details class="nested-description">
                    <summary><h4>発動効果: ${targetDivineWork.name}</h4></summary>
                    <div class="card-content">
                        ${selectedDescription}
                    </div>
                </details>
            `;
        }

        const divineWorkName = originalDivineWork.name;
        const divineWorkFurigana = originalDivineWork.system.furigana;
        let nameHtml;

        if (divineWorkFurigana) {
            nameHtml = `<ruby>${divineWorkName}<rt>${divineWorkFurigana}</rt></ruby>`;
        } else {
            nameHtml = divineWorkName;
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
        const notificationMessage = (useAsOther && targetDivineWork.id !== originalDivineWork.id)
            ? `神業「${originalDivineWork.name}」を使用し、「${targetDivineWork.name}」の効果を発動しました。`
            : `神業「${originalDivineWork.name}」を使用しました。`;
            
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
        const name = input.name; // "system.reason.growth" など
        const newValue = parseInt(input.value, 10) || 0;

        const oldValue = foundry.utils.getProperty(this.actor, name) || 0;
        if (newValue === oldValue) return;

        // 能力値のキー（"reason"など）と、制御値かどうか（isControl）を特定
        const parts = name.split('.');
        const abilityKey = parts[1];
        const isControl = name.endsWith('controlGrowth');

        // スタイルによる能力値の合計を計算（計算のベースとなるため）
        const allStyles = this.actor.items.filter(i => i.type === 'style');
        let styleTotalValue = 0;
        let styleTotalControl = 0;
        allStyles.forEach(style => {
            const level = style.system.level || 1;
            styleTotalValue += (style.system[abilityKey]?.value || 0) * level;
            styleTotalControl += (style.system[abilityKey]?.control || 0) * level;
        });
        
        const ability = this.actor.system[abilityKey];
        const baseValue = styleTotalValue + (ability.mod || 0) + (ability.effectMod || 0);
        const baseControl = styleTotalControl + (ability.controlMod || 0) + (ability.controlEffectMod || 0);
        const baseForCalc = isControl ? baseControl : baseValue;

        // コストを計算
        const costForOld = this._calculateGrowthCost(isControl, oldValue, baseForCalc);
        const costForNew = this._calculateGrowthCost(isControl, newValue, baseForCalc);
        const totalCost = costForNew - costForOld;

        const currentExp = this.actor.system.exp.value;

        // 経験点が足りない場合は処理を中断
        if (totalCost > 0 && totalCost > currentExp) {
            ui.notifications.warn(`経験点が足りません！ (必要: ${totalCost} / 所持: ${currentExp})`);
            input.value = oldValue; // 入力値を元に戻す
            return;
        }

        // アクターのデータ（成長値と経験点）を更新
        const newExp = currentExp - totalCost;
        await this.actor.update({
            [name]: newValue,
            'system.exp.value': newExp
        });

        // ユーザーへの通知
        const abilityLabel = game.i18n.localize(this.actor.system.abilities[abilityKey].label);
        const changeType = isControl ? "制御値" : "能力値";
        const costText = totalCost > 0 ? `${totalCost}点 消費` : `${-totalCost}点 回復`;
        ui.notifications.info(`${abilityLabel} [${changeType}] の成長が変更されました (${costText})。`);
    }

    /**
     * 指定された成長ポイントまでの累積経験点コストを計算するヘルパーメソッド
     * @param {boolean} isControl 制御値の計算かどうか
     * @param {number} growthPoints 計算対象の成長ポイント
     * @param {number} baseValue スタイルや修正など、成長以外の合計値
     * @returns {number} 累積コスト
     * @private
     */
    _calculateGrowthCost(isControl, growthPoints, baseValue) {
        if (growthPoints <= 0) return 0;
        
        const costTier1 = 20;
        const costTier2 = 40;
        // 能力値は11から、制御値は17からコストが上がる
        const threshold = isControl ? 17 : 11;
        
        let totalCost = 0;
        for (let i = 1; i <= growthPoints; i++) {
            const currentTotalValue = baseValue + i;
            totalCost += (currentTotalValue < threshold) ? costTier1 : costTier2;
        }
        return totalCost;
    }

    /**
     * 神業アイテムの表示用データを、使用回数に基づいて生成します。
     * @param {Array<Item>} divineWorks アクターが所有する神業アイテムの配列
     * @returns {Array<Object>} 表示用の神業データ配列
     * @private
     */
    _prepareDivineWorksForDisplay(divineWorks) {
        const slots = [];
        divineWorks.forEach(item => {
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
}