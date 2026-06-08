import { createDefaultDeckData } from './tnx-playing-cards.mjs';
import { createNeuroDeckData } from './tnx-neuro-cards.mjs';
import { createAccessCardsData } from './tnx-access-cards.mjs';
import { saveUserFlagCards, getUserFlagData } from './user-flag-schema.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxScenarioSettingWizard extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(journal, options = {}) {
        super(options);
        this.journal = journal;
        this.step = 1;
        this.formData = {};
    }

    static DEFAULT_OPTIONS = {
        id: "tnx-scenario-wizard",
        classes: ["tokyo-nova", "dialog"],
        position: { width: 500 },
        window: { title: "シナリオ・セットアップウィザード", resizable: true },
        actions: {
            nextStep: TnxScenarioSettingWizard._onNextStep,
            previousStep: TnxScenarioSettingWizard._onPreviousStep,
            increment: TnxScenarioSettingWizard._onIncrement,
            decrement: TnxScenarioSettingWizard._onDecrement,
            finishSetup: TnxScenarioSettingWizard._onFinishSetup,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.step = this.step;
        context.journalName = this.journal.name;
        context.formData = this.formData;
        return context;
    }

    static async _onNextStep(_event, _target) {
        const form = this.element.querySelector("form");
        const data = new FormDataExtended(form).object;
        foundry.utils.mergeObject(this.formData, data);

        this.step++;

        if (this.step === 3) {
            const needsDeckCustomization = this.formData.createcardDeck || this.formData.createNeuroDeck;
            if (!needsDeckCustomization) {
                this.step++;
            }
        }

        this.render();
    }

    static async _onPreviousStep(_event, _target) {
        this.step--;

        if (this.step === 3) {
            const needsDeckCustomization = this.formData.createcardDeck || this.formData.createNeuroDeck;
            if (!needsDeckCustomization) {
                this.step--;
            }
        }
        this.render();
    }

    static _onIncrement(event, target) {
        const input = target.parentElement.querySelector('input[type="number"]');
        if (!input) return;
        let value = parseInt(input.value, 10);
        const min = parseInt(input.min, 10);
        if (isNaN(value)) value = 0;
        value++;
        if (!isNaN(min) && value < min) value = min;
        input.value = value;
    }

    static _onDecrement(event, target) {
        const input = target.parentElement.querySelector('input[type="number"]');
        if (!input) return;
        let value = parseInt(input.value, 10);
        const min = parseInt(input.min, 10);
        if (isNaN(value)) value = 0;
        value--;
        if (!isNaN(min) && value < min) value = min;
        input.value = value;
    }

    static async _onFinishSetup(_event, _target) {
        const form = this.element.querySelector("form");
        const formData = new FormDataExtended(form).object;
        foundry.utils.mergeObject(this.formData, formData);
        await this._executeSetup();
    }

    async _executeSetup() {
        const allData = this.formData;
        let accessCardDeck, accessCardPile;
        ui.notifications.info("シナリオのセットアップを開始します...");

        if (allData.journalName && this.journal.name !== allData.journalName) {
            await this.journal.update({ name: allData.journalName });
        }
        const updates = {};
        const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };

        if (allData.createcardDeck) {
            const backImagePath = "systems/tokyo-nova-axleration/assets/cards/playing-cards/back.png";
            const deckCount = parseInt(allData.deckCount) || 2;
            const deck = await Cards.create({ name: `山札`, type: 'deck', cards: createDefaultDeckData(deckCount), img: backImagePath, back: { img: backImagePath } });
            if (allData.shuffleTrumpDeck) {
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
            if (allData.shuffleNeuroDeck) {
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
        if (gm && allData.createGmTrumpDiscard) {
            const gmTrumpDiscard = await Cards.create({ name: `${gm.name}の切り札(使用済)`, type: 'pile', ownership: { [gm.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
            updates['flags.tokyo-nova-axleration.gmTrumpDiscardId'] = gmTrumpDiscard.uuid;
        }

        if (allData.createUserHands) {
            let createdCount = 0;
            for (const user of game.users) {
                const handPileName = `${user.name}の手札`;
                const trumpPileName = `${user.name}の切り札`;

                const cardOwnership = {
                    default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
                    [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
                };

                if (user.id !== game.user.id) {
                    cardOwnership[game.user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
                }

                const handPile = await Cards.create({
                    name: handPileName,
                    type: "hand",
                    description: `「${user.name}」の手札です。`,
                    img: "icons/svg/card-hand.svg",
                    ownership: cardOwnership
                });

                const trumpPile = await Cards.create({
                    name: trumpPileName,
                    type: "pile",
                    description: `「${user.name}」の切り札置き場です。`,
                    img: "icons/svg/card-hand.svg",
                    ownership: cardOwnership,
                    flags: { "tokyo-nova-axleration": { isTrumpPile: true } }
                });

                if (handPile && trumpPile) {
                    await saveUserFlagCards(user, handPile.uuid, trumpPile.uuid);
                    createdCount++;
                }
            }
            ui.notifications.info(`全 ${createdCount} 人のユーザーに手札・切り札を作成しました。`);
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

        if (accessCardDeck && accessCardPile) {
            await accessCardDeck.pass(accessCardPile, accessCardDeck.cards.map(c => c.id), {chatNotification: false});

            const trumpCard = accessCardPile.cards.find(c => c.name === "切り札");

            let targetGmTrumpPile = null;
            if (gm) {
                const pileId = getUserFlagData(gm).trumpCardPileId;
                if (pileId) {
                    targetGmTrumpPile = await fromUuid(pileId);
                }
            }

            if (trumpCard) {
                if (targetGmTrumpPile) {
                    await accessCardPile.pass(targetGmTrumpPile, [trumpCard.id], {chatNotification: false});
                    ui.notifications.info("「切り札」をアクセスカード置き場からRLの切り札に配布しました。");
                } else {
                    ui.notifications.warn("RLに切り札置き場が存在しないため、「切り札」を配布できませんでした（カードは置き場に残ります）。");
                }
            } else {
                ui.notifications.info("アクセスカード置き場に全てのカードを配置しました。");
            }
        }

        ui.notifications.info("シナリオのセットアップが完了しました。");
        await this.journal.sheet.render({ force: true });
        this.close();
    }
}
