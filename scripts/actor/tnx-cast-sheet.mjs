// scripts/sheets/tokyo-nova-cast-sheet.mjs
import {
    RichConfirmDialog,
    CardSelectionDialog,
    TargetSelectionDialog
} from "../module/tnx-dialog.mjs";
import { TnxActionHandler } from "../module/tnx-action-handler.mjs";
  
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
  
/**
 * TokyoNovaCastSheet (ActorSheetV2 準拠)
 * - AppV2 の actions でクリックを集約
 * - DEFAULT_OPTIONS を静的プロパティで super とマージ
 * - 既存の D&D / ContextMenu / 独自 change ハンドリングは継続
 */
export class TokyoNovaCastSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    constructor(...args) {
        super(...args);
        this._isEditMode = this.actor.isOwner;
    }

    /**
     * フォーム送信を処理する静的メソッド。
     * AppV2 では form.handler に static メソッドを割り当てる必要がある。
     * this はインスタンスを指すため、内部で actor 更新処理を呼び出せる。
     */
    static async #onSubmit(event, form, formData) {
        // formData.object にはフォームの入力値が平坦化されたオブジェクトが入っている
        const data = foundry.utils.expandObject(formData.object);
        // 例として、Actor に直接更新をかける
        await this.actor.update(data);
        // 送信後にシートを再レンダリングする場合
        await this.render();
    }
  
    static DEFAULT_OPTIONS = {
        ...super.DEFAULT_OPTIONS,
        id: "tokyo-nova-cast-sheet",
        classes: ["tokyo-nova", "sheet", "actor", "cast"],
        // ウィンドウの初期サイズは position にまとめる
        position: { width: 850, height: 900 },
        // AppV2 では form を明示的に指定する
        tag: "form",
        form: {
            handler: this.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: false
        },
        // ポップアウトにし、ドラッグリサイズと最小化を有効化
        popOut: true,
        resizable: true,
        minimizable: true,
        tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "abilities" }],
        /** AppV2: クリックは actions へ（this はインスタンスに bind されます） */
        actions: {
            // AppV2 では actions の関数は静的に定義するか、this バインドを行う
            "open-item-sheet": function(event) { return this._onOpenItemSheet(event); },
            "roll-style-description": function(event) { return this._onRollStyleDescription(event); },
            "toggle-style-role": function(event) { return this._onToggleStyleRole(event); },
            "use-miracle": function(event) { return this._onUseMiracle(event); },
            "toggle-edit-mode": function(event) { return this._onToggleEditMode(event); },
            "toggle-ability-details": function(event) { return this._onToggleAbilityDetails(event); },
            "open-hand-sheet": function(event) { return this._onOpenHandSheet(event); },
            "open-trump-card-sheet": function(event) { return this._onOpenTrumpCardSheet(event); },
            "play-card": function(event) { return this._onPlayCard(event); },
            "draw-card": function(event) { return this._onDrawCard(event); },
            "use-trump-card": function(event) { return this._onUseTrumpCard(event); },
            "pass-to-other": function(event) { return this._onPassToOther(event); }
        }
    };
  
    /** AppV2: PARTS はこのまま活用（body ひとつ構成） */
    static PARTS = {
        body: {
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs"
        }
    };

    async _updateActor(formData) {
        // ここでは formData から必要なデータを抜き出し、Actor に更新をかけます。
        const updates = foundry.utils.expandObject(formData);
        await this.actor.update(updates);
    }
  
    /** v2: getData 相当 */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.actor.system;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;
  
        const allStyles = this.actor.items.filter((i) => i.type === "style");
        const allMiracles = this.actor.items.filter((i) => i.type === "miracle");
        context.equippedAffiliations = this.actor.items.filter((i) => i.type === "organization");
        context.affiliationDisplay = context.equippedAffiliations[0]?.name || game.i18n.localize("TNX.Unaffiliated");
  
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
  
        await this._getCardPileData(context);
        this._getCitizenRankData(context);
        this._getAbilitiesData(context, allStyles);
        this._prepareSkillsData(context);
  
        return context;
    }
  
    /** v2: Post-render フック（クラス切り替え＆非 click のイベント） */
    _onRender(context, options) {
        super._onRender(context, options);
  
        // Edit/View モードのクラス
        if (this.isEditable) {
            this.element.classList.toggle("edit-mode", this._isEditMode);
            this.element.classList.toggle("view-mode", !this._isEditMode);
        } else {
            this.element.classList.remove("edit-mode");
            this.element.classList.add("view-mode");
        }
  
        // change イベント（能力成長のコスト計算など）
        this.element
            .querySelectorAll(
            '.ability-main-inputs input[name$=".growth"], .ability-main-inputs input[name$=".controlGrowth"]'
        )
        .forEach((el) => el.addEventListener("change", this._onGrowthChange.bind(this)));
  
        // Drag & Drop
        this._activateDragDrop(this.element);
  
        // Context Menus
        this._activateContextMenus(this.element);
    }
  
    /* ----------------------------- D&D 基盤 ----------------------------- */
  
    _activateDragDrop(html) {
        const dragDrop = new DragDrop({
            dropSelector: "form",
            callbacks: { drop: this._onDrop.bind(this) }
        });
        dragDrop.bind(html);
  
        const draggableCards = html.querySelectorAll(".hand-cards-display .card-in-hand");
        draggableCards.forEach((el) => {
            el.setAttribute("draggable", "true");
            el.addEventListener("dragstart", (event) => {
                event.stopPropagation();
                const dragData = {
                    sourceType: "actor-hand-card",
                    cardId: el.dataset.cardId,
                    actorId: this.actor.id
                };
                event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            });
        });
    }
  
    async _onDrop(event, data) {
        const item = await Item.fromDropData(data);
        if (item) return this._onDropItem(event, data);
  
        if (data.uuid) {
            const doc = await fromUuid(data.uuid);
            if (doc?.type === "hand" || doc?.type === "pile") return this._onDropCardPile(event, data);
        }
    }
  
    /* --------------------------- 各種データ整形 --------------------------- */
  
    _prepareStyleSlots(styles) {
        const slots = [];
        styles.forEach((item) => {
            const itemData = item.toObject(false);
            itemData.isEmpty = false;
            itemData.isPersona = item.system.level === 3 ? true : item.system.isPersona;
            itemData.isKey = item.system.level === 3 ? true : item.system.isKey;
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(itemData.isPersona, itemData.isKey);
            itemData.roleIndicatorClass = this._getRoleIndicatorClass(itemData.isPersona, itemData.isKey);
            for (let i = 0; i < item.system.level; i++) if (slots.length < 3) slots.push(itemData);
        });
        while (slots.length < 3) slots.push({ isEmpty: true });
        return slots;
    }
  
    _prepareStylesForView(styles) {
        return styles.map((item) => {
            const itemData = item.toObject(false);
            const level = item.system.level || 1;
            const isPersona = level === 3 ? true : item.system.isPersona;
            const isKey = level === 3 ? true : item.system.isKey;
            itemData.repeatedName = Array(level).fill(item.name).join("＝");
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(isPersona, isKey);
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
        const allSkills = this.actor.items.filter((i) => i.type === "skill");
        const generalSkills = allSkills.filter((s) => s.system.category === "generalSkill");
        context.connectionsSkills = generalSkills.filter((s) => s.name.startsWith("コネ"));
        const otherGeneralSkills = generalSkills.filter((s) => !s.name.startsWith("コネ"));
        const bySuit = {
            spade: { label: "スペード", skills: [] },
            club: { label: "クラブ", skills: [] },
            diamond: { label: "ダイヤ", skills: [] },
            heart: { label: "ハート", skills: [] },
            none: { label: "スートなし", skills: [] }
        };
        for (const skill of otherGeneralSkills) {
            if (skill.system.spade) bySuit.spade.skills.push(skill);
            else if (skill.system.club) bySuit.club.skills.push(skill);
            else if (skill.system.diamond) bySuit.diamond.skills.push(skill);
            else if (skill.system.heart) bySuit.heart.skills.push(skill);
            else bySuit.none.skills.push(skill);
        }
        context.generalSkillsBySuit = Object.values(bySuit).filter((g) => g.skills.length > 0);
    }
  
    /* ------------------------------ メニュー ------------------------------ */
  
    _activateContextMenus(html) {
        const itemDeleteCallback = async (header) => {
            const itemId = header.data("itemId");
            const item = this.actor.items.get(itemId);
            if (!item) return;
  
            if (item.type === "miracle") {
                const usage = item.system.usageCount;
                if (usage && usage.value > 1) {
                    const newValue = usage.value - 1;
                    const newTotal = Math.max(0, usage.total - 1);
                    await item.update({
                        "system.usageCount.value": newValue,
                        "system.usageCount.total": newTotal
                    });
                    ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                    return;
                }
            }
  
            if (item.type === "style" && item.system.level > 1) {
                await item.update({ "system.level": item.system.level - 1 });
                return;
            }
  
            await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        };
  
        const itemContextMenu = [
            {
            name: "SHEET.ItemDelete",
            icon: '<i class="fas fa-trash"></i>',
            condition: (header) => !!header.data("itemId"),
            callback: itemDeleteCallback
            }
        ];
        new ContextMenu(html, '.item-button[data-context-menu="item-edit"]', itemContextMenu);
  
        const miracleViewMenu = [
            {
                name: "閲覧",
                icon: '<i class="fas fa-eye"></i>',
                condition: (header) => !!header.data("itemId"),
                callback: (header) => this.actor.items.get(header.data("itemId"))?.sheet.render(true)
            },
            {
                name: "削除",
                icon: '<i class="fas fa-trash"></i>',
                condition: (header) => this.isEditable && !!header.data("itemId"),
                callback: itemDeleteCallback
            }
        ];
        new ContextMenu(html, '[data-context-menu="miracle-view"]', miracleViewMenu);
  
        const unlinkMenu = [
            {
                name: game.i18n.localize("TNX.UnlinkCards"),
                icon: '<i class="fas fa-unlink"></i>',
                callback: (panel) => this.actor.update({ [panel.data("unlinkPath")]: "" })
            }
        ];
        new ContextMenu(html, '[data-context-menu-type="unlink"]', unlinkMenu);
    }
  
    /* ------------------------- カード山 取得系 ------------------------- */
  
    async _getCardPileData(context) {
        const hand = await this._fetchLinkedCardPile(context.system.handPileId, "system.handPileId");
        context.handPile = hand || null;
  
        const trump = await this._fetchLinkedCardPile(
            context.system.trumpCardPileId,
            "system.trumpCardPileId"
        );
        if (trump) {
            context.trumpCardPile = trump;
            context.trumpCard = trump.cards?.[0] || null;
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
                data.cards = Array.from(doc.cards.values()).map((c) => c.toObject(false));
                return data;
            }
        } catch (e) {
            console.error(`TokyoNOVA | Failed to retrieve linked card pile (UUID: ${uuid})`, e);
            if (this.isEditable) this.actor.update({ [updatePath]: "" });
        }
        return null;
    }
  
    /* ------------------------- 表示用ユーティリティ ------------------------- */
  
    _getCitizenRankData(context) {
        const current = context.system.citizenRank;
        const map = { A: "A", "B+": "B+", B: "B", "B-": "B-", "C+": "C+", C: "C", "C-": "C-", X: "X" };
        context.citizenRankOptionsForSelect = Object.entries(map).map(([value, labelKey]) => ({
            value,
            label: game.i18n.localize(labelKey),
            selected: value === current
        }));
    }
  
    _getAbilitiesData(context, equippedStyles) {
        context.system.abilities = {};
        const keys = ["reason", "passion", "life", "mundane"];
        const labels = {
            reason: "TNX.Reason",
            passion: "TNX.Passion",
            life: "TNX.Life",
            mundane: "TNX.Mundane"
        };
  
        for (const key of keys) {
            const ability = context.system[key];
            let styleTotalValue = 0;
            let styleTotalControl = 0;
            const styleContrib = equippedStyles.map((style) => {
                const v = style.system[key]?.value || 0;
                const c = style.system[key]?.control || 0;
                const lvl = style.system.level || 1;
                styleTotalValue += v * lvl;
                styleTotalControl += c * lvl;
                return { name: style.name, value: v * lvl, control: c * lvl, level: lvl };
            });
  
            context.system.abilities[key] = {
                label: labels[key],
                growth: ability.growth,
                controlGrowth: ability.controlGrowth,
                mod: ability.mod,
                controlMod: ability.controlMod,
                effectMod: ability.effectMod,
                controlEffectMod: ability.controlEffectMod,
                styleContributions: styleContrib,
                totalValue: (ability.growth || 0) + styleTotalValue + (ability.mod || 0) + (ability.effectMod || 0),
                totalControl: (ability.controlGrowth || 0) + styleTotalControl + (ability.controlMod || 0) + (ability.controlEffectMod || 0)
            };
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
  
    _prepareMiraclesForDisplay(miracles) {
        const slots = [];
        miracles.forEach((item) => {
            const itemData = item.toObject(false);
            const usage = itemData.system.usageCount;
  
            if (typeof usage !== "object" || usage === null) {
                console.error(`アイテム「${item.name}」のusageCountが不正なデータです:`, usage);
                return;
            }
  
            const maxUses = (usage.value || 0) + (usage.mod || 0);
            const remaining = usage.total || 0;
  
            for (let i = 0; i < maxUses; i++) {
                slots.push({
                    ...itemData,
                    isPlaceholder: false,
                    instanceIndex: i,
                    isDisabled: i >= remaining
                });
            }
        });
        return slots;
    }
  
    /* ------------------------------ D&D 詳細 ------------------------------ */
  
    async _onDropItem(event, data) {
        const item = await Item.fromDropData(data);
        if (!item) return;
        const dropArea = event.target.closest("[data-drop-area]")?.dataset.dropArea;
  
        if (item.type === "style" && dropArea === "style") {
            const allStyles = this.actor.items.filter((i) => i.type === "style");
            const totalLevel = allStyles.reduce((sum, s) => sum + (s.system.level || 1), 0);
            const existing = allStyles.find((i) => i.name === item.name);
  
            let createdOrUpdatedStyle;
  
            if (existing) {
                if (totalLevel >= 3) {
                    ui.notifications.warn("これ以上スタイルレベルを上げられません。");
                    return false;
                }
                const currentLevel = existing.system.level || 1;
                createdOrUpdatedStyle = await existing.update({ "system.level": currentLevel + 1 });
            } else {
                const itemData = item.toObject();
                if (!itemData.system.level) itemData.system.level = 1;
                if (totalLevel + itemData.system.level > 3) {
                    ui.notifications.warn("スタイルの合計レベルが3を超えてしまいます。");
                    return false;
                }
                const created = await this.actor.createEmbeddedDocuments("Item", [itemData]);
                createdOrUpdatedStyle = created[0];
            }
  
            if (createdOrUpdatedStyle) {
                const miracleUuid = createdOrUpdatedStyle.system.miracle?.id;
                if (miracleUuid) {
                    const sourceMiracle = await fromUuid(miracleUuid);
                    if (sourceMiracle) {
                        const allMiracles = this.actor.items.filter((i) => i.type === "miracle");
                        const existingDivine = allMiracles.find((i) => i.name === sourceMiracle.name);
  
                        if (existingDivine) {
                            const usage = existingDivine.system.usageCount;
                            const mod = usage.mod || 0;
                            const newValue = Math.min(3, (usage.value || 0) + 1);
                            const newTotal = newValue + mod;
  
                            ui.notifications.info(`神業「${existingDivine.name}」の母数が+1されました。`);
                            await existingDivine.update({
                                "system.usageCount.value": newValue,
                                "system.usageCount.total": newTotal
                            });
                        } else {
                            if (allMiracles.length >= 3) {
                                ui.notifications.warn(`神業は3種類までしか所有できません。`);
                            } else {
                                const miracleData = sourceMiracle.toObject();
                                if (!foundry.utils.hasProperty(miracleData, "system.usageCount.value")) {
                                    const mod = foundry.utils.getProperty(miracleData, "system.usageCount.mod") || 0;
                                    foundry.utils.setProperty(miracleData, "system.usageCount", {
                                        value: 1,
                                        total: 1 + mod,
                                        mod,
                                        used: 0
                                    });
                                }
                                await this.actor.createEmbeddedDocuments("Item", [miracleData]);
                                ui.notifications.info(
                                    `神業「${miracleData.name}」がスタイル「${createdOrUpdatedStyle.name}」から追加されました。`
                                );
                            }
                        }
                    }
                }
            }
            return createdOrUpdatedStyle;
        }
  
        if (item.type === "miracle" && dropArea === "miracle") {
            const allMiracles = this.actor.items.filter((i) => i.type === "miracle");
            const existing = allMiracles.find((i) => i.name === item.name);
            if (existing) {
                const usage = existing.system.usageCount;
                const mod = usage.mod || 0;
                const newValue = Math.min(3, (usage.value || 0) + 1);
                const newTotal = newValue + mod;
  
                ui.notifications.info(`神業「${existing.name}」の母数が+1されました。`);
                return existing.update({
                    "system.usageCount.value": newValue,
                    "system.usageCount.total": newTotal
                });
            } else {
                if (allMiracles.length >= 3) {
                    ui.notifications.warn(`神業は3種類までしか所有できません。`);
                    return false;
                }
                const itemData = item.toObject();
                if (!foundry.utils.hasProperty(itemData, "system.usageCount.value")) {
                    const mod = foundry.utils.getProperty(itemData, "system.usageCount.mod") || 0;
                    foundry.utils.setProperty(itemData, "system.usageCount", {
                        value: 1,
                        total: 1 + mod,
                        mod,
                        used: 0
                    });
                }
                return this.actor.createEmbeddedDocuments("Item", [itemData]);
            }
        }
  
        const itemLimits = { organization: { limit: 1, area: "affiliation" } };
        const rule = itemLimits[item.type];
        if (rule && rule.area === dropArea) {
            const count = this.actor.items.filter((i) => i.type === item.type).length;
            if (count >= rule.limit) {
                ui.notifications.warn(`${item.name}は${rule.limit}つまでしか所有できません。`);
                return false;
            }
            return this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
        }
        return false;
    }
  
    async _onDropCardPile(event, data) {
        event.preventDefault();
        const dropArea = event.target.closest("[data-drop-area]")?.dataset.dropArea;
        if (!dropArea) return false;
        const droppedDoc = await fromUuid(data.uuid);
        if (!droppedDoc) return false;
        if (dropArea === "hand-pile" && droppedDoc.type === "hand") {
            await this.actor.update({ "system.handPileId": data.uuid });
            return true;
        }
        if (dropArea === "trump-card-pile" && droppedDoc.type === "pile") {
            await this.actor.update({ "system.trumpCardPileId": data.uuid });
            return true;
        }
        return false;
    }
  
    /* -------------------------- actions: クリック -------------------------- */
  
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
  
        const enriched = await TextEditor.enrichHTML(item.system.description, { async: true });
        const flavorText = `<h3>スタイル: ${item.name}</h3>`;
        const chatContent = `
            <details class="tnx-chat-card" open>
                <summary>${flavorText}</summary>
                <div class="card-content">
                    ${enriched}
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
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        const clickedItem = this.actor.items.get(itemId);
        if (!this.isEditable || !clickedItem) return;
  
        if (clickedItem.system.level === 3) {
            return ui.notifications.warn(
                "スタイルレベルが3のため、役割は「ペルソナ」と「キー」で固定されています。"
            );
        }
  
        const { isPersona, isKey } = clickedItem.system;
        let nextIsPersona, nextIsKey;
        if (!isPersona && !isKey) {
            nextIsPersona = true;
            nextIsKey = false;
        } else if (isPersona && !isKey) {
            nextIsPersona = false;
            nextIsKey = true;
        } else if (!isPersona && isKey) {
            nextIsPersona = true;
            nextIsKey = true;
        } else {
            nextIsPersona = false;
            nextIsKey = false;
        }
  
        const updates = [];
        const allStyles = this.actor.items.filter((i) => i.type === "style");
  
        for (const style of allStyles) {
            if (style.system.level === 3) continue;
            const updateData = { _id: style.id };
            let needsUpdate = false;
  
            if (style.id === clickedItem.id) {
                updateData["system.isPersona"] = nextIsPersona;
                updateData["system.isKey"] = nextIsKey;
                needsUpdate = true;
            } else {
                let resetPersona = false;
                let resetKey = false;
                if (nextIsPersona && style.system.isPersona) resetPersona = true;
                if (nextIsKey && style.system.isKey) resetKey = true;
                if (resetPersona) {
                    updateData["system.isPersona"] = false;
                    needsUpdate = true;
                }
                if (resetKey) {
                    updateData["system.isKey"] = false;
                    needsUpdate = true;
                }
            }
            if (needsUpdate) updates.push(updateData);
        }
  
        if (updates.length > 0) await this.actor.updateEmbeddedDocuments("Item", updates);
    }
  
    async _onUseMiracle(event) {
        event.preventDefault();
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
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
                const choices = game.items.filter(
                    (i) => i.type === "miracle" && i.name !== originalMiracle.name
                );
                if (choices.length === 0) return ui.notifications.warn("ワールドに選択可能な神業が存在しません。");
  
                const selectedId = await TargetSelectionDialog.prompt({
                    title: game.i18n.localize("TNX.SelectOmniMiracleTitle"),
                    label: game.i18n.format("TNX.SelectOmniMiracleContent", { name: originalMiracle.name }),
                    options: choices.map((dw) => ({ value: dw.id, label: dw.name })),
                    selectLabel: game.i18n.localize("TNX.Select")
                });
                if (!selectedId) return;
  
                const selectedWork = game.items.get(selectedId);
                if (!selectedWork) return ui.notifications.error("選択された神業が見つかりませんでした。");
                targetMiracle = selectedWork;
            }
        }
  
        const remainingUses = originalMiracle.system.usageCount.total || 0;
        if (remainingUses <= 0) {
            return ui.notifications.warn(`神業「${originalMiracle.name}」はこれ以上使用できません。`);
        }
  
        await originalMiracle.update({
            "system.usageCount.total": remainingUses - 1,
            "system.isUsed": remainingUses - 1 === 0
        });
  
        const originalDescription = await TextEditor.enrichHTML(originalMiracle.system.description, {
            async: true
        });
        let nestedContent = "";
  
        if (useAsOther && targetMiracle.id !== originalMiracle.id) {
            const selectedDescription = await TextEditor.enrichHTML(targetMiracle.system.description, {
                async: true
            });
            nestedContent = `
                <details class="nested-description">
                <summary><h4>発動効果: ${targetMiracle.name}</h4></summary>
                    <div class="card-content">
                        ${selectedDescription}
                    </div>
                </details>
            `;
        }
  
        const name = originalMiracle.name;
        const furigana = originalMiracle.system.furigana;
        const nameHtml = furigana ? `<ruby>${name}<rt>${furigana}</rt></ruby>` : name;
  
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
  
        const msg =
            useAsOther && targetMiracle.id !== originalMiracle.id
                ? `神業「${originalMiracle.name}」を使用し、「${targetMiracle.name}」の効果を発動しました。`
                : `神業「${originalMiracle.name}」を使用しました。`;
        ui.notifications.info(msg);
    }
  
    _onToggleEditMode(event) {
        event.preventDefault();
        this._isEditMode = !this._isEditMode;
        this.render();
    }
  
    _onToggleAbilityDetails(event) {
        event.preventDefault();
        const toggle = event.currentTarget;
        const panel = toggle.closest(".ability-block")?.querySelector(".ability-details-panel");
        if (!panel) return;
        const open = panel.classList.toggle("open");
        // 簡易トグル（CSS アニメーションで slide 相当を表現）
        if (open) panel.style.maxHeight = panel.scrollHeight + "px";
        else panel.style.maxHeight = "0px";
        toggle.querySelector("i")?.classList.toggle("fa-chevron-down");
        toggle.querySelector("i")?.classList.toggle("fa-chevron-up");
    }
  
    _onOpenHandSheet(event) {
        event.preventDefault();
        const handPileId = this.actor.system.handPileId;
        if (handPileId) fromUuid(handPileId).then((doc) => doc?.sheet.render(true));
    }
  
    _onOpenTrumpCardSheet(event) {
        event.preventDefault();
        const trumpCardPileId = this.actor.system.trumpCardPileId;
        if (trumpCardPileId) fromUuid(trumpCardPileId).then((doc) => doc?.sheet.render(true));
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
  
        if (confirmed) await TnxActionHandler.useTrump(trumpCard.id, { actor: this.actor });
    }
  
    async _onPassToOther(event) {
        event.preventDefault();
        const sourceHand = await fromUuid(this.actor.system.handPileId);
        if (!sourceHand || sourceHand.cards.size === 0)
        return ui.notifications.warn("渡せるカードが手札にありません。");
        const cards = Array.from(sourceHand.cards.values()).map((c) => c.toObject(false));
        const selectedCardsIds = await CardSelectionDialog.prompt({
            title: game.i18n.localize("TNX.SelectCardsToPassTitle"),
            content: game.i18n.localize("TNX.SelectCardsToPassContent"),
            cards,
            passLabel: game.i18n.localize("TNX.Pass")
        });
        if (!selectedCardsIds || selectedCardsIds.length === 0) return;
        const others = game.actors.filter((a) => a.id !== this.actor.id && a.type === "cast");
        if (others.length === 0) return ui.notifications.warn(game.i18n.localize("TNX.NoOtherActorsFound"));
        const targetActorId = await TargetSelectionDialog.prompt({
            title: game.i18n.localize("TNX.SelectTargetActorTitle"),
            label: game.i18n.localize("TNX.SelectTargetActorContent"),
            options: others.map((a) => ({ value: a.id, label: a.name })),
            selectLabel: game.i18n.localize("TNX.Pass")
        });
        if (!targetActorId) return;
        const targetActor = game.actors.get(targetActorId);
        if (!targetActor?.system.handPileId)
        return ui.notifications.warn(`${targetActor.name}に手札が設定されていません。`);
        await TnxActionHandler.passCards(this.actor.id, targetActorId, selectedCardsIds);
    }
  
    /* ----------------------------- 入力の成長 ----------------------------- */
  
    async _onGrowthChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const name = input.name;
        const newValue = parseInt(input.value, 10) || 0;
  
        const oldValue = foundry.utils.getProperty(this.actor, name) || 0;
        if (newValue === oldValue) return;
  
        const parts = name.split(".");
        const abilityKey = parts[1];
        const isControl = name.endsWith("controlGrowth");
  
        const allStyles = this.actor.items.filter((i) => i.type === "style");
        let styleTotalValue = 0;
        let styleTotalControl = 0;
        allStyles.forEach((style) => {
            const level = style.system.level || 1;
            styleTotalValue += (style.system[abilityKey]?.value || 0) * level;
            styleTotalControl += (style.system[abilityKey]?.control || 0) * level;
        });
  
        const ability = this.actor.system[abilityKey];
        const baseValue = styleTotalValue + (ability.mod || 0) + (ability.effectMod || 0);
        const baseControl = styleTotalControl + (ability.controlMod || 0) + (ability.controlEffectMod || 0);
        const baseForCalc = isControl ? baseControl : baseValue;
  
        const costForOld = this._calculateGrowthCost(isControl, oldValue, baseForCalc);
        const costForNew = this._calculateGrowthCost(isControl, newValue, baseForCalc);
        const totalCost = costForNew - costForOld;
  
        const currentExp = this.actor.system.exp.value;
  
        if (totalCost > 0 && totalCost > currentExp) {
            ui.notifications.warn(`経験点が足りません！ (必要: ${totalCost} / 所持: ${currentExp})`);
            input.value = oldValue;
            return;
        }
  
        const newExp = currentExp - totalCost;
        await this.actor.update({
            [name]: newValue,
            "system.exp.value": newExp
        });
  
        const abilityLabel = game.i18n.localize(this.actor.system.abilities[abilityKey].label);
        const changeType = isControl ? "制御値" : "能力値";
        const costText = totalCost > 0 ? `${totalCost}点 消費` : `${-totalCost}点 回復`;
        ui.notifications.info(`${abilityLabel} [${changeType}] の成長が変更されました (${costText})。`);
    }
  
    _calculateGrowthCost(isControl, growthPoints, baseValue) {
        if (growthPoints <= 0) return 0;
  
        const costTier1 = 20;
        const costTier2 = 40;
        const threshold = isControl ? 17 : 11;
  
        let totalCost = 0;
        for (let i = 1; i <= growthPoints; i++) {
            const currentTotalValue = baseValue + i;
            totalCost += currentTotalValue < threshold ? costTier1 : costTier2;
        }
        return totalCost;
    }
}