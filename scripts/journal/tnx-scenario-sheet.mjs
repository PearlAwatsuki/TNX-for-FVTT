import { UnlinkConfirmDialog } from '../module/tnx-dialog.mjs';
import { TnxScenarioSettingWizard } from '../module/tnx-scenario-setting-wizard.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';

/**
 * TokyoNOVAのアクトシート（シナリオ管理用カスタムジャーナルシート）
 */
export class TnxScenarioSheet extends JournalSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "journal", "scenario", "two-column-layout"],
            template: "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
            width: 800,
            height: 700,
            dragDrop: [{ dragSelector: null, dropSelector: ".tnx-import-box--dropzone" }],
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "setting" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        const flagData = this.object.flags["tokyo-nova-axleration"] || {};
        context.castActors = game.actors.filter(a => a.type === 'cast');
        context.phaseLabels = CONFIG.TNX.phaseLabels;

        const cardDocs = {
            cardDeck: await fromUuid(flagData.cardDeckId),
            discardPile: await fromUuid(flagData.discardPileId),
            neuroDeck: await fromUuid(flagData.neuroDeckId),
            scenePile: await fromUuid(flagData.scenePileId),
            accessCardPile: await fromUuid(flagData.accessCardPileId),
            gmTrumpDiscard: await fromUuid(flagData.gmTrumpDiscardId)
        };
        for (const [key, doc] of Object.entries(cardDocs)) {
            context[key] = doc;
        }

        const scenesData = flagData.scenes || {};
        context.scenes = {
            opening: Array.isArray(scenesData.opening) ? scenesData.opening : [],
            research: Array.isArray(scenesData.research) ? scenesData.research : [],
            climax: Array.isArray(scenesData.climax) ? scenesData.climax : [],
            ending: Array.isArray(scenesData.ending) ? scenesData.ending : []
        };
        
        context.scenarioTexts = flagData.scenarioTexts || [];
        context.infoItems = flagData.infoItems || [];
        context.trailer = flagData.trailer || "";
        context.handouts = flagData.handouts || [];
        
        return context;
    }

    async _updateObject(event, formData) {}

    activateListeners(html) {
        super.activateListeners(html);

        html.find('[data-action]').on('click', this._handleActionClick.bind(this));
        
        html.find('.scene-item input[type="text"], .scene-item input[type="checkbox"], .scene-item textarea, .scene-item select').on('change', this._onSceneItemChange.bind(this));
        html.find('.scene-item input[name="isMasterScene"]').on('change', this._onToggleMasterScene.bind(this));
        html.find('.scene-item').each((i, el) => this._updateScenePlayerState(el));
        
        html.find('.text-item input[type="text"], .text-item textarea').on('change', this._onTextItemChange.bind(this));
        html.find('.info-item input, .info-item textarea').on('change', this._onInfoItemChange.bind(this));
        html.find('.scenario-info-container textarea, .handout-item input, .handout-item textarea').on('change', this._onScenarioInfoChange.bind(this));

        this._activateContextMenu(html);
    }

    async _onScenarioInfoChange(event) {
        const input = event.currentTarget;
        const name = input.name;
        const value = input.value;
        const handoutItem = input.closest('.handout-item');

        if (handoutItem) {
            const id = handoutItem.dataset.id;
            const handouts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "handouts") || []);
            const handout = handouts.find(h => h.id === id);
            if (handout) {
                handout[name] = value;
                await this.object.setFlag("tokyo-nova-axleration", "handouts", handouts);
            }
        } else if (name === "trailer") {
            await this.object.setFlag("tokyo-nova-axleration", "trailer", value);
        }
    }
    
    async _onSceneItemChange(event) {
        const input = event.currentTarget;
        const sceneItem = input.closest('.scene-item');
        const sceneId = sceneItem.dataset.sceneId;
        const phase = sceneItem.dataset.phase;
        
        const scenes = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes[phase]?.find(s => s.id === sceneId);

        if (!scene) return;
        
        const fieldName = input.name;
        const value = input.type === 'checkbox' ? input.checked : input.value;
        scene[fieldName] = value;
        
        await this.object.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    _onToggleMasterScene(event) {
        const checkbox = event.currentTarget;
        const sceneItem = checkbox.closest('.scene-item');
        this._updateScenePlayerState(sceneItem);
    }

    _updateScenePlayerState(sceneItem) {
        const checkbox = sceneItem.querySelector('input[name="isMasterScene"]');
        const playerInput = sceneItem.querySelector('select[name="player"]');
        if (checkbox && playerInput) {
            playerInput.disabled = checkbox.checked;
            if (checkbox.checked) {
                playerInput.value = '';
            }
        }
    }

    async _handleActionClick(event) {
        event.preventDefault();
        const action = event.currentTarget.dataset.action;
        const targetElement = event.currentTarget;

        switch(action) {
            case "open-document": {
                const uuid = targetElement.dataset.uuid;
                if (uuid) fromUuid(uuid).then(doc => doc?.sheet.render(true));
                break;
            }
            case "launch-wizard": {
                new TnxScenarioSettingWizard(this.object).render(true);
                break;
            }
            case "add-scene": {
                const phase = targetElement.dataset.phase;
                const scenes = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenes") || { opening: [], research: [], climax: [], ending: [] });
                if (!Array.isArray(scenes[phase])) scenes[phase] = [];
                const newScene = { id: foundry.utils.randomID(), number: "", name: "新規シーン", player: "", isMasterScene: false, switchMessage: "" };
                scenes[phase].push(newScene);
                this.object.setFlag("tokyo-nova-axleration", "scenes", scenes);
                break;
            }
            case "delete-scene": {
                const sceneItem = targetElement.closest('.scene-item');
                const sceneId = sceneItem.dataset.sceneId;
                const phase = sceneItem.dataset.phase;
                Dialog.confirm({
                    title: "シーンの削除", content: "<p>このシーンを削除しますか？</p>",
                    yes: () => {
                        const scenes = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenes"));
                        if (scenes[phase]) scenes[phase] = scenes[phase].filter(s => s.id !== sceneId);
                        this.object.setFlag("tokyo-nova-axleration", "scenes", scenes);
                    },
                    defaultYes: false
                });
                break;
            }
            case "switch-scene": {
                const sceneItem = targetElement.closest('.scene-item');
                const sceneId = sceneItem.dataset.sceneId;
                const phase = sceneItem.dataset.phase;
                const scenes = this.object.getFlag("tokyo-nova-axleration", "scenes");
                const scene = scenes[phase]?.find(s => s.id === sceneId);
                if (scene) {
                    const sceneTitle = `<h2>SCENE ${scene.number || '??'} : ${scene.name || '無題のシーン'}</h2>`;
                    let sceneDetails = scene.isMasterScene ? `<p>マスターシーン</p>` : (scene.player ? `<p><strong>シーンプレイヤー:</strong> ${scene.player}</p>` : '');
                    let customMessage = scene.switchMessage ? `<hr>${scene.switchMessage}` : '';
                    const chatContent = sceneTitle + sceneDetails + customMessage;
                    if (chatContent) ChatMessage.create({ content: chatContent });
                    await this.object.setFlag("tokyo-nova-axleration", "currentState", { phase, sceneId });
                    ui.notifications.info(`シーン「${scene.name}」に切り替えました。`);
                }
                break;
            }
            case "add-text-item":
                await this._addTextItem();
                break;
            case "delete-text-item": {
                const textItemId = targetElement.closest('.text-item').dataset.id;
                await this._deleteTextItem(textItemId);
                break;
            }
            case "send-text-to-chat": {
                const textItemId = targetElement.closest('.text-item').dataset.id;
                await this._sendTextToChat(textItemId);
                break;
            }
            case "add-info-item":
                await this._addInfoItem();
                break;
            case "delete-info-item": {
                const infoItemId = targetElement.dataset.infoId;
                await this._deleteInfoItem(infoItemId);
                break;
            }
            case "send-info-to-chat": {
                const infoItemId = targetElement.dataset.infoId;
                await this._sendInfoToChat(infoItemId);
                break;
            }
            case "add-info-content": {
                const infoItemId = targetElement.dataset.infoId;
                await this._addInfoContent(infoItemId);
                break;
            }
            case "delete-info-content": {
                const { infoId, contentId } = targetElement.dataset;
                await this._deleteInfoContent(infoId, contentId);
                break;
            }
            case "add-skill-check": {
                const { infoId, contentId } = targetElement.dataset;
                await this._addSkillCheck(infoId, contentId);
                break;
            }
            case "delete-skill-check": {
                const { infoId, contentId, skillId } = targetElement.dataset;
                await this._deleteSkillCheck(infoId, contentId, skillId);
                break;
            }
            case "send-trailer-to-chat":
                await this._sendTrailerToChat();
                break;
            case "add-handout":
                await this._addHandout();
                break;
            case "delete-handout": {
                const id = targetElement.closest('.handout-item').dataset.id;
                await this._deleteHandout(id);
                break;
            }
            case "send-handout-to-chat": {
                const id = targetElement.closest('.handout-item').dataset.id;
                await this._sendHandoutToChat(id);
                break;
            }
            case "reset-access-cards": {
                await this._onResetAccessCards();
                break;
            }
            case "deal-initial-hands": {
                await TnxActionHandler.dealInitialHands();
                break;
            }
            case "deal-trump-from-neuro": {
                await TnxActionHandler.dealTrumpFromNeuroDeck();
                break;
            }
        }
    }

    async _addHandout() {
        const handouts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "handouts") || []);
        const newHandout = {
            id: foundry.utils.randomID(),
            pcName: `PC${handouts.length + 1}`,
            title: `ハンドアウト ${handouts.length + 1}`,
            connections: "",
            recommendedSuit: "",
            recommendedStyle: "",
            content: "",
            ps: ""
        };
        handouts.push(newHandout);
        await this.object.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    async _deleteHandout(id) {
        if (await Dialog.confirm({ title: "ハンドアウトの削除", content: "<p>このハンドアウトを削除しますか？</p>", defaultYes: false })) {
            let handouts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "handouts") || []);
            handouts = handouts.filter(h => h.id !== id);
            await this.object.setFlag("tokyo-nova-axleration", "handouts", handouts);
        }
    }

    async _sendTrailerToChat() {
        const trailer = this.object.getFlag("tokyo-nova-axleration", "trailer");
        if (trailer) {
            ChatMessage.create({ content: `<h3>シナリオトレーラー</h3><hr>${trailer}` });
        } else {
            ui.notifications.warn("トレーラーが入力されていません。");
        }
    }

    async _sendHandoutToChat(id) {
        const handouts = this.object.getFlag("tokyo-nova-axleration", "handouts") || [];
        const handout = handouts.find(h => h.id === id);
        if (handout) {
            let chatContent = `<h3>${handout.title} (${handout.pcName})</h3>`;
            
            let details = '';
            if (handout.connections) details += `<p><strong>コネ:</strong> ${handout.connections}</p>`;
            if (handout.recommendedSuit) details += `<p><strong>推奨スート:</strong> ${handout.recommendedSuit}</p>`;
            if (handout.recommendedStyle) details += `<p><strong>推奨スタイル:</strong> ${handout.recommendedStyle}</p>`;
            if (details) chatContent += details;

            chatContent += `<hr>${handout.content}`;
            
            if (handout.ps) {
                chatContent += `<hr><h4>PS</h4><p>${handout.ps}</p>`;
            }
            ChatMessage.create({ content: chatContent });
        }
    }

    async _onTextItemChange(event) {
        const input = event.currentTarget;
        const textItemEl = input.closest('.text-item');
        const id = textItemEl.dataset.id;
        const name = input.name;
        const value = input.value;
        const texts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        const textItem = texts.find(t => t.id === id);
        if (textItem) {
            textItem[name] = value;
            await this.object.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
        }
    }
    async _addTextItem() {
        const texts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        texts.push({ id: foundry.utils.randomID(), title: "新規テキスト", content: "" });
        await this.object.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
    }
    async _deleteTextItem(id) {
        if (await Dialog.confirm({ title: "テキストの削除", content: "<p>このテキスト項目を削除しますか？</p>", defaultYes: false })) {
            let texts = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
            texts = texts.filter(t => t.id !== id);
            await this.object.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
        }
    }
    async _sendTextToChat(id) {
        const texts = this.object.getFlag("tokyo-nova-axleration", "scenarioTexts") || [];
        const textItem = texts.find(t => t.id === id);
        if (textItem?.content) ChatMessage.create({ content: textItem.content });
        else ui.notifications.warn("送信するテキストがありません。");
    }

    async _onInfoItemChange(event) {
        const input = event.currentTarget;
        const { infoId, contentId, skillId } = input.dataset;
        const name = input.name;
        const value = input.type === "checkbox" ? input.checked : (input.type === "number" ? parseInt(input.value) : input.value);

        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;

        if (contentId && skillId) {
            const content = item.contents.find(c => c.id === contentId);
            const skill = content?.skills.find(s => s.id === skillId);
            if (skill) skill[name] = value;
        } else if (contentId) {
            const content = item.contents.find(c => c.id === contentId);
            if (content) content[name] = value;
        } else {
            item[name] = value;
        }
        
        await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    async _addInfoItem() {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const newItem = {
            id: foundry.utils.randomID(),
            title: "新規情報",
            isPublic: false, // この行を追加
            contents: [
                {
                    id: foundry.utils.randomID(),
                    text: "",
                    isDisclosed: false,
                    skills: [
                        { id: foundry.utils.randomID(), name: "", tn: null }
                    ]
                }
            ]
        };
        items.push(newItem);
        await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    async _deleteInfoItem(id) {
        if (await Dialog.confirm({ title: "情報の削除", content: "<p>この情報項目全体を削除しますか？</p>", defaultYes: false })) {
            let items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
            items = items.filter(i => i.id !== id);
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }

    async _addInfoContent(infoId) {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (item) {
            if (!Array.isArray(item.contents)) item.contents = [];
            item.contents.push({
                id: foundry.utils.randomID(),
                text: "",
                isDisclosed: false,
                skills: [
                    { id: foundry.utils.randomID(), name: "", tn: null }
                ]
            });
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }

    async _deleteInfoContent(infoId, contentId) {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (item) {
            item.contents = item.contents.filter(c => c.id !== contentId);
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }

    async _addSkillCheck(infoId, contentId) {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        const content = item?.contents.find(c => c.id === contentId);
        if (content) {
            content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }

    async _deleteSkillCheck(infoId, contentId, skillId) {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        const content = item?.contents.find(c => c.id === contentId);
        if (content) {
            content.skills = content.skills.filter(s => s.id !== skillId);
            if (content.skills.length === 0) {
                content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
            }
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }

    async _sendInfoToChat(id) {
        const items = this.object.getFlag("tokyo-nova-axleration", "infoItems") || [];
        const item = items.find(i => i.id === id);
        if (!item || !item.contents) return;

        let chatContent = `<h3>${item.title}</h3>`;
        const disclosedContents = item.contents.filter(c => c.isDisclosed);

        if (disclosedContents.length > 0) {
            let contentAdded = false;
            for (const content of disclosedContents) {
                if (contentAdded) chatContent += "<hr>";
                const skillsByTn = content.skills.reduce((acc, skill) => {
                    if (skill.name && skill.tn) {
                        acc[skill.tn] = acc[skill.tn] || [];
                        acc[skill.tn].push(skill.name);
                    }
                    return acc;
                }, {});
                const skillsHtml = Object.entries(skillsByTn).map(([tn, names]) => `<strong>${names.join(" / ")} &gt; ${tn}</strong>`).join("<br>");
                if (skillsHtml) chatContent += `<p>${skillsHtml}</p>`;
                if (content.text) chatContent += `<p>${content.text}</p>`;
                contentAdded = true;
            }
            ChatMessage.create({ content: chatContent });
            ui.notifications.info(`情報「${item.title}」の公開済み内容を送信しました。`);
        } else {
            let contentAdded = false;
            for (const content of item.contents) {
                const skillsByTn = content.skills.reduce((acc, skill) => {
                    if (skill.name && skill.tn) {
                        acc[skill.tn] = acc[skill.tn] || [];
                        acc[skill.tn].push(skill.name);
                    }
                    return acc;
                }, {});
                const skillsHtml = Object.entries(skillsByTn).map(([tn, names]) => `<strong>${names.join(" / ")} &gt; ${tn}</strong>`).join("<br>");
                if (skillsHtml) {
                    if (contentAdded) chatContent += "<hr>";
                    chatContent += `<p>${skillsHtml}</p>`;
                    contentAdded = true;
                }
            }
            if (contentAdded) {
                ChatMessage.create({ content: chatContent });
                ui.notifications.info(`情報「${item.title}」の目標値情報を送信しました。`);
            } else {
                ui.notifications.warn("送信できる技能・目標値がありません。");
            }
        }
    }
    
    _activateContextMenu(html) {
        const sheet = this;
        new ContextMenu(html, ".tnx-linked-button", [{
            name: "リンクを解除", icon: '<i class="fas fa-unlink"></i>',
            condition: $li => $li.data("uuid"), 
            callback: async header => {
                const button = header[0];
                const uuid = button.dataset.uuid;
                const slot = button.closest('[data-drop-area]');
                if (!slot) return;
                const dropAreaName = slot.dataset.dropArea;
                const flagKey = `${dropAreaName}Id`;
                const linkedDoc = await fromUuid(uuid);
                if (!linkedDoc) {
                    ui.notifications.warn("リンク先のドキュメントが見つかりませんでした。");
                    await sheet.object.update({ [`flags.tokyo-nova-axleration.-=${flagKey}`]: null });
                    return sheet.render(true);
                }
                const choice = await UnlinkConfirmDialog.prompt({ linkedDoc });
                if (choice === "unlink" || choice === "delete") {
                    await sheet.object.update({ [`flags.tokyo-nova-axleration.-=${flagKey}`]: null });
                    ui.notifications.info(`「${linkedDoc.name}」とのリンクを解除しました。`);
                    if (choice === "delete") {
                        await linkedDoc.delete();
                        ui.notifications.info(`「${linkedDoc.name}」を削除しました。`);
                    }
                    sheet.render(true);
                }
            }
        }]);
    }

    async _onDrop(event) {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch (err) { return false; }
        if (data.type !== "Cards" || !data.uuid) return;
        const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;
        if (!dropArea) return;
        const droppedDoc = await fromUuid(data.uuid);
        if (!droppedDoc) return;
        const flagKey = `${dropArea}Id`;
        await this.object.setFlag("tokyo-nova-axleration", flagKey, droppedDoc.uuid);
        this.render(true);
        ui.notifications.info(`「${droppedDoc.name}」が${dropArea}としてリンクされました。`);
    }

    async _onResetAccessCards() {
        // 1. シナリオに設定されたRL切り札捨て場を取得
        const gmTrumpDiscardId = this.object.getFlag("tokyo-nova-axleration", "gmTrumpDiscardId");
        if (!gmTrumpDiscardId) {
            return ui.notifications.warn("RL切り札捨て場がこのシナリオに設定されていません。");
        }
        const gmTrumpDiscard = await fromUuid(gmTrumpDiscardId);
        if (!gmTrumpDiscard) {
            return ui.notifications.error("設定されているRL切り札捨て場が見つかりませんでした。");
        }

        // 2. GMユーザーとその切り札置き場（手札）を取得
        const gm = game.users.find(u => u.isGM);
        if (!gm) {
            return ui.notifications.warn("GMユーザーが見つかりません。");
        }
        const gmTrumpPileId = gm.getFlag("tokyo-nova-axleration", "trumpPileId");
        if (!gmTrumpPileId) {
            return ui.notifications.warn("GMのユーザー設定に切り札が設定されていません。");
        }
        const gmTrumpPile = await fromUuid(gmTrumpPileId);
        if (!gmTrumpPile) {
            return ui.notifications.error("設定されているGMの切り札が見つかりませんでした。");
        }

        // 3. 捨て場から「切り札」という名前のカードを探す
        const trumpCard = gmTrumpDiscard.cards.find(c => c.name === "切り札");
        if (!trumpCard) {
            return ui.notifications.info("RL切り札捨て場に「切り札」カードはありません。リセットの必要はありません。");
        }
        
        // 4. RLの切り札置き場が空か確認
        if (gmTrumpPile.cards.size > 0) {
            return ui.notifications.warn("RLの切り札には既にカードがあるため、再配布できませんでした。");
        }

        // 5. カードを移動
        await gmTrumpDiscard.pass(gmTrumpPile, [trumpCard.id]);

        // 6. ユーザーに通知
        ui.notifications.info("「切り札」をRLの切り札に再配布しました。");
    }

    /**
     * 情報項目全体の公開/非公開を切り替える
     * @param {string} infoId 対象の情報項目のID
     * @private
     */
    async _toggleInfoPublic(infoId) {
        const items = foundry.utils.deepClone(this.object.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (item) {
            item.isPublic = !(item.isPublic || false);
            await this.object.setFlag("tokyo-nova-axleration", "infoItems", items);
        }
    }
}