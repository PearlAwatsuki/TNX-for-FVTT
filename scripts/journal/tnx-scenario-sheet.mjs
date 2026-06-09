import { UnlinkConfirmDialog } from '../module/tnx-dialog.mjs';
import { TnxScenarioSettingWizard } from '../module/tnx-scenario-setting-wizard.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';
import { saveUserFlagCards, getUserFlagData } from '../module/user-flag-schema.mjs';

const { HandlebarsApplicationMixin, DocumentSheetV2, DialogV2 } = foundry.applications.api;

export class TnxScenarioSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "journal", "scenario", "two-column-layout"],
        position: { width: 800, height: 700 },
        dragDrop: [{ dragSelector: null, dropSelector: ".tnx-import-box--dropzone" }],
        actions: {
            openDocument:      TnxScenarioSheet._onOpenDocument,
            launchWizard:      TnxScenarioSheet._onLaunchWizard,
            addScene:          TnxScenarioSheet._onAddScene,
            deleteScene:       TnxScenarioSheet._onDeleteScene,
            switchScene:       TnxScenarioSheet._onSwitchScene,
            addTextItem:       TnxScenarioSheet._onAddTextItem,
            deleteTextItem:    TnxScenarioSheet._onDeleteTextItem,
            sendTextToChat:    TnxScenarioSheet._onSendTextToChat,
            addInfoItem:       TnxScenarioSheet._onAddInfoItem,
            deleteInfoItem:    TnxScenarioSheet._onDeleteInfoItem,
            sendInfoToChat:    TnxScenarioSheet._onSendInfoToChat,
            addInfoContent:    TnxScenarioSheet._onAddInfoContent,
            deleteInfoContent: TnxScenarioSheet._onDeleteInfoContent,
            addSkillCheck:     TnxScenarioSheet._onAddSkillCheck,
            deleteSkillCheck:  TnxScenarioSheet._onDeleteSkillCheck,
            sendTrailerToChat: TnxScenarioSheet._onSendTrailerToChat,
            addHandout:        TnxScenarioSheet._onAddHandout,
            deleteHandout:     TnxScenarioSheet._onDeleteHandout,
            sendHandoutToChat: TnxScenarioSheet._onSendHandoutToChat,
            createAllUserHands: TnxScenarioSheet._onCreateAllUserHands,
            resetAccessCards:  TnxScenarioSheet._onDistributeRlTrump,
            dealInitialHands:  TnxScenarioSheet._onDealInitialHands,
            dealTrumpFromNeuro: TnxScenarioSheet._onDealTrumpFromNeuro,
            dealTrumpForRl:    TnxScenarioSheet._onDealRlTrumpFromAccess,
        },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
        },
    };

    tabGroups = { primary: "setting" };

    /**
     * Foundry V13 の changeTab は `.tabs` クラスを nav に要求するが、
     * 縦型タブレイアウトでは Foundry コア CSS と競合するため、独自実装で置き換える。
     */
    changeTab(tab, group, options = {}) {
        if (!tab || !group) return;
        if ((this.tabGroups[group] === tab) && !options.force) return;

        for (const item of this.element.querySelectorAll(`[data-group="${group}"][data-tab]`)) {
            item.classList.toggle("active", item.dataset.tab === tab);
        }
        for (const section of this.element.querySelectorAll(`.tab[data-group="${group}"]`)) {
            section.classList.toggle("active", section.dataset.tab === tab);
        }
        this.tabGroups[group] = tab;
    }

    // ─── コンテキスト準備 ─────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const flagData = this.document.flags["tokyo-nova-axleration"] || {};

        context.castActors = game.actors.filter(a => a.type === 'cast');
        context.phaseLabels = CONFIG.TNX.phaseLabels;

        const cardDocs = {
            cardDeck:       await fromUuid(flagData.cardDeckId),
            discardPile:    await fromUuid(flagData.discardPileId),
            neuroDeck:      await fromUuid(flagData.neuroDeckId),
            scenePile:      await fromUuid(flagData.scenePileId),
            accessCardPile: await fromUuid(flagData.accessCardPileId),
            gmTrumpDiscard: await fromUuid(flagData.gmTrumpDiscardId),
        };
        for (const [key, doc] of Object.entries(cardDocs)) {
            context[key] = doc;
        }

        const scenesData = flagData.scenes || {};
        context.scenes = {
            opening:  Array.isArray(scenesData.opening)  ? scenesData.opening  : [],
            research: Array.isArray(scenesData.research) ? scenesData.research : [],
            climax:   Array.isArray(scenesData.climax)   ? scenesData.climax   : [],
            ending:   Array.isArray(scenesData.ending)   ? scenesData.ending   : [],
        };

        context.scenarioTexts = flagData.scenarioTexts || [];
        context.infoItems     = flagData.infoItems     || [];
        context.trailer       = flagData.trailer       || "";
        context.handouts      = flagData.handouts      || [];

        return context;
    }

    // ─── レンダリング ─────────────────────────────────────────────────────────

    _onRender(_context, _options) {
        this._setupContextMenus();
        this._setupChangeListeners();
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) this.changeTab(tab, group, { force: true });
        }
    }

    // ─── 変更リスナー ─────────────────────────────────────────────────────────

    _setupChangeListeners() {
        const el = this.element;

        for (const input of el.querySelectorAll('.scene-item input[type="text"], .scene-item input[type="checkbox"], .scene-item textarea, .scene-item select')) {
            input.addEventListener('change', this._onSceneItemChange.bind(this));
        }
        for (const checkbox of el.querySelectorAll('.scene-item input[name="isMasterScene"]')) {
            checkbox.addEventListener('change', this._onToggleMasterScene.bind(this));
        }
        for (const sceneItem of el.querySelectorAll('.scene-item')) {
            this._updateScenePlayerState(sceneItem);
        }

        for (const input of el.querySelectorAll('.text-item input[type="text"], .text-item textarea')) {
            input.addEventListener('change', this._onTextItemChange.bind(this));
        }
        for (const input of el.querySelectorAll('.info-item input, .info-item textarea')) {
            input.addEventListener('change', this._onInfoItemChange.bind(this));
        }
        for (const input of el.querySelectorAll('.scenario-info-container textarea, .handout-item input, .handout-item textarea')) {
            input.addEventListener('change', this._onScenarioInfoChange.bind(this));
        }
    }

    // ─── コンテキストメニュー ─────────────────────────────────────────────────

    _setupContextMenus() {
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, ".tnx-linked-btn", [{
            name: "リンクを解除",
            icon: '<i class="fas fa-unlink"></i>',
            condition: el => !!(el.dataset?.uuid ?? el[0]?.dataset?.uuid),
            callback: async header => {
                const uuid = header.dataset.uuid;
                const slot = header.closest('[data-drop-area]');
                if (!slot) return;
                const flagKey = `${slot.dataset.dropArea}Id`;
                const linkedDoc = await fromUuid(uuid);
                if (!linkedDoc) {
                    ui.notifications.warn("リンク先のドキュメントが見つかりませんでした。");
                    await this.document.update({ [`flags.tokyo-nova-axleration.-=${flagKey}`]: null });
                    return this.render({ force: true });
                }
                const choice = await UnlinkConfirmDialog.prompt({ linkedDoc });
                if (choice === "unlink" || choice === "delete") {
                    await this.document.update({ [`flags.tokyo-nova-axleration.-=${flagKey}`]: null });
                    ui.notifications.info(`「${linkedDoc.name}」とのリンクを解除しました。`);
                    if (choice === "delete") {
                        await linkedDoc.delete();
                        ui.notifications.info(`「${linkedDoc.name}」を削除しました。`);
                    }
                    this.render({ force: true });
                }
            },
        }], { jQuery: false, fixed: true });
    }

    // ─── ドロップ処理 ─────────────────────────────────────────────────────────

    async _onDrop(event) {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch { return false; }
        if (data.type !== "Cards" || !data.uuid) return;

        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;
        if (!dropArea) return;

        const droppedDoc = await fromUuid(data.uuid);
        if (!droppedDoc) return;

        await this.document.setFlag("tokyo-nova-axleration", `${dropArea}Id`, droppedDoc.uuid);
        this.render({ force: true });
        ui.notifications.info(`「${droppedDoc.name}」が${dropArea}としてリンクされました。`);
    }

    // ─── インスタンス変更ハンドラ ─────────────────────────────────────────────

    async _onScenarioInfoChange(event) {
        const input = event.currentTarget;
        const name = input.name;
        const value = input.value;
        const handoutItem = input.closest('.handout-item');

        if (handoutItem) {
            const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
            const handout = handouts.find(h => h.id === handoutItem.dataset.id);
            if (handout) {
                handout[name] = value;
                await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
            }
        } else if (name === "trailer") {
            await this.document.setFlag("tokyo-nova-axleration", "trailer", value);
        }
    }

    async _onSceneItemChange(event) {
        const input = event.currentTarget;
        const sceneItem = input.closest('.scene-item');
        const sceneId = sceneItem.dataset.sceneId;
        const phase = sceneItem.dataset.phase;

        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes[phase]?.find(s => s.id === sceneId);
        if (!scene) return;

        scene[input.name] = input.type === 'checkbox' ? input.checked : input.value;
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    _onToggleMasterScene(event) {
        this._updateScenePlayerState(event.currentTarget.closest('.scene-item'));
    }

    _updateScenePlayerState(sceneItem) {
        const checkbox = sceneItem.querySelector('input[name="isMasterScene"]');
        const playerInput = sceneItem.querySelector('select[name="player"]');
        if (checkbox && playerInput) {
            playerInput.disabled = checkbox.checked;
            if (checkbox.checked) playerInput.value = '';
        }
    }

    async _onTextItemChange(event) {
        const input = event.currentTarget;
        const id = input.closest('.text-item').dataset.id;
        const texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        const textItem = texts.find(t => t.id === id);
        if (textItem) {
            textItem[input.name] = input.value;
            await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
        }
    }

    async _onInfoItemChange(event) {
        const input = event.currentTarget;
        const { infoId, contentId, skillId } = input.dataset;
        const value = input.type === "checkbox" ? input.checked
            : input.type === "number" ? parseInt(input.value)
            : input.value;

        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;

        if (contentId && skillId) {
            const skill = item.contents.find(c => c.id === contentId)?.skills.find(s => s.id === skillId);
            if (skill) skill[input.name] = value;
        } else if (contentId) {
            const content = item.contents.find(c => c.id === contentId);
            if (content) content[input.name] = value;
        } else {
            item[input.name] = value;
        }

        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    // ─── 静的アクションハンドラ ───────────────────────────────────────────────

    static async _onOpenDocument(_event, target) {
        const doc = await fromUuid(target.dataset.uuid);
        doc?.sheet.render({ force: true });
    }

    static async _onLaunchWizard(_event, _target) {
        new TnxScenarioSettingWizard(this.document).render(true);
    }

    static async _onAddScene(_event, target) {
        const phase = target.dataset.phase;
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes") || { opening: [], research: [], climax: [], ending: [] });
        if (!Array.isArray(scenes[phase])) scenes[phase] = [];
        scenes[phase].push({ id: foundry.utils.randomID(), number: "", name: "新規シーン", player: "", isMasterScene: false, switchMessage: "" });
        this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    static async _onDeleteScene(_event, target) {
        const sceneItem = target.closest('.scene-item');
        const { sceneId, phase } = sceneItem.dataset;
        const confirmed = await DialogV2.confirm({
            window: { title: "シーンの削除" },
            content: "<p>このシーンを削除しますか？</p>",
        });
        if (!confirmed) return;
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        if (scenes[phase]) scenes[phase] = scenes[phase].filter(s => s.id !== sceneId);
        this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    static async _onSwitchScene(_event, target) {
        const sceneItem = target.closest('.scene-item');
        const { sceneId, phase } = sceneItem.dataset;
        const scenes = this.document.getFlag("tokyo-nova-axleration", "scenes");
        const scene = scenes[phase]?.find(s => s.id === sceneId);
        if (!scene) return;

        const sceneTitle = `<h2>SCENE ${scene.number || '??'} : ${scene.name || '無題のシーン'}</h2>`;
        const sceneDetails = scene.isMasterScene ? `<p>マスターシーン</p>`
            : scene.player ? `<p><strong>シーンプレイヤー:</strong> ${scene.player}</p>` : '';
        const customMessage = scene.switchMessage ? `<hr>${scene.switchMessage}` : '';
        const chatContent = sceneTitle + sceneDetails + customMessage;
        if (chatContent) ChatMessage.create({ content: chatContent });
        await this.document.setFlag("tokyo-nova-axleration", "currentState", { phase, sceneId });
        ui.notifications.info(`シーン「${scene.name}」に切り替えました。`);
    }

    static async _onAddTextItem(_event, _target) {
        const texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        texts.push({ id: foundry.utils.randomID(), title: "新規テキスト", content: "" });
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
    }

    static async _onDeleteTextItem(_event, target) {
        const textItemId = target.closest('.text-item').dataset.id;
        const confirmed = await DialogV2.confirm({
            window: { title: "テキストの削除" },
            content: "<p>このテキスト項目を削除しますか？</p>",
        });
        if (!confirmed) return;
        let texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        texts = texts.filter(t => t.id !== textItemId);
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
    }

    static async _onSendTextToChat(_event, target) {
        const textItemId = target.closest('.text-item').dataset.id;
        const texts = this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || [];
        const textItem = texts.find(t => t.id === textItemId);
        if (textItem?.content) ChatMessage.create({ content: textItem.content });
        else ui.notifications.warn("送信するテキストがありません。");
    }

    static async _onAddInfoItem(_event, _target) {
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        items.push({
            id: foundry.utils.randomID(),
            title: "新規情報",
            isPublic: false,
            contents: [{
                id: foundry.utils.randomID(),
                text: "",
                isDisclosed: false,
                skills: [{ id: foundry.utils.randomID(), name: "", tn: null }],
            }],
        });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteInfoItem(_event, target) {
        const infoItemId = target.dataset.infoId;
        const confirmed = await DialogV2.confirm({
            window: { title: "情報の削除" },
            content: "<p>この情報項目全体を削除しますか？</p>",
        });
        if (!confirmed) return;
        let items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        items = items.filter(i => i.id !== infoItemId);
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onSendInfoToChat(_event, target) {
        const infoItemId = target.dataset.infoId;
        const items = this.document.getFlag("tokyo-nova-axleration", "infoItems") || [];
        const item = items.find(i => i.id === infoItemId);
        if (!item?.contents) return;

        const chatContent = `<h3>${item.title}</h3>`;
        const disclosedContents = item.contents.filter(c => c.isDisclosed);

        const buildSkillHtml = (contents) => {
            let html = "";
            let added = false;
            for (const content of contents) {
                const skillsByTn = content.skills.reduce((acc, skill) => {
                    if (skill.name && skill.tn) {
                        (acc[skill.tn] = acc[skill.tn] || []).push(skill.name);
                    }
                    return acc;
                }, {});
                const skillsHtml = Object.entries(skillsByTn)
                    .map(([tn, names]) => `<strong>${names.join(" / ")} &gt; ${tn}</strong>`)
                    .join("<br>");
                if (skillsHtml || content.text) {
                    if (added) html += "<hr>";
                    if (skillsHtml) html += `<p>${skillsHtml}</p>`;
                    if (content.text) html += `<p>${content.text}</p>`;
                    added = true;
                }
            }
            return { html, added };
        };

        if (disclosedContents.length > 0) {
            const { html } = buildSkillHtml(disclosedContents);
            ChatMessage.create({ content: chatContent + html });
            ui.notifications.info(`情報「${item.title}」の公開済み内容を送信しました。`);
        } else {
            const { html, added } = buildSkillHtml(item.contents);
            if (added) {
                ChatMessage.create({ content: chatContent + html });
                ui.notifications.info(`情報「${item.title}」の目標値情報を送信しました。`);
            } else {
                ui.notifications.warn("送信できる技能・目標値がありません。");
            }
        }
    }

    static async _onAddInfoContent(_event, target) {
        const infoId = target.dataset.infoId;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;
        if (!Array.isArray(item.contents)) item.contents = [];
        item.contents.push({
            id: foundry.utils.randomID(),
            text: "",
            isDisclosed: false,
            skills: [{ id: foundry.utils.randomID(), name: "", tn: null }],
        });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteInfoContent(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;
        item.contents = item.contents.filter(c => c.id !== contentId);
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddSkillCheck(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteSkillCheck(_event, target) {
        const { infoId, contentId, skillId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills = content.skills.filter(s => s.id !== skillId);
        if (content.skills.length === 0) content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onSendTrailerToChat(_event, _target) {
        const trailer = this.document.getFlag("tokyo-nova-axleration", "trailer");
        if (trailer) ChatMessage.create({ content: `<h3>シナリオトレーラー</h3><hr>${trailer}` });
        else ui.notifications.warn("トレーラーが入力されていません。");
    }

    static async _onAddHandout(_event, _target) {
        const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        handouts.push({
            id: foundry.utils.randomID(),
            pcName: `PC${handouts.length + 1}`,
            title: `ハンドアウト ${handouts.length + 1}`,
            connections: "",
            recommendedSuit: "",
            recommendedStyle: "",
            content: "",
            ps: "",
        });
        await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    static async _onDeleteHandout(_event, target) {
        const id = target.closest('.handout-item').dataset.id;
        const confirmed = await DialogV2.confirm({
            window: { title: "ハンドアウトの削除" },
            content: "<p>このハンドアウトを削除しますか？</p>",
        });
        if (!confirmed) return;
        let handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        handouts = handouts.filter(h => h.id !== id);
        await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    static async _onSendHandoutToChat(_event, target) {
        const id = target.closest('.handout-item').dataset.id;
        const handouts = this.document.getFlag("tokyo-nova-axleration", "handouts") || [];
        const handout = handouts.find(h => h.id === id);
        if (!handout) return;

        let chatContent = `<h3>${handout.title} (${handout.pcName})</h3>`;
        let details = '';
        if (handout.connections)      details += `<p><strong>コネ:</strong> ${handout.connections}</p>`;
        if (handout.recommendedSuit)  details += `<p><strong>推奨スート:</strong> ${handout.recommendedSuit}</p>`;
        if (handout.recommendedStyle) details += `<p><strong>推奨スタイル:</strong> ${handout.recommendedStyle}</p>`;
        if (details) chatContent += details;
        chatContent += `<hr>${handout.content}`;
        if (handout.ps) chatContent += `<hr><h4>PS</h4><p>${handout.ps}</p>`;
        ChatMessage.create({ content: chatContent });
    }

    static async _onCreateAllUserHands(_event, _target) {
        if (!game.user.isGM) return ui.notifications.warn("この操作はGMのみ実行可能です。");

        const confirmed = await DialogV2.confirm({
            window: { title: "全ユーザーの手札作成" },
            content: "<p>すべてのユーザーに対して、手札および切り札置き場を一括作成し、ユーザーデータに登録しますか？</p><p>（既に設定されているユーザーは上書きで再作成されます。過去の手札ドキュメントは削除されず残ります）</p>",
        });
        if (!confirmed) return;

        ui.notifications.info("手札・切り札の作成を開始します...");
        let createdCount = 0;

        for (const user of game.users) {
            const handPileName  = `${user.name}の手札`;
            const trumpPileName = `${user.name}の切り札`;
            const ownership = {
                default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
                [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
            };
            if (user.id !== game.user.id) ownership[game.user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

            try {
                const handPile  = await Cards.create({ name: handPileName,  type: "hand", description: `「${user.name}」の手札です。`,      img: "icons/svg/card-hand.svg", ownership });
                const trumpPile = await Cards.create({ name: trumpPileName, type: "pile", description: `「${user.name}」の切り札置き場です。`, img: "icons/svg/card-hand.svg", ownership, flags: { "tokyo-nova-axleration": { isTrumpPile: true } } });
                if (handPile && trumpPile) {
                    await saveUserFlagCards(user, handPile.uuid, trumpPile.uuid);
                    createdCount++;
                }
            } catch (err) {
                console.error(`TokyoNOVA | Failed to create cards for user ${user.name}:`, err);
            }
        }

        ui.notifications.info(`全 ${createdCount} 人のユーザーに手札・切り札を作成しました。`);
    }

    static async _onDistributeRlTrump(_event, _target) {
        const gmTrumpDiscardId = this.document.getFlag("tokyo-nova-axleration", "gmTrumpDiscardId");
        if (!gmTrumpDiscardId) return ui.notifications.warn("RL切り札捨て場がこのシナリオに設定されていません。");

        const gmTrumpDiscard = await fromUuid(gmTrumpDiscardId);
        if (!gmTrumpDiscard) return ui.notifications.error("設定されているRL切り札捨て場が見つかりませんでした。");

        const gm = game.users.find(u => u.isGM);
        if (!gm) return ui.notifications.warn("GMユーザーが見つかりません。");

        const gmTrumpPile = await fromUuid(getUserFlagData(gm).trumpCardPileId);
        if (!gmTrumpPile) return ui.notifications.warn("GMユーザーの切り札置き場が設定・取得できませんでした。");

        const trumpCard = gmTrumpDiscard.cards.find(c => c.name === "切り札");
        if (!trumpCard) return ui.notifications.info("RL切り札捨て場に「切り札」カードはありません。配布の必要はありません。");
        if (gmTrumpPile.cards.size > 0) return ui.notifications.warn("RLの切り札には既にカードがあるため、配布できませんでした。");

        await gmTrumpDiscard.pass(gmTrumpPile, [trumpCard.id]);
        ui.notifications.info("「切り札」をRLの切り札に再配布しました。");
    }

    static async _onDealInitialHands(_event, _target) {
        await TnxActionHandler.dealInitialHands();
    }

    static async _onDealTrumpFromNeuro(_event, _target) {
        await TnxActionHandler.dealTrumpFromNeuroDeck();
    }

    static async _onDealRlTrumpFromAccess(_event, _target) {
        const accessCardPileId = this.document.getFlag("tokyo-nova-axleration", "accessCardPileId");
        if (!accessCardPileId) return ui.notifications.warn("アクセスカード山が設定されていません。設定タブでドロップしてください。");

        const accessCardPile = await fromUuid(accessCardPileId);
        if (!accessCardPile) return ui.notifications.error("設定されているアクセスカード山が見つかりませんでした。");

        const gm = game.users.find(u => u.isGM);
        if (!gm) return ui.notifications.warn("GMユーザーが見つかりません。");

        const gmTrumpPile = await fromUuid(getUserFlagData(gm).trumpCardPileId);
        if (!gmTrumpPile) return ui.notifications.warn("GMユーザーの切り札置き場が設定・取得できませんでした。");

        const trumpCard = accessCardPile.cards.contents.find(c => c.name === "切り札");
        if (!trumpCard) return ui.notifications.info("アクセスカード山の中に「切り札」カードが見つかりませんでした。");
        if (gmTrumpPile.cards.size > 0) return ui.notifications.warn("RLの切り札には既にカードがあるため、配布を中止しました。");

        await accessCardPile.pass(gmTrumpPile, [trumpCard.id]);
        ui.notifications.info("RLに「切り札」を配布しました。");
    }
}
