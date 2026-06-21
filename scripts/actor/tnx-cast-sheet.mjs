import { TargetSelectionDialog } from '../module/tnx-dialog.mjs';
import { TnxSkillUtils } from '../module/tnx-skill-utils.mjs';
import { TnxHistoryMixin } from '../module/tnx-history-mixin.mjs';
import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { getUserFlagData, TNX_FLAG_SCOPE } from '../module/user-flag-schema.mjs';
import { OUTFIT_CATEGORIES, getMinorCategoryLabel } from '../data/item/outfit-categories.mjs';
import { formatWeaponRangeLabel, formatPartLabel } from '../item/tnx-outfit-sheet.mjs';
import { TnxJudgmentFlow } from '../module/tnx-judgment-flow.mjs';
import { getComboSuits, ALL_SUITS } from '../module/tnx-judgment-engine.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class TokyoNovaCastSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

    _isEditMode = false;
    tabGroups = { primary: "abilities" };
    _scrollPositions = {};

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "cast"],
        position: { width: 920, height: 1000 },
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
            openLifepathItem:     TokyoNovaCastSheet._onOpenLifepathItem,
            removeLifepath:       TokyoNovaCastSheet._onRemoveLifepath,
            itemCreate:           TokyoNovaCastSheet._onItemCreate,
            itemDelete:           TokyoNovaCastSheet._onItemDelete,
            removeBadStatus:      TokyoNovaCastSheet._onRemoveBadStatus,
            toggleAbilityDetails: TokyoNovaCastSheet._onToggleAbilityDetails,
            toggleSkillDesc:      TokyoNovaCastSheet._onToggleSkillDesc,
            openOutfitSheet:      TokyoNovaCastSheet._onOpenOutfitSheet,
            addOutfit:            TokyoNovaCastSheet._onAddOutfit,
            toggleOutfitFlag:     TokyoNovaCastSheet._onToggleOutfitFlag,
            toggleOutfitDesc:     TokyoNovaCastSheet._onToggleOutfitDesc,
            recalculateBounty:    TokyoNovaCastSheet._onRecalculateBounty,
            startSkillCheck:      TokyoNovaCastSheet._onStartSkillCheck,
            startAbilityCheck:    TokyoNovaCastSheet._onStartAbilityCheck,
            startControlCheck:    TokyoNovaCastSheet._onStartControlCheck,
        },
        dragDrop: [{ dragSelector: ".item-list .item, .style-skills-list .item, .skills-list-view .item, .outfit-groups-container .outfit-row:not(.outfit-row--option):not(.outfit-row--header)", dropSelector: null }],
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities", ".tab[data-tab='outfits']"],
        },
    };

    /** アウトフィット対応 Item type の Set */
    static OUTFIT_TYPES = new Set([
        "weapon", "armor", "cyborg", "ianus", "tron", "tap", "vehicle", "residence", "combiner", "general",
    ]);

    /** 住宅エリア compendium pack ID */
    static HOUSING_AREA_PACK = "tokyo-nova-axleration.housing-areas";

    /** 大分類ごとの表示設定（表示ラベル・列定義）。アイテム/サービスは「その他」にまとめる。 */
    static OUTFIT_GROUP_CONFIG = [
        { key: "weapon",     label: "武器",       sourceKeys: ["weapon"],
          columns: [
              { key: "hide",    label: "隠" },
              { key: "attack",  label: "攻" },
              { key: "guard",   label: "受" },
              { key: "range",   label: "射" },
              { key: "hack",    label: "電制" },
              { key: "part",    label: "部位" },
          ] },
        { key: "armor",      label: "防具",       sourceKeys: ["armor"],
          columns: [
              { key: "hide",    label: "隠" },
              { key: "defence", label: "防(S／P／I)" },
              { key: "control", label: "制" },
              { key: "hack",    label: "電制" },
              { key: "part",    label: "部位" },
          ] },
        { key: "cyberware", label: "サイバーウェア", sourceKeys: ["cyberware"],
          columns: [
              { key: "hide",    label: "隠" },
              { key: "hack",    label: "電制" },
              { key: "part",    label: "部位" },
          ] },
        { key: "tron",       label: "トロン",     sourceKeys: ["tron"],
          columns: [
              { key: "hide",    label: "隠" },
              { key: "cycle",   label: "サ" },
              { key: "soft",    label: "ソ" },
              { key: "hard",    label: "ハ" },
              { key: "cs",      label: "CS" },
              { key: "hack",    label: "電制" },
              { key: "part",    label: "部位" },
          ] },
        { key: "vehicle",    label: "ヴィークル", sourceKeys: ["vehicle"],
          columns: [
              { key: "hide",      label: "隠" },
              { key: "attack",    label: "攻" },
              { key: "sf",        label: "SF" },
              { key: "defence",   label: "防(S／P／I)" },
              { key: "control",   label: "制" },
              { key: "passenger", label: "乗員" },
              { key: "slot",      label: "ス" },
              { key: "hack",      label: "電制" },
              { key: "part",      label: "部位" },
          ] },
        { key: "housing",    label: "住居",       sourceKeys: ["housing"],
          columns: [
              { key: "appearance", label: "登" },
              { key: "security",   label: "セ" },
              { key: "part",       label: "部位" },
          ] },
        { key: "other",      label: "その他",     sourceKeys: ["item", "service"],
          columns: [
              { key: "hide",    label: "隠" },
              { key: "hack",    label: "電制" },
              { key: "part",    label: "部位" },
          ] },
    ];

    // ─── コンテキスト準備 ──────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.actor;
        context.system = this.actor.system;
        context.owner = this.actor.isOwner;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;
        context.cssClass = "";

        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.actor.system.description, {
                relativeTo: this.actor,
                editable: context.editable,
            }
        );

        const lifepathDefs = [
            { key: "origin",     label: "出自" },
            { key: "experience", label: "経験" },
            { key: "encounter",  label: "邂逅" },
        ];
        const lifepathSlots = [];
        for (const { key, label } of lifepathDefs) {
            const data = this.actor.system.lifePath[key];
            let enrichedSummary = "";
            let displayName = data.name;
            if (data.itemUuid) {
                try {
                    const liveItem = await fromUuid(data.itemUuid);
                    if (liveItem) {
                        displayName = liveItem.name;
                        if (liveItem.system?.description) {
                            enrichedSummary = await foundry.applications.ux.TextEditor.enrichHTML(
                                liveItem.system.description,
                                { relativeTo: liveItem, editable: false }
                            );
                        }
                    }
                } catch { /* アイテムが削除されている場合はフォールバック名を使用 */ }
            }
            lifepathSlots.push({
                key,
                label,
                hasItem:       !!data.itemUuid,
                name:          displayName,
                enrichedSummary,
            });
        }
        context.lifepathSlots = lifepathSlots;

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
            || "フリーランス";

        context.styleSlots = this._prepareStyleSlots(allStyles);

        const miracleSlotsData = this._prepareMiraclesForDisplay(allMiracles);
        context.miracleSlots = [...miracleSlotsData];
        while (context.miracleSlots.length < 3) context.miracleSlots.push({ isEmpty: true });
        context.miracleSlots = context.miracleSlots.slice(0, 3);

        context.miracleSlotsForView = [...miracleSlotsData];
        while (context.miracleSlotsForView.length < 3) {
            context.miracleSlotsForView.push({
                name: `神業${context.miracleSlotsForView.length + 1}`,
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

        context.outfitGroups = await this._prepareOutfitGroups();

        return context;
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    async _preRender(_context, _options) {
        if (!this.element) return;
        this.element.classList.add("tnx-no-transitions");
        this._scrollPositions = {};
        for (const sel of [
            ".profile-sidebar", ".sheet-body",
            ".tab[data-tab='abilities']", ".tab[data-tab='combat']",
            ".tab[data-tab='outfits']",  ".tab[data-tab='status']",
            ".tab[data-tab='history']",  ".tab[data-tab='profile']",
        ]) {
            const el = this.element.querySelector(sel);
            if (el) this._scrollPositions[sel] = el.scrollTop;
        }
    }

    _onRender(context, _options) {
        super._onRender(context, _options);
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

        // 報酬点 ±1 ボタン(閲覧モード・ホバー表示)
        for (const btn of el.querySelectorAll(".bounty-adjust-btn")) {
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                const delta = parseInt(ev.currentTarget.dataset.delta, 10);
                const currentEffective = parseInt(
                    ev.currentTarget.closest(".bounty-view-panel")?.querySelector(".bounty-total")?.textContent ?? "0",
                    10
                );
                if (currentEffective + delta < 0) return;
                const currentBounty = this.actor.system.bounty ?? 0;
                this.actor.update({ "system.bounty": currentBounty + delta });
            });
        }

        // 技能・アイテム行のドラッグ並び替え(編集モードのみ)
        // V2 は DEFAULT_OPTIONS.dragDrop を自動処理しないため明示的にバインドする。
        // ドロップ側は ActorSheetV2 既存の処理に委ねる(drop: false で二重発火を防止)。
        new foundry.applications.ux.DragDrop.implementation({
            dragSelector: ".item-list .item, .style-skills-list .item, .skills-list-view .item, .outfit-groups-container .outfit-row:not(.outfit-row--option):not(.outfit-row--header)",
            dropSelector: null,
            permissions: {
                dragstart: () => this.isEditable && this._isEditMode,
                drop:      () => false,
            },
            callbacks: {
                dragstart: this._onDragStart.bind(this),
            },
        }).bind(el);

        // 技能行のコンテキストメニュートリガー(縦三点リーダー)
        for (const trigger of el.querySelectorAll(".item-menu-trigger")) {
            trigger.addEventListener("click", ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const row = ev.currentTarget.closest("[data-item-id]");
                if (row) {
                    row.dispatchEvent(new MouseEvent("contextmenu", {
                        bubbles: true, cancelable: true, view: window,
                        clientX: ev.clientX, clientY: ev.clientY, buttons: 2
                    }));
                }
            });
        }

        // ProseMirror エディタのセットアップ — 編集モード時のみ表示、トグルなし
        const ProseMirrorEl = customElements.get("prose-mirror");
        if (ProseMirrorEl) {
            for (const contentDiv of el.querySelectorAll(".editor-content[data-edit]")) {
                const editorDiv = contentDiv.closest("div.editor");
                if (!editorDiv) continue;
                const fieldName = contentDiv.dataset.edit;
                const pm = ProseMirrorEl.create({
                    name: fieldName,
                    value: foundry.utils.getProperty(this.actor, fieldName) ?? "",
                    enriched: contentDiv.innerHTML,
                    toggled: false,
                });
                pm.dataset.documentUuid = this.actor.uuid;
                editorDiv.replaceWith(pm);
            }
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
            const displayName               = item.system.nameEn || item.name;
            itemData.repeatedName          = Array(level).fill(displayName).join(' = ');
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

    _onDragStart(event) {
        const row  = event.currentTarget.closest("[data-item-id]");
        const item = this.actor.items.get(row?.dataset.itemId);
        if (!item) return;
        event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
    }

    /**
     * 同型アイテム間の並び替え。
     * 一般技能は二列表示のため DOM 兄弟ではなく actor 上の同型アイテム全体を siblings とする。
     * アウトフィットは同じ表示グループ内のみソート可能（グループをまたぐドロップは無視）。
     * @override
     */
    _onSortItem(event, itemData) {
        const items  = this.actor.items;
        const source = items.get(itemData._id);
        if (!source) return;

        const dropTarget = event.target.closest("[data-item-id]");
        if (!dropTarget) return;
        const target = items.get(dropTarget.dataset.itemId);
        if (!target || source.id === target.id) return;

        // アウトフィット同士は同じ表示グループ内のみソート（グループをまたぐドロップは無視）
        if (TokyoNovaCastSheet.OUTFIT_TYPES.has(source.type) && TokyoNovaCastSheet.OUTFIT_TYPES.has(target.type)) {
            const sourceGroup = this._getDisplayGroupKey(source.system.majorCategory);
            const targetGroup = this._getDisplayGroupKey(target.system.majorCategory);
            if (sourceGroup !== targetGroup) return;
            const siblings = items.filter(i =>
                TokyoNovaCastSheet.OUTFIT_TYPES.has(i.type)
                && this._getDisplayGroupKey(i.system.majorCategory) === sourceGroup
                && i.id !== source.id
            );
            const sortUpdates = foundry.utils.performIntegerSort(source, { target, siblings });
            const updateData = sortUpdates.map(u => ({ _id: u.target.id, ...u.update }));
            return this.actor.updateEmbeddedDocuments("Item", updateData);
        }

        if (source.type !== target.type) return;
        const siblings = items.filter(i => i.type === source.type && i.id !== source.id);
        const sortUpdates = foundry.utils.performIntegerSort(source, { target, siblings });
        const updateData = sortUpdates.map(u => ({ _id: u.target.id, ...u.update }));
        return this.actor.updateEmbeddedDocuments("Item", updateData);
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

        // 住宅エリアは厳密にはアウトフィットではないためアクターには持たせない(2026-06-13 確定)
        if (item.type === "housingArea") {
            ui.notifications.warn("住宅エリアはアクターに直接持たせられません。住宅施設アイテムに設定してください。");
            return false;
        }

        if (this.actor.uuid === item.parent?.uuid) {
            return this._onSortItem(event, item.toObject());
        }

        // コンバイナー（source1/source2 設定済み）: 3 アイテムを一括インポートして活性化する
        if (item.type === "combiner"
                && item.system.combine?.source1
                && item.system.combine?.source2
                && !item.system.isCombineActive) {
            const s1 = await fromUuid(item.system.combine.source1).catch(() => null);
            const s2 = await fromUuid(item.system.combine.source2).catch(() => null);
            const src1Data = s1?.toObject();
            const src2Data = s2?.toObject();
            const datas = [item.toObject(), ...([src1Data, src2Data].filter(Boolean))];
            const created = await this.actor.createEmbeddedDocuments("Item", datas);
            const combinerCreated = created[0];
            let srcIdx = 1;
            const src1Created = src1Data ? created[srcIdx++] : null;
            const src2Created = src2Data ? created[srcIdx]   : null;
            if (combinerCreated && src1Created && src2Created) {
                await this.actor.updateEmbeddedDocuments("Item", [
                    {
                        _id: combinerCreated.id,
                        "system.isCombineActive": true,
                        "system.combine.source1": src1Created.uuid,
                        "system.combine.source2": src2Created.uuid,
                    },
                    { _id: src1Created.id, "system.combineGroupId": combinerCreated.id },
                    { _id: src2Created.id, "system.combineGroupId": combinerCreated.id },
                ]);
            } else if (combinerCreated) {
                // 一方のソース解決失敗: UUID だけ更新して非活性状態を維持
                const partialUpdate = { _id: combinerCreated.id };
                if (src1Created) {
                    partialUpdate["system.combine.source1"] = src1Created.uuid;
                    await this.actor.updateEmbeddedDocuments("Item", [
                        partialUpdate,
                        { _id: src1Created.id, "system.combineGroupId": combinerCreated.id },
                    ]);
                } else if (src2Created) {
                    partialUpdate["system.combine.source2"] = src2Created.uuid;
                    await this.actor.updateEmbeddedDocuments("Item", [
                        partialUpdate,
                        { _id: src2Created.id, "system.combineGroupId": combinerCreated.id },
                    ]);
                }
            }
            return created;
        }

        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;

        const lifepathAreaMap = {
            "lifepath-origin":     "origin",
            "lifepath-experience": "experience",
            "lifepath-encounter":  "encounter",
        };
        if (dropArea && lifepathAreaMap[dropArea]) {
            const key = lifepathAreaMap[dropArea];
            if (item.type !== "lifePath") {
                ui.notifications.warn("ライフパスアイテムのみドロップできます。");
                return false;
            }
            const lifePathType = item.system?.lifePathType;
            if (lifePathType && lifePathType !== key) {
                const typeLabels = { origin: "出自", experience: "経験", encounter: "邂逅" };
                ui.notifications.warn(`このスロットには「${typeLabels[key]}」のライフパスのみドロップできます。`);
                return false;
            }
            await this.actor.update({
                [`system.lifePath.${key}.itemUuid`]: item.uuid ?? "",
                [`system.lifePath.${key}.name`]:     item.name ?? "",
            });
            return;
        }

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
        const getItemFromHeader = header => {
            const itemId = header.dataset.itemId || header.closest('[data-item-id]')?.dataset.itemId;
            return this.actor.items.get(itemId);
        };

        // 初期習得技能(初期技能カテゴリ・名乗りの初期分)の判定
        const isInitialSkill = item =>
            item?.type === 'generalSkill'
            && (item.system.generalSkillCategory === 'initialSkill'
                || item.system.onomasticSkill?.isInitial);

        const openItemSheet = (header, editMode) => {
            const item = getItemFromHeader(header);
            if (!item) return;
            item.sheet._isEditMode = editMode;
            item.sheet.render({ force: true });
        };

        const itemDeleteCallback = async header => {
            const item = getItemFromHeader(header);
            if (!item) return;

            if (item.type === 'miracle') {
                const usage = item.system.usageCount;
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    await item.update({ 'system.usageCount.value': newValue, 'system.usageCount.total': Math.max(0, usage.total - 1) });
                    ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                    return;
                }
            }

            if (item.type === 'style' && item.system.level > 1) {
                await item.update({ 'system.level': item.system.level - 1 });
                return;
            }

            await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
        };

        const viewOption = {
            name:     "閲覧",
            icon:     '<i class="fas fa-eye"></i>',
            callback: header => openItemSheet(header, false)
        };
        const editOption = {
            name:      "編集",
            icon:      '<i class="fas fa-edit"></i>',
            condition: () => this.isEditable,
            callback:  header => openItemSheet(header, true)
        };
        const deleteOption = {
            name:      "削除",
            icon:      '<i class="fas fa-trash"></i>',
            condition: header => this.isEditable && !isInitialSkill(getItemFromHeader(header)),
            callback:  itemDeleteCallback
        };
        const duplicateOption = {
            name:      "複製",
            icon:      '<i class="fas fa-copy"></i>',
            condition: header => {
                if (!this.isEditable) return false;
                const item = getItemFromHeader(header);
                return item?.system.generalSkillCategory !== 'initialSkill';
            },
            callback: async header => {
                const item = getItemFromHeader(header);
                if (!item) return;
                const data = item.toObject();
                delete data._id;
                data.name = `${data.name}(コピー)`;
                // 名乗り初期分の複製は通常の名乗り技能として扱う
                if (foundry.utils.getProperty(data, "system.onomasticSkill.isInitial")) {
                    foundry.utils.setProperty(data, "system.onomasticSkill.isInitial", false);
                }
                await this.actor.createEmbeddedDocuments("Item", [data]);
            }
        };

        const baseItemMenu = [viewOption, editOption, deleteOption];
        const skillMenu    = [viewOption, editOption, duplicateOption, deleteOption];

        const CM = foundry.applications.ux.ContextMenu.implementation;

        new CM(el, '.item-button[data-context-menu="item-edit"]', baseItemMenu, { jQuery: false, fixed: true });
        new CM(el, '[data-context-menu="miracle-view"]', baseItemMenu, { jQuery: false, fixed: true });
        new CM(el, ".style-skills-list .style-skill-row", skillMenu, { jQuery: false, fixed: true });
        new CM(el, ".skills-list-view .general-skill-display", skillMenu, { jQuery: false, fixed: true });

        // ライフパスボタン（編集モード）のコンテキストメニュー
        const lifepathItemMenu = [
            {
                name:     "閲覧",
                icon:     '<i class="fas fa-eye"></i>',
                callback: async header => {
                    const key  = header.dataset.lifepathKey;
                    const uuid = this.actor.system.lifePath[key]?.itemUuid;
                    if (!uuid) return;
                    const item = await fromUuid(uuid);
                    if (!item) return;
                    item.sheet._isEditMode = false;
                    item.sheet.render({ force: true });
                }
            },
            {
                name:      "編集",
                icon:      '<i class="fas fa-edit"></i>',
                condition: () => this.isEditable,
                callback: async header => {
                    const key  = header.dataset.lifepathKey;
                    const uuid = this.actor.system.lifePath[key]?.itemUuid;
                    if (!uuid) return;
                    const item = await fromUuid(uuid);
                    if (!item) return;
                    item.sheet._isEditMode = true;
                    item.sheet.render({ force: true });
                }
            },
            {
                name:      "削除",
                icon:      '<i class="fas fa-trash"></i>',
                condition: () => this.isEditable,
                callback: async header => {
                    const key = header.dataset.lifepathKey;
                    if (!key) return;
                    await this.actor.update({
                        [`system.lifePath.${key}.itemUuid`]: "",
                        [`system.lifePath.${key}.name`]:     "",
                    });
                }
            }
        ];
        new CM(el, '.lifepath-item-btn[data-context-menu="lifepath-item"]', lifepathItemMenu, { jQuery: false, fixed: true });

        // バッドステータス 閲覧モード: 左クリックでコンテキストメニュー
        const badStatusViewMenu = [{
            name:     "削除",
            icon:     '<i class="fas fa-trash"></i>',
            callback: async header => {
                const effectId = header.dataset.effectId;
                const statusId = header.dataset.statusId || null;
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
        }];
        new CM(el, ".tnx-bs-btn--view", badStatusViewMenu, { jQuery: false, fixed: true, eventName: "click" });

        // アウトフィット行のコンテキストメニュー
        const outfitMenu = [
            {
                name:     "閲覧",
                icon:     '<i class="fas fa-eye"></i>',
                callback: header => {
                    const item = getItemFromHeader(header);
                    if (!item) return;
                    item.sheet._isEditMode = false;
                    item.sheet.render({ force: true });
                }
            },
            {
                name:      "編集",
                icon:      '<i class="fas fa-edit"></i>',
                condition: () => this.isEditable,
                callback:  header => {
                    const item = getItemFromHeader(header);
                    if (!item) return;
                    item.sheet._isEditMode = true;
                    item.sheet.render({ force: true });
                }
            },
            {
                name:      "コンバイン解除",
                icon:      '<i class="fas fa-unlink"></i>',
                condition: header => this.isEditable && !!getItemFromHeader(header)?.system.combineGroupId,
                callback:  async header => {
                    const srcItem = getItemFromHeader(header);
                    if (!srcItem) return;
                    const combiner = this.actor.items.get(srcItem.system.combineGroupId);
                    if (!combiner) return;
                    const s1Uuid = combiner.system.combine.source1;
                    const s2Uuid = combiner.system.combine.source2;
                    const updates = [{
                        _id: combiner.id,
                        "system.isCombineActive": false,
                        "system.combine.source1": "",
                        "system.combine.source2": "",
                    }];
                    for (const uuid of [s1Uuid, s2Uuid].filter(Boolean)) {
                        const si = this.actor.items.find(i => i.uuid === uuid);
                        if (si) updates.push({ _id: si.id, "system.combineGroupId": "" });
                    }
                    await this.actor.updateEmbeddedDocuments("Item", updates);
                }
            },
            {
                name:      "削除",
                icon:      '<i class="fas fa-trash"></i>',
                condition: () => this.isEditable,
                callback:  async header => {
                    const item = getItemFromHeader(header);
                    if (!item) return;
                    await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
                }
            }
        ];
        new CM(el, ".outfit-row", outfitMenu, { jQuery: false, fixed: true });
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

    // ─── アウトフィットタブ ──────────────────────────────────────────────────

    /** OUTFIT_GROUP_CONFIG の key に対応する表示グループキーを返す。 */
    _getDisplayGroupKey(major) {
        if (!major || major === "item" || major === "service") return "other";
        return major;
    }

    /** 大分類でグループ化したアウトフィット行データを構築する。 */
    async _prepareOutfitGroups() {
        const outfitItems = this.actor.items
            .filter(i => TokyoNovaCastSheet.OUTFIT_TYPES.has(i.type))
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

        // コンバイン活性中は「コンバイナー本体」と「非見た目元ソース」をリストから隠す
        const combineHiddenIds = new Set();
        for (const item of outfitItems) {
            if (item.type !== "combiner" || !item.system.isCombineActive) continue;
            combineHiddenIds.add(item.id);
            const hiddenSrcKey = item.system.combine.appearance === "2" ? "source1" : "source2";
            const hiddenItem = outfitItems.find(i => i.uuid === item.system.combine[hiddenSrcKey]);
            if (hiddenItem) combineHiddenIds.add(hiddenItem.id);
        }

        const optionsByParent = new Map();
        for (const item of outfitItems) {
            const pid = item.system.parentItemId;
            if (item.system.isOption && pid) {
                if (!optionsByParent.has(pid)) optionsByParent.set(pid, []);
                optionsByParent.get(pid).push(item);
            }
        }

        const rowsById = new Map();
        for (const item of outfitItems) {
            rowsById.set(item.id, await this._prepareOutfitRow(item, optionsByParent));
        }

        const byGroupKey = new Map();
        for (const item of outfitItems) {
            if (item.system.isOption && item.system.parentItemId) continue;
            if (combineHiddenIds.has(item.id)) continue;
            const gk = this._getDisplayGroupKey(item.system.majorCategory);
            if (!byGroupKey.has(gk)) byGroupKey.set(gk, []);
            byGroupKey.get(gk).push(item);
        }

        return TokyoNovaCastSheet.OUTFIT_GROUP_CONFIG.map(cfg => {
            const groupItems = byGroupKey.get(cfg.key) ?? [];
            const rows = [];
            for (const item of groupItems) {
                const row = rowsById.get(item.id);
                if (row) rows.push(row);
                for (const opt of optionsByParent.get(item.id) ?? []) {
                    const optRow = rowsById.get(opt.id);
                    if (optRow) rows.push(optRow);
                }
            }
            return { key: cfg.key, label: cfg.label, columns: cfg.columns, hasItems: rows.length > 0, items: rows };
        });
    }

    /** 1 アイテム分の行データを構築する。 */
    async _prepareOutfitRow(item, optionsByParent) {
        const sys = item.system;
        const isOption = !!(sys.isOption && sys.parentItemId);

        // 表示名
        let displayName = item.name;

        // コンバイン見た目元の場合: コンバイナーと両ソースを解決して merged 列値を使う
        let combinerItem = null;
        let mergeSrc1 = null;
        let mergeSrc2 = null;
        if (sys.combineGroupId) {
            const ci = this.actor.items.get(sys.combineGroupId);
            if (ci?.system.isCombineActive) {
                const s1 = this.actor.items.find(i => i.uuid === ci.system.combine.source1) ?? null;
                const s2 = this.actor.items.find(i => i.uuid === ci.system.combine.source2) ?? null;
                if (s1 && s2) {
                    combinerItem = ci;
                    mergeSrc1    = s1;
                    mergeSrc2    = s2;
                    displayName  = `${item.name}（コンバイン）`;
                }
            }
        }

        // 住宅エリアの有効値解決
        let effectiveValues = null;
        if (item.type === "residence") {
            const mods = await this._resolveHousingAreaMods(sys);
            if (mods) {
                effectiveValues = {
                    appearanceTarget: (sys.appearanceTarget ?? 0) + mods.appearanceTargetMod,
                    cyberSecurity:    (sys.cyberSecurity    ?? 0) + mods.cyberSecurityMod,
                    analogSecurity:   (sys.analogSecurity   ?? 0) + mods.analogSecurityMod,
                };
            }
        }

        // 列値を事前計算（コンバイン見た目元は merged 値、それ以外は通常値）
        const gk = this._getDisplayGroupKey(sys.majorCategory);
        const cfg = TokyoNovaCastSheet.OUTFIT_GROUP_CONFIG.find(c => c.key === gk)
            ?? TokyoNovaCastSheet.OUTFIT_GROUP_CONFIG.at(-1);
        const colValues = cfg.columns.map(col => ({
            key:   col.key,
            value: (combinerItem)
                ? TokyoNovaCastSheet._computeCombinedColValue(col.key, combinerItem, mergeSrc1, mergeSrc2)
                : TokyoNovaCastSheet._computeColValue(col.key, sys, effectiveValues),
        }));

        return {
            _id: item.id,
            displayName,
            img: item.img,
            system: sys,
            isOption,
            isResidence: item.system.majorCategory === "housing",
            hasOptions: optionsByParent.has(item.id),
            colValues,
            description: sys.description ?? "",
            combineInfo: combinerItem ? {
                combinerName:  combinerItem.name,
                source1Name:   mergeSrc1.name,
                source2Name:   mergeSrc2.name,
            } : null,
        };
    }

    /** 1 列分の表示値を計算する。表示は AE 込み実効値(total)。編集入力は base のまま(フェーズ9-3)。 */
    static _computeColValue(key, sys, effectiveValues) {
        // {mode,value,effectMod} の実効値。mode=value 以外は null
        const mvT = (f) => f?.mode === "value" ? (f.total ?? f.value) : null;
        switch (key) {
            case "hide": {
                const h = mvT(sys.hide) ?? "-";
                const d = mvT(sys.appearancePenalty) ?? "-";
                return (h === "-" && d === "-") ? "-" : `${h}／${d}`;
            }
            case "attack":
                return sys.attack?.damageType
                    ? `${sys.attack.damageType}+${sys.attack.total ?? sys.attack.value ?? 0}` : "-";
            case "guard":
                return mvT(sys.guardValue) !== null ? String(mvT(sys.guardValue)) : "-";
            case "range":
                return (sys.range?.min && sys.range.min !== "none")
                    ? formatWeaponRangeLabel(sys.range) : "-";
            case "hack":
                return mvT(sys.hack) !== null ? String(mvT(sys.hack)) : "-";
            case "defence":
                return sys.defence?.mode === "value"
                    ? `${sys.defence.S_total ?? sys.defence.S_defence}／${sys.defence.P_total ?? sys.defence.P_defence}／${sys.defence.I_total ?? sys.defence.I_defence}` : "-";
            case "control":
                return mvT(sys.controlMod) !== null ? String(mvT(sys.controlMod)) : "-";
            case "slot": {
                const s = (sys.slots ?? []).find(s => s.kind === "normal");
                return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
            }
            case "soft": {
                const s = (sys.slots ?? []).find(s => s.kind === "software");
                return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
            }
            case "hard": {
                const s = (sys.slots ?? []).find(s => s.kind === "hardware");
                return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
            }
            case "cycle":
                return mvT(sys.cycle) !== null ? String(mvT(sys.cycle)) : "-";
            case "cs":
                return mvT(sys.combatSpeedMod) !== null ? String(mvT(sys.combatSpeedMod)) : "-";
            case "sf":
                return mvT(sys.speedFactor) !== null ? String(mvT(sys.speedFactor)) : "-";
            case "passenger":
                return mvT(sys.passenger) !== null ? String(mvT(sys.passenger)) : "-";
            case "appearance":
                return effectiveValues
                    ? String(effectiveValues.appearanceTarget)
                    : String(sys.appearanceTarget ?? 0);
            case "security":
                return effectiveValues
                    ? `${effectiveValues.cyberSecurity}／${effectiveValues.analogSecurity}`
                    : `${sys.cyberSecurity ?? 0}／${sys.analogSecurity ?? 0}`;
            case "part":
                return formatPartLabel(sys.part);
            default:
                return "-";
        }
    }

    /**
     * コンバイン活性中の見た目元アイテム行の列値を merged 計算する。
     * @param {string} key 列キー
     * @param {Item} combinerItem コンバイナーアイテム
     * @param {Item} srcItem1 ソース1（combine.source1）
     * @param {Item} srcItem2 ソース2（combine.source2）
     * @returns {string}
     */
    static _computeCombinedColValue(key, combinerItem, srcItem1, srcItem2) {
        const csys   = combinerItem.system;
        const params = csys.combine.params ?? {};
        const s1sys  = srcItem1.system;
        const s2sys  = srcItem2.system;
        const appearIs1 = csys.combine.appearance !== "2";
        const appearSys = appearIs1 ? s1sys : s2sys;

        /** params[paramKey] に従って source1 または source2 の system を返す */
        const chosenSys = (paramKey) => (params[paramKey] === "2" ? s2sys : s1sys);

        const num = (v) => (Number.isFinite(v) ? v : 0);
        const slotVal = (sys, kind) => {
            const slot = (sys.slots ?? []).find(s => s.kind === kind);
            return slot?.count?.mode === "value" ? (slot.count.value ?? 0) : 0;
        };

        switch (key) {
            case "hide": {
                // 見た目元の隠(コンバイナーの隠) ／ 選択した元の危険値
                const h  = appearSys.hide?.mode === "value" ? appearSys.hide.value : "-";
                const ch = csys.hide?.mode === "value" ? csys.hide.value : "-";
                const penSys = chosenSys("appearancePenalty");
                const d = penSys.appearancePenalty?.mode === "value"
                    ? penSys.appearancePenalty.value : "-";
                return (h === "-" && ch === "-" && d === "-") ? "-"
                    : `${h}(${ch})／${d}`;
            }
            case "attack": {
                const s = chosenSys("attack");
                return s.attack?.damageType
                    ? `${s.attack.damageType}+${s.attack.value ?? 0}` : "-";
            }
            case "guard": {
                const s = chosenSys("guardValue");
                return s.guardValue?.mode === "value" ? String(s.guardValue.value) : "-";
            }
            case "range": {
                const s = chosenSys("range");
                return (s.range?.min && s.range.min !== "none")
                    ? formatWeaponRangeLabel(s.range) : "-";
            }
            case "hack": {
                const h1 = s1sys.hack?.mode === "value" ? num(s1sys.hack.value) : null;
                const h2 = s2sys.hack?.mode === "value" ? num(s2sys.hack.value) : null;
                const vals = [h1, h2].filter(v => v !== null);
                return vals.length ? String(Math.max(...vals)) : "-";
            }
            case "defence": {
                const s = chosenSys("defence");
                return s.defence?.mode === "value"
                    ? `${s.defence.S_defence}／${s.defence.P_defence}／${s.defence.I_defence}` : "-";
            }
            case "control": {
                const s = chosenSys("controlMod");
                return s.controlMod?.mode === "value" ? String(s.controlMod.value) : "-";
            }
            case "sf": {
                const s = chosenSys("speedFactor");
                return s.speedFactor?.mode === "value" ? String(s.speedFactor.value) : "-";
            }
            case "passenger": {
                const s = chosenSys("passenger");
                return s.passenger?.mode === "value" ? String(s.passenger.value) : "-";
            }
            case "cycle": {
                const s = chosenSys("cycle");
                return s.cycle?.mode === "value" ? String(s.cycle.value) : "-";
            }
            case "cs": {
                const s = chosenSys("combatSpeedMod");
                return s.combatSpeedMod?.mode === "value" ? String(s.combatSpeedMod.value) : "-";
            }
            case "slot": {
                const total = slotVal(s1sys, "normal") + slotVal(s2sys, "normal");
                return total > 0 ? String(total) : "-";
            }
            case "soft": {
                const total = slotVal(s1sys, "software") + slotVal(s2sys, "software");
                return total > 0 ? String(total) : "-";
            }
            case "hard": {
                const total = slotVal(s1sys, "hardware") + slotVal(s2sys, "hardware");
                return total > 0 ? String(total) : "-";
            }
            case "part": {
                const parts = [
                    ...(Array.isArray(s1sys.part) ? s1sys.part : []),
                    ...(Array.isArray(s2sys.part) ? s2sys.part : []),
                ];
                return formatPartLabel(parts);
            }
            default:
                return TokyoNovaCastSheet._computeColValue(key, appearSys, null);
        }
    }

    /** 住宅施設に紐づく住宅エリアの修正値を解決する。 */
    async _resolveHousingAreaMods(sys) {
        const ref = sys.housingArea;
        if (!ref) return null;
        try {
            const areaItem = sys.useHousingAreaDrop
                ? await fromUuid(ref)
                : await game.packs.get(TokyoNovaCastSheet.HOUSING_AREA_PACK)?.getDocument(ref);
            if (!areaItem) return null;
            const s = areaItem.system;
            return {
                buyRatingMod:        s.buyRatingMod        ?? 0,
                preserveExpMod:      s.preserveExpMod      ?? 0,
                appearanceTargetMod: s.appearanceTargetMod ?? 0,
                cyberSecurityMod:    s.cyberSecurityMod    ?? 0,
                analogSecurityMod:   s.analogSecurityMod   ?? 0,
                slotMod:             s.slotMod             ?? 0,
            };
        } catch { return null; }
    }

    // ─── 市民ランク・能力値データ ─────────────────────────────────────────────

    _getCitizenRankData(context) {
        const currentRank = context.system.citizenRank;
        const rankMap = { "A": "A", "B+": "B+", "B": "B", "B-": "B-", "C+": "C+", "C": "C", "C-": "C-", "X": "X" };
        context.citizenRankOptionsForSelect = Object.entries(rankMap).map(([value]) => ({
            value,
            label:    value,
            selected: value === currentRank
        }));
    }

    _getAbilitiesData(context, equippedStyles) {
        context.system.abilities = {};
        const abilityKeys   = ["reason", "passion", "life", "mundane"];
        const abilityLabels = {
            reason:  "♠理性",
            passion: "♣感情",
            life:    "♥生命",
            mundane: "♦外界"
        };

        const outfitMod = context.system.outfitMod ?? {};
        for (const key of abilityKeys) {
            const ability = context.system[key];
            const styleContributions = equippedStyles.map(style => {
                const level = style.system.level || 1;
                return {
                    name:    style.name,
                    value:   style.system[key].value   * level,
                    control: style.system[key].control * level,
                    level,
                };
            });
            const abilityOutfitMod  = outfitMod[key]    ?? 0;
            const controlOutfitMod  = outfitMod.control ?? 0;
            context.system.abilities[key] = {
                label:            abilityLabels[key],
                growth:           ability.growth,
                controlGrowth:    ability.controlGrowth,
                mod:              ability.mod,
                controlMod:       ability.controlMod,
                outfitMod:        abilityOutfitMod,
                outfitControlMod: controlOutfitMod,
                styleContributions,
                // 実効値は DataModel.prepareDerivedData が算出した単一の真実を読む(0clamp 込み)。
                // styleTotalValue 等はスタイル内訳表示(styleContributions)専用。
                totalValue:   this.actor.system[key].total,
                totalControl: this.actor.system[key].totalControl,
            };
        }
        context.mundaneTotalValue = context.system.abilities.mundane.totalValue;
        context.effectiveBounty = (context.system.bountyBase ?? 0) + (context.system.bounty ?? 0);
        context.bountyAtMin = context.effectiveBounty <= 0;
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
        if (isPersona && isKey) return "◎⬤";
        if (isPersona)          return "◎";
        if (isKey)              return "⬤";
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

    static async _onToggleEditMode(event, _target) {
        if (event) event.preventDefault();
        // 編集→閲覧切替時: ProseMirror の内容をアクターに保存してから再描画する
        if (this._isEditMode && this.element) {
            const updates = {};
            for (const pm of this.element.querySelectorAll("prose-mirror")) {
                const fieldName = pm.getAttribute("name");
                if (!fieldName) continue;
                foundry.utils.setProperty(updates, fieldName, pm.value ?? "");
            }
            if (!foundry.utils.isEmpty(updates)) {
                this._isEditMode = false;
                await this.actor.update(updates);
                this.render();
                return;
            }
        }
        this._isEditMode = !this._isEditMode;
        this.render();
    }

    static _onOpenItemSheet(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        this.actor.items.get(itemId)?.sheet.render({ force: true });
    }

    static async _onOpenLifepathItem(event, target) {
        event.preventDefault();
        const key = target.dataset.lifepathKey;
        if (!key) return;
        const uuid = this.actor.system.lifePath[key]?.itemUuid;
        if (!uuid) return;
        const item = await fromUuid(uuid);
        item?.sheet?.render({ force: true });
    }

    static async _onRemoveLifepath(event, target) {
        event.preventDefault();
        const key = target.dataset.lifepathKey;
        if (!key) return;
        await this.actor.update({
            [`system.lifePath.${key}.itemUuid`]: "",
            [`system.lifePath.${key}.name`]:     "",
        });
    }

    static async _onOpenOutfitSheet(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;
        item.sheet._isEditMode = false;
        item.sheet.render({ force: true });
    }

    static async _onAddOutfit(event) {
        event.preventDefault();
        const optgroups = Object.entries(OUTFIT_CATEGORIES).map(([majorKey, major]) => {
            const opts = Object.entries(major.minors).map(([minorKey, def]) =>
                `<option value="${majorKey}|${minorKey}|${def.types[0]}">${def.label}</option>`
            ).join("");
            return `<optgroup label="${major.label}">${opts}</optgroup>`;
        }).join("");

        const result = await foundry.applications.api.DialogV2.prompt({
            window:  { title: "アウトフィットを追加" },
            content: `<div class="form-group"><label>種別</label><select name="sel">${optgroups}</select></div>`,
            ok: { label: "追加", callback: (_e, _btn, dialog) =>
                dialog.element.querySelector("[name=sel]").value
            },
        });
        if (!result) return;
        const [majorCategory, minorCategory, type] = result.split("|");
        await Item.create({
            name:   `新規${getMinorCategoryLabel(minorCategory)}`,
            type,
            system: { majorCategory, minorCategory },
        }, { parent: this.actor });
    }

    static async _onToggleOutfitFlag(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;
        const flag = target.dataset.flag;
        if (flag !== "isCarrying" && flag !== "isPrepared") return;
        // 住宅大分類は携帯中フラグを変更不可(常時 ON 固定)
        if (flag === "isCarrying" && item.system.majorCategory === "housing") return;
        const next = !item.system[flag];
        // 携帯中でなければ準備済みにできない(念のため)
        if (flag === "isPrepared" && next && !item.system.isCarrying) return;
        const update = { [`system.${flag}`]: next };
        // 携帯中を外したとき準備済みも連動して外す
        if (flag === "isCarrying" && !next && item.system.isPrepared) {
            update["system.isPrepared"] = false;
        }
        await item.update(update);
    }

    static _onToggleOutfitDesc(event, target) {
        event.preventDefault();
        target.blur();
        const row   = target.closest(".outfit-row");
        const panel = row?.querySelector(".outfit-desc-panel");
        if (!panel) return;
        const visible = panel.style.display !== "none";
        panel.style.display = visible ? "none" : "";
        const icon = target.querySelector("i");
        if (icon) {
            icon.classList.toggle("fa-expand",   visible);
            icon.classList.toggle("fa-compress", !visible);
        }
    }

    static async _onItemCreate(event, target) {
        event.preventDefault();
        const type = target.dataset.type;
        if (!type) return;
        if (type === 'generalSkill') {
            const onomasticTypes = [
                { value: "craft",   label: "製作" },
                { value: "art",     label: "芸術" },
                { value: "operate", label: "操縦" },
                { value: "society", label: "社会" },
                { value: "contact", label: "コネ" },
                { value: "other",   label: "その他" },
            ];
            const optionsHtml = onomasticTypes.map(o =>
                `<option value="${o.value}">${o.label}</option>`
            ).join("");
            const selected = await foundry.applications.api.DialogV2.prompt({
                window:  { title: "一般技能を追加" },
                content: `<div class="form-group"><label>種別</label><select name="sel">${optionsHtml}</select></div>`,
                ok: { label: "追加", callback: (_e, _btn, dialog) =>
                    dialog.element.querySelector("[name=sel]").value
                },
            });
            if (!selected) return;

            const nameMap = {
                craft: "製作：", art: "芸術：", operate: "操縦：",
                society: "社会：", contact: "コネ：", other: "新規一般技能",
            };
            const identificationKey = selected === "other" ? "" : `${selected}_`;
            const isOnomasticType   = selected !== "other";
            const existingSkills = this.actor.items.filter(i => i.type === 'generalSkill');
            const sortValue = TokyoNovaCastSheet._calcInsertSortValue(existingSkills, selected);

            return Item.create({
                name:   nameMap[selected] ?? "新規一般技能",
                type:   "generalSkill",
                sort:   sortValue,
                system: {
                    level: 0,
                    generalSkillCategory: "onomasticSkill",
                    identificationKey,
                    isAction:   isOnomasticType,
                    usesBounty: isOnomasticType,
                },
            }, { parent: this.actor });
        }
        if (type === 'styleSkill') {
            return Item.create({ name: "新規スタイル技能", type: "styleSkill",
                system: { level: 0 }
            }, { parent: this.actor });
        }
        return Item.create({ name: `新規${type}`, type }, { parent: this.actor });
    }

    /**
     * 固有名詞技能をソート順の適切な位置に挿入するための sort 値を計算する。
     * prefix グループの最後の要素と次グループの先頭要素の中間値を返す。
     */
    static _calcInsertSortValue(existingSkills, prefix) {
        const targetPos = prefix === "other"
            ? Infinity
            : TnxSkillUtils.getSkillSortPosition(`${prefix}_`);
        let prevSort = 0;
        let nextSort = Infinity;
        for (const skill of existingSkills) {
            const skillSort = skill.sort ?? 0;
            const skillPos  = TnxSkillUtils.getSkillSortPosition(skill.system.identificationKey);
            if (skillPos <= targetPos) {
                if (skillSort > prevSort) prevSort = skillSort;
            } else {
                if (skillSort < nextSort) nextSort = skillSort;
            }
        }
        if (!isFinite(nextSort)) return prevSort + 100_000;
        return Math.floor((prevSort + nextSort) / 2);
    }

    static async _onItemDelete(event, target) {
        event.preventDefault();
        const li     = target.closest(".item");
        const itemId = li?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window:  { title: "削除" },
            content: `<p>「${item.name}」を削除しますか？</p>`
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
                window:  { title: "万能神業の使用確認" },
                content: `<p>神業「${originalMiracle.name}」を、他の神業の効果として使用しますか？</p>`
            });

            if (useAsOther) {
                const miracleChoices = game.items.filter(i => i.type === 'miracle' && i.name !== originalMiracle.name);
                if (miracleChoices.length === 0) { ui.notifications.warn("ワールドに選択可能な神業が存在しません。"); return; }

                const selectedId = await TargetSelectionDialog.prompt({
                    title:       "模倣する神業の選択",
                    label:       `「${originalMiracle.name}」として発動する神業を選択してください。`,
                    options:     miracleChoices.map(dw => ({ value: dw.id, label: dw.name })),
                    selectLabel: "選択"
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

    static _onToggleSkillDesc(event, target) {
        event.preventDefault();
        target.blur();
        const row = target.closest('.style-skill-row');
        const panel = row?.querySelector('.style-skill-desc-panel');
        if (!panel) return;
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : '';
        const icon = target.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-expand', isVisible);
            icon.classList.toggle('fa-compress', !isVisible);
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

    static async _onRecalculateBounty(event, _target) {
        event.preventDefault();
        await this.actor.update({ "system.bountyBase": TokyoNovaCastSheet._computeMundaneTotalValue(this.actor) });
    }

    // ─── 判定起動 ────────────────────────────────────────────────────────────

    static async _onStartSkillCheck(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        if (!itemId) return;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        // check タイプの用途が設定されていなければ起動しない
        const checkUsages = (item.system.actions ?? []).filter(a => a.type === "check");
        if (!checkUsages.length) {
            ui.notifications.warn(`「${item.name}」に判定用途が設定されていません。アイテムシートで用途を追加してください。`);
            return;
        }

        // 用途を決定（1つなら自動選択、複数なら D&D スタイルのピッカー表示）
        let selectedUsage;
        if (checkUsages.length === 1) {
            selectedUsage = checkUsages[0];
        } else {
            selectedUsage = await TokyoNovaCastSheet._promptCheckUsage(checkUsages, item.name);
            if (!selectedUsage) return;
        }

        // ベース技能: 用途の baseSkillRef を優先、未設定なら親アイテムにフォールバック
        const baseSkillId = selectedUsage.baseSkillRef?.itemId || itemId;
        const baseSkill = this.actor.items.get(baseSkillId);
        if (!baseSkill) {
            ui.notifications.warn("ベース技能が見つかりません。用途シートでベース技能を設定してください。");
            return;
        }

        // コンボ技能を解決し、全技能のスートの積集合を計算
        const comboSkillIds = (selectedUsage.skillRefs ?? [])
            .map(r => r.itemId)
            .filter(id => id && this.actor.items.has(id));

        // 用途を所持する技能がベース技能でない場合（非アクション技能から起動など）は自動追加
        // baseSkillRef 未設定なら baseSkillId = itemId となるため、この条件は自然に不成立になる
        if (item.id !== baseSkillId && !comboSkillIds.includes(item.id)) {
            comboSkillIds.push(item.id);
        }

        const allSkillIds = [baseSkillId, ...comboSkillIds];
        const allSkillSystems = allSkillIds
            .map(id => this.actor.items.get(id)?.system)
            .filter(Boolean);
        const validSuits = getComboSuits(allSkillSystems);
        if (!validSuits.length) return ui.notifications.warn("この技能（組み合わせ）には使用可能なスートがありません。");

        const skillLabel = allSkillIds
            .map(id => this.actor.items.get(id)?.name ?? "")
            .filter(Boolean)
            .join("+");

        const actor = this.actor;
        const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);

        // 使用回数の消費を確認（参加技能の遠隔消費を含む。残り0でチェック時はブロック）
        const usesPlan = await TnxJudgmentFlow.planUsesConsumption(actor, allSkillIds);
        if (!usesPlan) return;

        await TnxJudgmentFlow.open({
            type:            "skillCheck",
            actorId:         actor.id,
            skillIds:        allSkillIds,
            skillLabel,
            validSuits,
            targetValue:     null,
            bountyAvailable: baseSkill.system.usesBounty === true ? actorBounty : 0,
            consumeUses:     usesPlan.consumeIds,
            requestMessageId: null,
        });
    }

    /** 複数の check 用途を D&D スタイルの縦ボタンダイアログで選択させる */
    static async _promptCheckUsage(usages, skillName) {
        const buttons = [
            ...usages.map((u, i) => ({
                action:   String(i),
                label:    u.name || "判定",
                callback: () => i,
            })),
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ];

        const idx = await foundry.applications.api.DialogV2.wait({
            window:   { title: skillName },
            classes:  ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
            position: { width: 320 },
            content:  "",
            buttons,
            close:    () => null,
        });

        return idx !== null && idx !== undefined ? usages[Number(idx)] : null;
    }

    static async _onStartAbilityCheck(event, target) {
        event.preventDefault();
        const abilityKey = target.closest("[data-ability-key]")?.dataset.abilityKey;
        if (!abilityKey) return;
        const ABILITY_TO_SUIT = { reason: "spade", passion: "club", life: "heart", mundane: "diamond" };
        const ABILITY_LABELS  = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
        const suit = ABILITY_TO_SUIT[abilityKey];
        const actor = this.actor;
        await TnxJudgmentFlow.open({
            type:            "abilityCheck",
            actorId:         actor.id,
            skillIds:        [],
            skillLabel:      ABILITY_LABELS[abilityKey] ?? abilityKey,
            validSuits:      suit ? [suit] : [...ALL_SUITS],
            targetValue:     null,
            bountyAvailable: (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0),
            requestMessageId: null,
        });
    }

    static async _onStartControlCheck(event, target) {
        event.preventDefault();
        const abilityKey = target.closest("[data-ability-key]")?.dataset.abilityKey;
        const ABILITY_TO_SUIT = { reason: "spade", passion: "club", life: "heart", mundane: "diamond" };
        const ABILITY_LABELS  = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
        const suit  = ABILITY_TO_SUIT[abilityKey];
        const actor = this.actor;
        await TnxJudgmentFlow.open({
            type:            "controlCheck",
            actorId:         actor.id,
            skillIds:        [],
            skillLabel:      abilityKey ? `${ABILITY_LABELS[abilityKey] ?? abilityKey}の制御` : "制御判定",
            validSuits:      suit ? [suit] : [...ALL_SUITS],
            targetValue:     null,
            bountyAvailable: 0,
            requestMessageId: null,
        });
    }

    static _computeMundaneTotalValue(actor) {
        // 外界(mundane)の最終実効値。prepareDerivedData が算出した単一の真実を読む。
        return actor.system.mundane.total;
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
            const baseVal  = styleValue   + Number(abilityData.mod);
            const baseCtrl = styleControl + Number(abilityData.controlMod);
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

        // style / miracle / organization のコストはアビリティ計算に含まれるため個別コスト0
        if (item.type === 'style' || item.type === 'miracle' || item.type === 'organization') {
            return 0;
        }

        // アウトフィット: 常備化経験点を集計する
        // isCheckAcquired（購入判定による入手）は経験点不要
        // 消費アイテムは preserveExp.value × 常備化個数(quantity.max)
        if (this.OUTFIT_TYPES.has(item.type)) {
            if (system.isCheckAcquired) return 0;
            if (system.preserveExp?.mode !== "value") return 0;
            const base = Number(system.preserveExp.value) || 0;
            return system.isConsumption ? base * (Number(system.quantity?.max) || 0) : base;
        }

        return Number(item.system.expCost) || 0;
    }
}
