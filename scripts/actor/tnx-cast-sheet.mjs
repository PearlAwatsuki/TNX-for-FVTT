import { TargetSelectionDialog } from '../module/tnx-dialog.mjs';
import { TnxSkillUtils } from '../module/tnx-skill-utils.mjs';
import { TnxHistoryMixin } from '../module/tnx-history-mixin.mjs';
import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { getUserFlagData, TNX_FLAG_SCOPE } from '../module/user-flag-schema.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class TokyoNovaCastSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

    _isEditMode = false;
    tabGroups = { primary: "abilities" };
    _scrollPositions = {};

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "cast"],
        position: { width: 950, height: 1000 },
        window: {
            resizable: true,
            controls: [
                {
                    action: "copyUuid",
                    icon: "fas fa-passport",
                    label: "UUIDをコピー",
                    ownership: "OBSERVER",
                }
            ]
        },
        form: { submitOnChange: true },
        actions: {
            ...EffectsSheetMixin.ACTIONS,
            ...TnxHistoryMixin.ACTIONS,
            copyUuid:             TokyoNovaCastSheet._onCopyUuid,
            toggleEditMode:       TokyoNovaCastSheet._onToggleEditMode,
            toggleStyleRole:      TokyoNovaCastSheet._onToggleStyleRole,
            useMiracle:           TokyoNovaCastSheet._onUseMiracle,
            rollStyleDescription: TokyoNovaCastSheet._onRollStyleDescription,
            openItemSheet:        TokyoNovaCastSheet._onOpenItemSheet,
            itemCreate:           TokyoNovaCastSheet._onItemCreate,
            itemDelete:           TokyoNovaCastSheet._onItemDelete,
            removeBadStatus:      TokyoNovaCastSheet._onRemoveBadStatus,
            toggleAbilityDetails: TokyoNovaCastSheet._onToggleAbilityDetails,
        },
        dragDrop: [{ dragSelector: ".item-list .item, .style-skills-list .item", dropSelector: null }],
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities"],
        },
    };

    // ─── コンテキスト準備 ──────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.actor;
        context.system = this.actor.system;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;
        context.cssClass = "";

        context.TNX = {
            SUITS: {
                spade:   { label: "TNX.Suits.spade",   icon: "fa-solid fa-spade" },
                club:    { label: "TNX.Suits.club",    icon: "fa-solid fa-club" },
                heart:   { label: "TNX.Suits.heart",   icon: "fa-solid fa-heart" },
                diamond: { label: "TNX.Suits.diamond", icon: "fa-solid fa-diamond" }
            }
        };

        const allStyles   = this.actor.items.filter(i => i.type === 'style');
        const allMiracles = this.actor.items.filter(i => i.type === 'miracle');
        context.equippedAffiliations = this.actor.items.filter(i => i.type === 'organization');
        context.affiliationDisplay   = context.equippedAffiliations[0]?.name
            || game.i18n.localize("TNX.Actor.Profile.Unaffiliated");

        context.styleSlots = this._prepareStyleSlots(allStyles);

        const miracleSlotsData = this._prepareMiraclesForDisplay(allMiracles);
        context.miracleSlots = [...miracleSlotsData];
        while (context.miracleSlots.length < 3) context.miracleSlots.push({ isEmpty: true });
        context.miracleSlots = context.miracleSlots.slice(0, 3);

        context.miracleSlotsForView = [...miracleSlotsData];
        while (context.miracleSlotsForView.length < 3) {
            context.miracleSlotsForView.push({
                name: game.i18n.format("TNX.Ui.Label.MiracleSlot", { number: context.miracleSlotsForView.length + 1 }),
                isPlaceholder: true,
                _id: `placeholder-${context.miracleSlotsForView.length}`
            });
        }
        context.miracleSlotsForView = context.miracleSlotsForView.slice(0, 3);

        context.processedStylesForView = this._prepareStylesForView(allStyles);

        context.history = TnxHistoryMixin._prepareHistoryForDisplay(this.actor.system.history);

        const bsList = [];
        this.actor.effects.forEach(e => {
            if (e.disabled) return;
            let hasStatusCondition = false;
            if (e.statuses && e.statuses.size > 0) {
                e.statuses.forEach(statusId => {
                    const statusConfig = CONFIG.statusEffects.find(s => s.id === statusId);
                    if (statusConfig) {
                        bsList.push({
                            id:      e.id,
                            statusId,
                            name:    statusConfig.name,
                            img:     statusConfig.img,
                            details: e.flags?.["tokyo-nova-axleration"]?.details || ""
                        });
                        hasStatusCondition = true;
                    }
                });
            }
            if (!hasStatusCondition && e.flags?.["tokyo-nova-axleration"]?.isBadStatus) {
                bsList.push({
                    id:      e.id,
                    statusId: null,
                    name:    e.name,
                    img:     e.img,
                    details: e.flags?.["tokyo-nova-axleration"]?.details || ""
                });
            }
        });
        context.badStatuses = bsList;

        this._getCitizenRankData(context);
        this._getAbilitiesData(context, allStyles);
        this._prepareSkillsData(context);
        EffectsSheetMixin.prepareEffectsContext(this.actor, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive
        ];

        return context;
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    async _preRender(_context, _options) {
        if (!this.element) return;
        this.element.classList.add("tnx-no-transitions");
        this._scrollPositions = {};
        for (const sel of [
            ".profile-sidebar", ".sheet-body",
            ".tab[data-tab='abilities']", ".tab[data-tab='check']",
            ".tab[data-tab='outfits']",  ".tab[data-tab='status']",
            ".tab[data-tab='history']",  ".tab[data-tab='profile']",
        ]) {
            const el = this.element.querySelector(sel);
            if (el) this._scrollPositions[sel] = el.scrollTop;
        }
    }

    _onRender(context, _options) {
        const el = this.element;

        el.classList.toggle("edit-mode",  !!context.isEditMode);
        el.classList.toggle("view-mode", !context.isEditMode);

        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* PARTS にそのタブがない場合は無視 */ }
            }
        }

        // 編集モードトグルボタン(ウィンドウヘッダー左端)
        const header = el.querySelector(".window-header");
        if (header && this.isEditable && !header.querySelector(".edit-mode-toggle")) {
            const toggleBtn = document.createElement("a");
            toggleBtn.className = "edit-mode-toggle";
            toggleBtn.title = "編集モード切替";
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
            toggleBtn.addEventListener("click", ev => {
                ev.preventDefault();
                TokyoNovaCastSheet._onToggleEditMode.call(this, ev, toggleBtn);
            });
            header.prepend(toggleBtn);
        }

        // スキルプロパティ変更(EXP 連動あり、data-action 外で処理)
        for (const input of el.querySelectorAll(".skill-property-change")) {
            input.addEventListener("change", ev => this._onSkillPropertyChange(ev));
        }

        // クラスベースのアイテム操作
        for (const btn of el.querySelectorAll(".item-edit")) {
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                const itemId = ev.currentTarget.dataset.itemId;
                this.actor.items.get(itemId)?.sheet.render({ force: true });
            });
        }
        for (const btn of el.querySelectorAll(".item-delete")) {
            btn.addEventListener("click", ev => TokyoNovaCastSheet._onItemDelete.call(this, ev, ev.currentTarget));
        }
        for (const btn of el.querySelectorAll(".item-create")) {
            btn.addEventListener("click", ev => TokyoNovaCastSheet._onItemCreate.call(this, ev, ev.currentTarget));
        }

        // スタイル技能行のコンテキストメニュートリガー
        for (const trigger of el.querySelectorAll(".style-skills-list .item-menu-trigger")) {
            trigger.addEventListener("click", ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const row = ev.currentTarget.closest(".style-skill-row");
                if (row) {
                    row.dispatchEvent(new MouseEvent("contextmenu", {
                        bubbles: true, cancelable: true, view: window,
                        clientX: ev.clientX, clientY: ev.clientY, buttons: 2
                    }));
                }
            });
        }

        TnxHistoryMixin.activateHistoryListeners.call(this, el);
        this._activateContextMenus(el);
        this._applyTextSqueezing();

        // 再描画後にスクロール位置を復元する
        const saved = this._scrollPositions;
        this._scrollPositions = {};
        requestAnimationFrame(() => {
            for (const [sel, top] of Object.entries(saved)) {
                if (!top) continue;
                const target = this.element?.querySelector(sel);
                if (target) target.scrollTop = top;
            }
            this.element?.classList.remove("tnx-no-transitions");
        });
    }

    // ─── 履歴更新(TnxHistoryMixin から呼ばれる) ──────────────────────────────

    async _performHistoryUpdate(updateData) {
        const ownerUserId = this.actor.system.ownerUserId;

        // A. User flag にリンクしている場合
        if (ownerUserId) {
            const ownerUser = game.users.find(u => u.uuid === ownerUserId);
            if (ownerUser) {
                const flagUpdate = {};
                for (const [key, value] of Object.entries(updateData)) {
                    if (key.startsWith("system.history")) {
                        flagUpdate[key.replace("system.history", `flags.${TNX_FLAG_SCOPE}.history`)] = value;
                    } else if (key === "system.exp.total") {
                        flagUpdate[`flags.${TNX_FLAG_SCOPE}.exp.total`] = value;
                    }
                }
                await ownerUser.update(flagUpdate);

                const historyUpdate = {};
                for (const [key, value] of Object.entries(updateData)) {
                    if (key.startsWith("system.history")) historyUpdate[key] = value;
                }
                if (!foundry.utils.isEmpty(historyUpdate)) {
                    await this.actor.update(historyUpdate, { calcExp: false });
                }
                return;
            }
        }

        // B. スタンドアロン
        await this.actor.update(updateData);
        TokyoNovaCastSheet.updateCastExp(this.actor);
    }

    // ─── データ準備ヘルパー ────────────────────────────────────────────────────

    _prepareStyleSlots(styles) {
        const slots = [];
        styles.forEach(item => {
            const itemData = item.toObject(false);
            itemData.isEmpty = false;
            itemData.isPersona = item.system.level === 3 ? true : item.system.isPersona;
            itemData.isKey     = item.system.level === 3 ? true : item.system.isKey;
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(itemData.isPersona, itemData.isKey);
            itemData.roleIndicatorClass   = this._getRoleIndicatorClass(itemData.isPersona, itemData.isKey);
            for (let i = 0; i < item.system.level; i++) {
                if (slots.length < 3) slots.push(itemData);
            }
        });
        while (slots.length < 3) slots.push({ isEmpty: true });
        return slots;
    }

    _prepareStylesForView(styles) {
        return styles.map(item => {
            const itemData = item.toObject(false);
            const level    = item.system.level || 1;
            const isPersona = level === 3 ? true : item.system.isPersona;
            const isKey     = level === 3 ? true : item.system.isKey;
            itemData.repeatedName          = Array(level).fill(item.name).join('=');
            itemData.roleIndicatorDisplay  = this._getRoleIndicatorSymbol(isPersona, isKey);
            return itemData;
        });
    }

    _prepareGenericSlots(items, maxSlots) {
        const slots = [];
        for (let i = 0; i < maxSlots; i++) {
            const item = items[i];
            slots.push(item ? { ...item.toObject(false), isEmpty: false } : { isEmpty: true });
        }
        return slots;
    }

    _prepareSkillsData(context) {
        const generalSkills = this.actor.items
            .filter(i => i.type === 'generalSkill')
            .sort((a, b) => a.sort - b.sort);
        context.generalSkills = generalSkills;
        const halfIndex = Math.ceil(generalSkills.length / 2);
        context.generalSkillColumns = [generalSkills.slice(0, halfIndex), generalSkills.slice(halfIndex)];

        context.styleSkills = this.actor.items
            .filter(i => i.type === 'styleSkill')
            .sort((a, b) => a.sort - b.sort);

        const skillOptions = TnxSkillUtils.getSkillOptions();
        context.styleSkills.forEach(item => {
            if (item.type === 'styleSkill') {
                item.view = TnxSkillUtils.prepareStyleSkillView(item.system, skillOptions);
            }
        });
    }

    _prepareMiraclesForDisplay(miracles) {
        const slots = [];
        miracles.forEach(item => {
            const itemData = item.toObject(false);
            const usage    = itemData.system.usageCount;
            if (typeof usage !== 'object' || usage === null) {
                console.error(`アイテム「${item.name}」のusageCountが不正なデータです:`, usage);
                return;
            }
            const maxUses       = (usage.value) + (usage.mod);
            const remainingUses = usage.total;
            for (let i = 0; i < maxUses; i++) {
                slots.push({ ...itemData, isPlaceholder: false, instanceIndex: i, isDisabled: i >= remainingUses });
            }
        });
        return slots;
    }

    // ─── ドラッグ&ドロップ ────────────────────────────────────────────────────

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

        if (item.type === "style" && dropArea === "style") {
            const allStyles  = this.actor.items.filter(i => i.type === 'style');
            const totalLevel = allStyles.reduce((sum, s) => sum + (s.system.level || 1), 0);
            const existingItem = allStyles.find(i => i.name === item.name);

            if (existingItem) {
                if (totalLevel >= 3) { ui.notifications.warn("これ以上スタイルレベルを上げられません。"); return false; }
                await existingItem.update({ 'system.level': (existingItem.system.level || 1) + 1 });
                return existingItem;
            } else {
                const itemData = item.toObject();
                if (!itemData.system.level) itemData.system.level = 1;
                if (totalLevel + itemData.system.level > 3) {
                    ui.notifications.warn("スタイルの合計レベルが3を超えてしまいます。"); return false;
                }
                const createdItems = await this.actor.createEmbeddedDocuments("Item", [itemData]);
                const createdStyle = createdItems[0];
                if (createdStyle) {
                    const miracleUuid = createdStyle.system.miracle?.id;
                    if (miracleUuid) {
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (sourceMiracle) {
                            const allMiracles    = this.actor.items.filter(i => i.type === 'miracle');
                            const existingMiracle = allMiracles.find(i => i.name === sourceMiracle.name);
                            if (existingMiracle) {
                                const { mod, value } = existingMiracle.system.usageCount;
                                const newValue = Math.min(3, value + 1);
                                ui.notifications.info(`神業「${existingMiracle.name}」の母数が+1されました。`);
                                await existingMiracle.update({
                                    'system.usageCount.value': newValue,
                                    'system.usageCount.total': newValue + mod
                                });
                            } else if (allMiracles.length >= 3) {
                                ui.notifications.warn("神業は3種類までしか所有できません。");
                            } else {
                                const miracleData = sourceMiracle.toObject();
                                if (!foundry.utils.hasProperty(miracleData, "system.usageCount.value")) {
                                    const mod = foundry.utils.getProperty(miracleData, "system.usageCount.mod");
                                    foundry.utils.setProperty(miracleData, "system.usageCount", { value: 1, total: 1 + mod, mod, used: 0 });
                                }
                                await this.actor.createEmbeddedDocuments("Item", [miracleData]);
                                ui.notifications.info(`神業「${miracleData.name}」がスタイル「${createdStyle.name}」から追加されました。`);
                            }
                        }
                    }
                }
                return createdStyle;
            }
        }

        if (item.type === "miracle" && dropArea === "miracle") {
            const allMiracles  = this.actor.items.filter(i => i.type === 'miracle');
            const existingItem = allMiracles.find(i => i.name === item.name);
            if (existingItem) {
                const { mod, value } = existingItem.system.usageCount;
                const newValue = Math.min(3, value + 1);
                ui.notifications.info(`神業「${existingItem.name}」の母数が+1されました。`);
                return existingItem.update({ 'system.usageCount.value': newValue, 'system.usageCount.total': newValue + mod });
            } else {
                if (allMiracles.length >= 3) { ui.notifications.warn("神業は3種類までしか所有できません。"); return false; }
                const itemData = item.toObject();
                if (!foundry.utils.hasProperty(itemData, "system.usageCount.value")) {
                    const mod = foundry.utils.getProperty(itemData, "system.usageCount.mod");
                    foundry.utils.setProperty(itemData, "system.usageCount", { value: 1, total: 1 + mod, mod, used: 0 });
                }
                return this.actor.createEmbeddedDocuments("Item", [itemData]);
            }
        }

        const itemLimits = { organization: { limit: 1, area: 'affiliation' } };
        const rule = itemLimits[item.type];
        if (rule && rule.area === dropArea) {
            const count = this.actor.items.filter(i => i.type === item.type).length;
            if (count >= rule.limit) { ui.notifications.warn(`${item.name}は${rule.limit}つまでしか所有できません。`); return false; }
            return this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
        }

        return super._onDropItem(event, data);
    }

    // ─── コンテキストメニュー ──────────────────────────────────────────────────

    _activateContextMenus(el) {
        const itemDeleteCallback = async header => {
            const itemId = header.dataset.itemId;
            const item   = this.actor.items.get(itemId);
            if (!item) return;

            if (item.type === 'miracle') {
                const usage = item.system.usageCount;
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    await item.update({ 'system.usageCount.value': newValue, 'system.usageCount.total': Math.max(0, usage.total - 1) });
                    ui.notifications.info(game.i18n.format("TNX.Notification.MiracleCountDecreased", { name: item.name }));
                    return;
                }
            }

            if (item.type === 'style' && item.system.level > 1) {
                await item.update({ 'system.level': item.system.level - 1 });
                return;
            }

            await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        };

        const itemContextMenu = [{
            name:      "SHEET.ItemDelete",
            icon:      '<i class="fas fa-trash"></i>',
            condition: header => !!header.dataset.itemId,
            callback:  itemDeleteCallback
        }];
        new ContextMenu(el, '.item-button[data-context-menu="item-edit"]', itemContextMenu);

        const miracleViewMenu = [
            {
                name:      "閲覧",
                icon:      '<i class="fas fa-eye"></i>',
                condition: header => !!header.dataset.itemId,
                callback:  header => this.actor.items.get(header.dataset.itemId)?.sheet.render({ force: true })
            },
            {
                name:      "削除",
                icon:      '<i class="fas fa-trash"></i>',
                condition: header => this.isEditable && !!header.dataset.itemId,
                callback:  itemDeleteCallback
            }
        ];
        new ContextMenu(el, '[data-context-menu="miracle-view"]', miracleViewMenu);

        const styleSkillOptions = [
            {
                name: "SHEET.ItemEdit",
                icon: '<i class="fas fa-edit"></i>',
                callback: header => {
                    const itemId = header.dataset.itemId || header.closest('[data-item-id]')?.dataset.itemId;
                    this.actor.items.get(itemId)?.sheet.render({ force: true });
                }
            },
            {
                name:     "SHEET.ItemDelete",
                icon:     '<i class="fas fa-trash"></i>',
                callback: itemDeleteCallback
            }
        ];
        new ContextMenu(el, ".style-skills-list .style-skill-row", styleSkillOptions);
    }

    // ─── テキスト圧縮 ─────────────────────────────────────────────────────────

    _applyTextSqueezing() {
        if (!this.element) return;
        for (const el of this.element.querySelectorAll('.squeeze-text')) {
            const parent      = el.parentElement;
            const parentStyle = getComputedStyle(parent);
            const availableWidth = parent.clientWidth
                - parseFloat(parentStyle.paddingLeft)
                - parseFloat(parentStyle.paddingRight)
                - 2;
            const contentWidth = el.scrollWidth;
            const isSkewedLabel = el.classList.contains('skill-label-content');
            const transformBase = isSkewedLabel ? 'skewX(25deg)' : '';
            if (contentWidth > availableWidth) {
                el.style.transform = `${transformBase} scaleX(${(availableWidth / contentWidth) * 0.95})`;
            } else {
                el.style.transform = transformBase;
            }
        }
    }

    // ─── カードパイルヘルパー(将来利用) ──────────────────────────────────────

    async _getCardPileData(context) {
        const handPileData = await this._fetchLinkedCardPile(context.system.handPileId, "system.handPileId");
        context.handPile = handPileData ?? null;

        const trumpPileData = await this._fetchLinkedCardPile(context.system.trumpCardPileId, "system.trumpCardPileId");
        context.trumpCardPile = trumpPileData ?? null;
        context.trumpCard     = trumpPileData?.cards?.[0] ?? null;
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

    // ─── 市民ランク・能力値データ ─────────────────────────────────────────────

    _getCitizenRankData(context) {
        const currentRank = context.system.citizenRank;
        const rankMap = { "A": "A", "B+": "B+", "B": "B", "B-": "B-", "C+": "C+", "C": "C", "C-": "C-", "X": "X" };
        context.citizenRankOptionsForSelect = Object.entries(rankMap).map(([value]) => ({
            value,
            label:    game.i18n.localize(value),
            selected: value === currentRank
        }));
    }

    _getAbilitiesData(context, equippedStyles) {
        context.system.abilities = {};
        const abilityKeys   = ["reason", "passion", "life", "mundane"];
        const abilityLabels = {
            reason:  game.i18n.format("TNX.Ability.Reason",   { suit: "♠" }),
            passion: game.i18n.format("TNX.Ability.Passion",  { suit: "♣" }),
            life:    game.i18n.format("TNX.Ability.Life",     { suit: "♥" }),
            mundane: game.i18n.format("TNX.Ability.Mundane",  { suit: "♦" })
        };

        for (const key of abilityKeys) {
            const ability = context.system[key];
            let styleTotalValue = 0, styleTotalControl = 0;
            const styleContributions = equippedStyles.map(style => {
                const level   = style.system.level || 1;
                const sVal    = style.system[key].value   * level;
                const sCtrl   = style.system[key].control * level;
                styleTotalValue   += sVal;
                styleTotalControl += sCtrl;
                return { name: style.name, value: sVal, control: sCtrl, level };
            });
            context.system.abilities[key] = {
                label:           abilityLabels[key],
                growth:          ability.growth,
                controlGrowth:   ability.controlGrowth,
                mod:             ability.mod,
                controlMod:      ability.controlMod,
                effectMod:       ability.effectMod,
                controlEffectMod: ability.controlEffectMod,
                styleContributions,
                totalValue:   ability.growth + styleTotalValue   + ability.mod + ability.effectMod,
                totalControl: ability.controlGrowth + styleTotalControl + ability.controlMod + ability.controlEffectMod
            };
        }
    }

    // ─── スキルプロパティ変更(EXP 連動) ──────────────────────────────────────

    async _onSkillPropertyChange(event) {
        event.preventDefault();
        const input  = event.currentTarget;
        const itemId = input.closest('.item')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const target = input.dataset.target;
        let newLevel  = item.system.level;
        const updateData = {};

        if (target === "level") {
            newLevel = parseInt(input.value, 10);
            updateData["system.level"] = newLevel;
        } else if (target === "suit") {
            const suitKey = input.dataset.suit;
            updateData[`system.suits.${suitKey}`] = input.checked;
            const currentSuits = item.system.suits;
            newLevel = 0;
            for (const key of ["spade", "club", "heart", "diamond"]) {
                if ((key === suitKey ? input.checked : currentSuits[key])) newLevel++;
            }
            updateData["system.level"] = newLevel;
        }

        const oldLevel = item.system.level;
        if (newLevel === oldLevel) { await item.update(updateData); return; }

        const expCostPerLevel    = this._getSkillExpCost(item);
        const isInitialOnomastic = (item.type === 'generalSkill')
            && (item.system.generalSkillCategory === 'onomasticSkill')
            && (item.system.onomasticSkill?.isInitial);

        const totalCost = isInitialOnomastic
            ? (Math.max(0, newLevel - 1) - Math.max(0, oldLevel - 1)) * expCostPerLevel
            : (newLevel - oldLevel) * expCostPerLevel;

        const currentExp = this.actor.system.exp.value;
        if (totalCost > 0 && totalCost > currentExp) {
            if (target === "level")  input.value   = oldLevel;
            else if (target === "suit") input.checked = !input.checked;
            return;
        }

        if (totalCost !== 0) {
            await this.actor.update({ "system.exp.value": currentExp - totalCost });
        }
        await item.update(updateData);
    }

    _getSkillExpCost(item) {
        const system = item.system;
        if (item.type === 'generalSkill') {
            const genCategory = system.generalSkillCategory;
            if (genCategory === 'onomasticSkill') return system.onomasticSkill?.expCost || 5;
            if (genCategory === 'initialSkill')   return system.initialSkill?.expCost  || 10;
            return 10;
        }
        if (item.type === 'styleSkill') {
            const styleCategory = system.styleSkillCategory;
            if (styleCategory === 'special')     return system.special?.expCost     || 10;
            if (styleCategory === 'performance') return system.performance?.expCost || 2;
            if (styleCategory === 'secret')      return system.secret?.expCost      || 20;
            if (styleCategory === 'mystery')     return system.mystery?.expCost     || 50;
            return 10;
        }
        return 0;
    }

    _getRoleIndicatorSymbol(isPersona, isKey) {
        if (isPersona && isKey) return "◎●";
        if (isPersona)          return "◎";
        if (isKey)              return "●";
        return "";
    }

    _getRoleIndicatorClass(isPersona, isKey) {
        if (isPersona && isKey) return "role-pk";
        if (isPersona)          return "role-p";
        if (isKey)              return "role-k";
        return "role-shadow";
    }

    // ─── 静的アクションハンドラ ────────────────────────────────────────────────

    static _onCopyUuid(event, _target) {
        event.preventDefault();
        game.clipboard.copyPlainText(this.document.uuid);
        ui.notifications.info(game.i18n.format("DOCUMENT.IdCopiedClipboard", {
            label: this.document.documentName, type: "UUID", id: this.document.uuid
        }));
    }

    static _onToggleEditMode(event, _target) {
        if (event) event.preventDefault();
        this._isEditMode = !this._isEditMode;
        this.render();
    }

    static _onOpenItemSheet(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        this.actor.items.get(itemId)?.sheet.render({ force: true });
    }

    static async _onItemCreate(event, target) {
        event.preventDefault();
        const type = target.dataset.type;
        if (type === 'generalSkill') {
            return Item.create({ name: "新規一般技能", type: "generalSkill",
                system: { level: 0, generalSkillCategory: "onomasticSkill" }
            }, { parent: this.actor });
        }
        if (type === 'styleSkill') {
            return Item.create({ name: "新規スタイル技能", type: "styleSkill",
                system: { level: 0 }
            }, { parent: this.actor });
        }
        return Item.create({ name: `新規${type}`, type }, { parent: this.actor });
    }

    static async _onItemDelete(event, target) {
        event.preventDefault();
        const li     = target.closest(".item");
        const itemId = li?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window:  { title: game.i18n.localize("SHEET.ItemDelete") },
            content: `<p>${game.i18n.format("SHEET.Delete", { name: item.name })}</p>`
        });
        if (confirmed) {
            await item.delete();
            this.render();
        }
    }

    static async _onUseMiracle(event, target) {
        event.preventDefault();
        const itemId          = target.closest('[data-item-id]')?.dataset.itemId;
        const originalMiracle = this.actor.items.get(itemId);
        if (!originalMiracle) return;

        let targetMiracle = originalMiracle;

        if (originalMiracle.system.isAll) {
            const useAsOther = await foundry.applications.api.DialogV2.confirm({
                window:  { title: game.i18n.localize("TNX.ConfirmUseAsOtherTitle") },
                content: `<p>${game.i18n.format("TNX.ConfirmUseAsOtherContent", { name: originalMiracle.name })}</p>`
            });

            if (useAsOther) {
                const miracleChoices = game.items.filter(i => i.type === 'miracle' && i.name !== originalMiracle.name);
                if (miracleChoices.length === 0) { ui.notifications.warn("ワールドに選択可能な神業が存在しません。"); return; }

                const selectedId = await TargetSelectionDialog.prompt({
                    title:       game.i18n.localize("TNX.SelectOmniMiracleTitle"),
                    label:       game.i18n.format("TNX.SelectOmniMiracleContent", { name: originalMiracle.name }),
                    options:     miracleChoices.map(dw => ({ value: dw.id, label: dw.name })),
                    selectLabel: game.i18n.localize("TNX.Select")
                });
                if (!selectedId) return;

                const selectedWork = game.items.get(selectedId);
                if (!selectedWork) { ui.notifications.error("選択された神業が見つかりませんでした。"); return; }
                targetMiracle = selectedWork;
            }
        }

        const remainingUses = originalMiracle.system.usageCount.total;
        if (remainingUses <= 0) { ui.notifications.warn(`神業「${originalMiracle.name}」はこれ以上使用できません。`); return; }

        await originalMiracle.update({
            "system.usageCount.total": remainingUses - 1,
            "system.isUsed":           remainingUses - 1 === 0
        });

        const enrichHTML = foundry.applications.ux.TextEditor.enrichHTML.bind(foundry.applications.ux.TextEditor);
        const originalDescription = await enrichHTML(originalMiracle.system.description, { async: true });

        let nestedContent = '';
        const isOther = targetMiracle.id !== originalMiracle.id;
        if (isOther) {
            const selectedDescription = await enrichHTML(targetMiracle.system.description, { async: true });
            nestedContent = `
                <details class="nested-description">
                    <summary><h4>発動効果: ${targetMiracle.name}</h4></summary>
                    <div class="card-content">${selectedDescription}</div>
                </details>`;
        }

        const miracleFurigana = originalMiracle.system.furigana;
        const nameHtml = miracleFurigana
            ? `<ruby>${originalMiracle.name}<rt>${miracleFurigana}</rt></ruby>`
            : originalMiracle.name;

        ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `<details class="tnx-chat-card"><summary><h3>神業: ${nameHtml}</h3></summary>
                <div class="card-content">${originalDescription}${nestedContent}</div></details>`,
            flags: { "core.canPopout": true }
        });

        ui.notifications.info(isOther
            ? `神業「${originalMiracle.name}」を使用し、「${targetMiracle.name}」の効果を発動しました。`
            : `神業「${originalMiracle.name}」を使用しました。`
        );
    }

    static async _onRollStyleDescription(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            item.system.description, { async: true }
        );
        ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `<details class="tnx-chat-card" open>
                <summary><h3>スタイル: ${item.name}</h3></summary>
                <div class="card-content">${enrichedDescription}</div>
            </details>`,
            flags: { "core.canPopout": true }
        });
    }

    static async _onToggleStyleRole(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const itemId      = target.closest('[data-item-id]')?.dataset.itemId;
        const clickedItem = this.actor.items.get(itemId);
        if (!this.isEditable || !clickedItem) return;

        if (clickedItem.system.level === 3) {
            return ui.notifications.warn("スタイルレベルが3のため、役割は「ペルソナ」と「キー」で固定されています。");
        }

        const { isPersona, isKey } = clickedItem.system;
        let nextIsPersona, nextIsKey;
        if (!isPersona && !isKey)     { nextIsPersona = true;  nextIsKey = false; }
        else if (isPersona && !isKey) { nextIsPersona = false; nextIsKey = true;  }
        else if (!isPersona && isKey) { nextIsPersona = true;  nextIsKey = true;  }
        else                          { nextIsPersona = false; nextIsKey = false; }

        const updates    = [];
        const allStyles  = this.actor.items.filter(i => i.type === 'style');
        for (const style of allStyles) {
            if (style.system.level === 3) continue;
            const updateData = { _id: style.id };
            let needsUpdate  = false;
            if (style.id === clickedItem.id) {
                updateData['system.isPersona'] = nextIsPersona;
                updateData['system.isKey']     = nextIsKey;
                needsUpdate = true;
            } else {
                if (nextIsPersona && style.system.isPersona) { updateData['system.isPersona'] = false; needsUpdate = true; }
                if (nextIsKey     && style.system.isKey)     { updateData['system.isKey']     = false; needsUpdate = true; }
            }
            if (needsUpdate) updates.push(updateData);
        }
        if (updates.length > 0) await this.actor.updateEmbeddedDocuments("Item", updates);
    }

    static _onToggleAbilityDetails(event, target) {
        event.preventDefault();
        const panel = target.closest('.ability-block')?.querySelector('.ability-details-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
        const icon = target.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-chevron-down');
            icon.classList.toggle('fa-chevron-up');
        }
    }

    static async _onRemoveBadStatus(event, target) {
        event.preventDefault();
        const effectId = target.dataset.effectId;
        const statusId = target.dataset.statusId || null;
        const effect   = this.actor.effects.get(effectId);
        if (!effect) return;

        if (statusId) {
            const newStatuses = Array.from(effect.statuses).filter(id => id !== statusId);
            await effect.update({ statuses: newStatuses });
            if (newStatuses.length === 0 && effect.changes.length === 0
                    && !effect.flags?.["tokyo-nova-axleration"]?.isBadStatus) {
                await effect.delete();
            }
        } else {
            await effect.delete();
        }
    }

    // ─── 経験点計算(静的) ────────────────────────────────────────────────────

    static async updateCastExp(actor) {
        if (!actor || actor.type !== 'cast') return;
        if (!actor.system.exp) actor.prepareData();

        const abilities = ["reason", "passion", "life", "mundane"];
        let totalAbilityCost = 0;
        const allStyles = actor.items.filter(i => i.type === 'style');

        for (const key of abilities) {
            let styleValue = 0, styleControl = 0;
            allStyles.forEach(s => {
                const level = Number(s.system.level) || 1;
                styleValue   += (Number(s.system[key]?.value))   * level;
                styleControl += (Number(s.system[key]?.control)) * level;
            });
            const abilityData = actor.system[key];
            const baseVal  = styleValue   + Number(abilityData.mod)        + Number(abilityData.effectMod);
            const baseCtrl = styleControl + Number(abilityData.controlMod) + Number(abilityData.controlEffectMod);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.growth,        baseVal,  false);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.controlGrowth, baseCtrl, true);
        }

        let totalItemCost = 0;
        actor.items.forEach(item => { totalItemCost += this._calcSingleItemCost(item); });

        const realSpent  = totalAbilityCost + totalItemCost;
        const initialExp = 170;
        const additional = Number(actor.system.exp?.additional);

        let historyTotal = 0;
        if (actor.system.ownerUserId && actor.system.syncWithOwner) {
            const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
            if (ownerUser) historyTotal = getUserFlagData(ownerUser).exp.total;
        } else {
            historyTotal = Object.values(actor.system.history)
                .reduce((sum, entry) => sum + Number(entry.exp), 0);
        }

        const newTotal       = additional + historyTotal;
        const newValue       = (newTotal + initialExp) - realSpent;
        const newActorSpent  = realSpent - initialExp;

        if (actor.system.exp.total !== newTotal
                || actor.system.exp.value !== newValue
                || actor.system.exp.spent !== newActorSpent) {
            await actor.update({
                "system.exp.total":  newTotal,
                "system.exp.spent":  newActorSpent,
                "system.exp.value":  newValue
            }, { calcExp: false });
        }
    }

    static _calcSingleAbilityCost(growth, base, isControl) {
        const g = Number(growth);
        if (g <= 0) return 0;
        const threshold = isControl ? 17 : 11;
        let cost = 0;
        for (let i = 1; i <= g; i++) {
            cost += ((base + i) < threshold) ? 20 : 40;
        }
        return cost;
    }

    static _calcSingleItemCost(item) {
        const system = item.system;
        const level  = Number(system.level);

        if (item.type === 'generalSkill') {
            if (level <= 0) return 0;
            const genCat = system.generalSkillCategory;
            if (genCat === 'onomasticSkill') {
                const cost = Number(system.onomasticSkill?.expCost) || 5;
                return system.onomasticSkill?.isInitial ? Math.max(0, level - 1) * cost : level * cost;
            }
            if (genCat === 'initialSkill') return Math.max(0, level - 1) * (Number(system.initialSkill?.expCost) || 10);
            return level * 5;
        }

        if (item.type === 'styleSkill') {
            if (level <= 0) return 0;
            const sCat = system.styleSkillCategory;
            if (sCat === 'secret')  return level * 20;
            if (sCat === 'mystery') return level * 50;
            return level * 10;
        }

        return Number(item.system.expCost);
    }
}
