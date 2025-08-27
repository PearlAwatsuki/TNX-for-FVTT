import { createDefaultDeckData } from './tnx-playing-cards.mjs';
import { createNeuroDeckData } from './tnx-neuro-cards.mjs';
import { createAccessCardsData } from './tnx-access-cards.mjs';
import { TnxActionHandler } from './tnx-action-handler.mjs';

export class TnxScenarioSettingWizard extends FormApplication {

    constructor(journal, options = {}) {
        super(journal, options);
        this.journal = this.object;
        this.step = 1;
        this.formData = {};
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "tnx-scenario-wizard",
            classes: ["tokyo-nova", "dialog"],
            template: "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs",
            width: 500,
            height: "auto",
            title: "シナリオ・セットアップウィザード",
            resizable: true
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.step = this.step;
        context.journalName = this.journal.name;
        // formDataをテンプレートに渡して、ステップ3での条件付き表示に利用
        context.formData = this.formData;
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('.wizard-next').on('click', this._onNextStep.bind(this));
        html.find('.wizard-back').on('click', this._onPreviousStep.bind(this));
        html.find('.number-input-spinner button').on('click', event => {
            const button = event.currentTarget;
            const action = button.dataset.action;
            const input = button.parentElement.querySelector('input[type="number"]');
            if (!input) return;
            let value = parseInt(input.value, 10);
            const min = parseInt(input.min, 10);
            if (isNaN(value)) value = 0;
            if (action === 'increment') value++;
            else if (action === 'decrement') value--;
            if (!isNaN(min) && value < min) value = min;
            input.value = value;
        });
    }

    _onNextStep(event) {
        event.preventDefault();
        const form = this.element.find("form")[0];
        const data = new FormDataExtended(form).object;
        foundry.utils.mergeObject(this.formData, data);

        this.step++;

        // ステップ2から次に進む際、ステップ3（詳細設定）が必要か判定
        if (this.step === 3) {
            const needsDeckCustomization = this.formData.createcardDeck || this.formData.createNeuroDeck;
            if (!needsDeckCustomization) {
                this.step++; // 不要ならステップ3をスキップしてステップ4へ
            }
        }
        
        this.render(true);
    }

    _onPreviousStep(event) {
        event.preventDefault();
        this.step--;

        // ステップ4から戻る際、ステップ3（詳細設定）をスキップすべきか判定
        if (this.step === 3) {
            const needsDeckCustomization = this.formData.createcardDeck || this.formData.createNeuroDeck;
            if (!needsDeckCustomization) {
                this.step--; // 不要ならステップ3をスキップしてステップ2へ
            }
        }
        this.render(true);
    }

    async _updateObject(event, formData) {
        foundry.utils.mergeObject(this.formData, formData);
        const allData = this.formData;
        let accessCardDeck, accessCardPile, gmTrumpPile, gmTrumpDiscard;
        ui.notifications.info("シナリオのセットアップを開始します...");

        if (allData.journalName && this.journal.name !== allData.journalName) {
            await this.journal.update({ name: allData.journalName });
        }
        const updates = {};
        const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };

        if (allData.createcardDeck) {
            const backImagePath = "systems/tokyo-nova-axleration/assets/cards/playing-cards/back.png";
            const deckCount = parseInt(allData.deckCount) || 2; // デッキ数を反映
            const deck = await Cards.create({ name: `山札`, type: 'deck', cards: createDefaultDeckData(deckCount), img: backImagePath, back: { img: backImagePath } });
            if (allData.shuffleTrumpDeck) { // シャッフルするかを反映
                await deck.shuffle({chatNotification: false});
            }
            updates['flags.tokyo-nova-axleration.cardDeckId'] = deck.uuid;
        }
        if (allData.createDiscardPile) {
            const pile = await Cards.create({ name: `捨て札`, type: 'pile', ownership });
            updates['flags.tokyo-nova-axleration.discardPileId'] = pile.uuid;
        }
        if (allData.createNeuroDeck) {
            const backImagePath = "systems/tokyo-nova-axleration/assets/cards/neuro-cards/back.png";
            const deck = await Cards.create({ name: `ニューロデッキ`, type: 'deck', cards: createNeuroDeckData(), img: backImagePath, back: {img: backImagePath} });
            if (allData.shuffleNeuroDeck) { // シャッフルするかを反映
                await deck.shuffle({chatNotification: false});
            }
            updates['flags.tokyo-nova-axleration.neuroDeckId'] = deck.uuid;
        }
        if (allData.createScenePile) {
            const pile = await Cards.create({ name: `シーンカード`, type: 'pile', ownership });
            updates['flags.tokyo-nova-axleration.scenePileId'] = pile.uuid;
        }
        if (allData.createAccesscardDeck) {
            const backImagePath = "systems/tokyo-nova-axleration/assets/cards/access-cards/back.png";
            accessCardDeck = await Cards.create({ name: `アクセスカード山`, type: 'deck', cards: createAccessCardsData(), img: backImagePath, back: {img: backImagePath} });
        }
        if (allData.createAccessCardPile) {
            accessCardPile = await Cards.create({ name: `アクセスカード置き場`, type: 'pile', ownership });
            updates['flags.tokyo-nova-axleration.accessCardPileId'] = accessCardPile.uuid;
        }
        
        const gm = game.users.find(u => u.isGM);
        if (gm) {
            if (allData.createGmHand) {
                await Cards.create({ name: `${gm.name}の手札`, type: 'hand', ownership: { [gm.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
            }
            if (allData.createGmTrumpPile) {
                gmTrumpPile = await Cards.create({ name: `${gm.name}の切り札`, type: 'pile', ownership: { [gm.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
            }
            if (allData.createGmTrumpDiscard) {
                gmTrumpDiscard = await Cards.create({ name: `${gm.name}の切り札(使用済)`, type: 'pile', ownership: { [gm.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
                updates['flags.tokyo-nova-axleration.gmTrumpDiscardId'] = gmTrumpDiscard.uuid;
            }
        }
        
        const sceneCounts = allData.sceneCounts || {};
        const scenes = { opening: [], research: [], climax: [], ending: [] };
        let sceneCounter = 1;
        for (const phase in scenes) {
            const count = parseInt(sceneCounts[phase]) || 0;
            for (let i = 0; i < count; i++) {
                scenes[phase].push({
                    id: foundry.utils.randomID(), number: sceneCounter++, name: `新規シーン ${i + 1}`,
                    player: "", isMasterScene: false,
                    switchMessage: `▼ ${phase.charAt(0).toUpperCase() + phase.slice(1)} SCENE`
                });
            }
        }
        updates['flags.tokyo-nova-axleration.scenes'] = scenes;
        updates['flags.tokyo-nova-axleration.currentState'] = { phase: 'opening', sceneId: scenes.opening[0]?.id || null };
        
        const pcCount = parseInt(allData.pcCount) || 4;
        const handouts = [];
        for (let i = 1; i <= pcCount; i++) {
            handouts.push({
                id: foundry.utils.randomID(), pcName: `PC${i}`, title: `ハンドアウト ${i}`,
                connections: "", recommendedSuit: "", recommendedStyle: "",
                content: "", ps: ""
            });
        }
        updates['flags.tokyo-nova-axleration.handouts'] = handouts;
        updates['flags.tokyo-nova-axleration.trailer'] = "";
        
        if (Object.keys(updates).length > 0) {
            await this.journal.update(updates);
        }
        
        if (accessCardDeck) {
            await accessCardDeck.reset({render: false}, {chatNotification: false});
            
            const trumpCard = accessCardDeck.cards.find(c => c.name === "切り札");
            if (trumpCard && gmTrumpPile) {
                await accessCardDeck.pass(gmTrumpPile, [trumpCard.id], {chatNotification: false});
                ui.notifications.info("「切り札」をRLの切り札に配布しました。");
            }
            
            if (accessCardPile) {
                const remainingCards = accessCardDeck.cards.filter(c => c.id !== trumpCard?.id);
                const remainingAvailableCards = remainingCards.filter(c => !c.drawn);
                const remainingAvailableCardIds = remainingAvailableCards.map(c => c.id);

                if (remainingAvailableCardIds.length > 0) {
                    await accessCardDeck.pass(accessCardPile, remainingAvailableCardIds, {chatNotification: false});
                    ui.notifications.info("残りのアクセスカードを置き場に配布しました。");
                }
            }
        }

        if (allData.dealInitialHands) {
            await TnxActionHandler.dealInitialHands();
        }
        
        ui.notifications.info("シナリオのセットアップが完了しました。");
        await this.journal.sheet.render(true);
        this.close();
    }
}