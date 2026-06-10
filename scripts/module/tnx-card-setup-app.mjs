import { createDefaultDeckData } from './tnx-playing-cards.mjs';
import { createNeuroDeckData } from './tnx-neuro-cards.mjs';
import { createAccessCardsData } from './tnx-access-cards.mjs';
import { saveUserFlagCards, getUserFlagData } from './user-flag-schema.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const SCOPE = "tokyo-nova-axleration";

export class TnxCardSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-card-setup",
        tag: "form",
        classes: [ "application", "tokyo-nova", "standard-form"],
        position: { width: 620, height: 520 },
        window: { title: "カードをセットアップ", icon: "fas fa-cards" },
        form: {
            handler: TnxCardSetupApp._onSubmitForm,
            submitOnChange: false,
            closeOnSubmit: false,
        },
        actions: {
            switchTab:           TnxCardSetupApp._onSwitchTab,
            increment:           TnxCardSetupApp._onIncrement,
            decrement:           TnxCardSetupApp._onDecrement,
            // 山札タブ
            createCardDeck:      TnxCardSetupApp._onCreateCardDeck,
            createDiscardPile:   TnxCardSetupApp._onCreateDiscardPile,
            // 手札タブ
            createUserHand:      TnxCardSetupApp._onCreateUserHand,
            createAllUserHands:  TnxCardSetupApp._onCreateAllUserHands,
            clearUserHand:       TnxCardSetupApp._onClearUserHand,
            // 切り札タブ
            createGmTrumpDiscard: TnxCardSetupApp._onCreateGmTrumpDiscard,
            createUserTrump:     TnxCardSetupApp._onCreateUserTrump,
            createAllUserTrumps: TnxCardSetupApp._onCreateAllUserTrumps,
            clearUserTrump:      TnxCardSetupApp._onClearUserTrump,
            // その他タブ
            createNeuroDeck:     TnxCardSetupApp._onCreateNeuroDeck,
            createScenePile:     TnxCardSetupApp._onCreateScenePile,
            createAccessCards:   TnxCardSetupApp._onCreateAccessCards,
            // 共通
            clearSetting:        TnxCardSetupApp._onClearSetting,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/parts/card-setup-app.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        const settings = {
            cardDeckId:       game.settings.get(SCOPE, "cardDeckId"),
            discardPileId:    game.settings.get(SCOPE, "discardPileId"),
            neuroDeckId:      game.settings.get(SCOPE, "neuroDeckId"),
            scenePileId:      game.settings.get(SCOPE, "scenePileId"),
            accessCardPileId: game.settings.get(SCOPE, "accessCardPileId"),
            gmTrumpDiscardId: game.settings.get(SCOPE, "gmTrumpDiscardId"),
        };

        const decks = game.cards.filter(c => c.type === 'deck').map(c => ({ uuid: c.uuid, name: c.name }));
        const piles = game.cards.filter(c => c.type === 'pile').map(c => ({ uuid: c.uuid, name: c.name }));
        const pilesAndHands = game.cards.filter(c => c.type === 'pile' || c.type === 'hand').map(c => ({ uuid: c.uuid, name: c.name }));

        context.cardDeckOptions   = decks.map(d => ({ uuid: d.uuid, name: d.name, selected: d.uuid === settings.cardDeckId }));
        context.discardOptions    = piles.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === settings.discardPileId }));
        context.neuroDeckOptions  = decks.map(d => ({ uuid: d.uuid, name: d.name, selected: d.uuid === settings.neuroDeckId }));
        context.scenePileOptions  = piles.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === settings.scenePileId }));
        context.accessCardOptions = piles.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === settings.accessCardPileId }));
        context.gmTrumpOptions    = piles.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === settings.gmTrumpDiscardId }));

        context.users = game.users.map(u => {
            const flags = getUserFlagData(u);
            return {
                id: u.id,
                name: u.name,
                isGM: u.isGM,
                handOptions:  pilesAndHands.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === flags.handPileId })),
                trumpOptions: pilesAndHands.map(p => ({ uuid: p.uuid, name: p.name, selected: p.uuid === flags.trumpCardPileId })),
            };
        });

        return context;
    }

    // ─── タブ切り替え（再レンダリングなし） ───────────────────────────────────

    static _onSwitchTab(_event, target) {
        const tabId = target.dataset.tab;
        this.element.querySelectorAll(".tnx-setup-tab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tab === tabId);
        });
        this.element.querySelectorAll(".tnx-tab-content").forEach(content => {
            content.classList.toggle("tnx-hidden", content.dataset.tab !== tabId);
        });
    }

    // ─── スピナー ────────────────────────────────────────────────────────────

    static _onIncrement(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
        if (!input) return;
        let v = parseInt(input.value, 10);
        if (isNaN(v)) v = parseInt(input.min, 10) || 1;
        const max = parseInt(input.max, 10);
        input.value = isNaN(max) ? v + 1 : Math.min(v + 1, max);
    }

    static _onDecrement(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
        if (!input) return;
        let v = parseInt(input.value, 10);
        if (isNaN(v)) v = parseInt(input.min, 10) || 1;
        const min = parseInt(input.min, 10);
        input.value = isNaN(min) ? v - 1 : Math.max(v - 1, min);
    }

    // ─── 山札タブ ────────────────────────────────────────────────────────────

    static async _onCreateCardDeck(_event, _target) {
        const deckCountInput = this.element.querySelector('input[name="deckCount"]');
        const deckCount = Math.max(1, parseInt(deckCountInput?.value) || 2);
        const backImg = "systems/tokyo-nova-axleration/assets/cards/playing-cards/back.png";
        const deck = await Cards.create({
            name: "山札", type: 'deck',
            cards: createDefaultDeckData(deckCount),
            img: backImg, back: { img: backImg },
        });
        await deck.shuffle({ chatNotification: false });
        await game.settings.set(SCOPE, "cardDeckId", deck.uuid);
        ui.notifications.info(`山札「${deck.name}」を作成しました。`);
        this.render();
    }

    static async _onCreateDiscardPile() {
        const pile = await Cards.create({
            name: "捨て札", type: 'pile',
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        });
        await game.settings.set(SCOPE, "discardPileId", pile.uuid);
        ui.notifications.info(`捨て札「${pile.name}」を作成しました。`);
        this.render();
    }

    // ─── 手札タブ ────────────────────────────────────────────────────────────

    static async _onCreateUserHand(_event, target) {
        const userId = target.closest("[data-user-id]")?.dataset.userId;
        const user = game.users.get(userId);
        if (!user) return;
        const hand = await TnxCardSetupApp._makeHandPile(user);
        const current = getUserFlagData(user);
        await saveUserFlagCards(user, hand.uuid, current.trumpCardPileId);
        ui.notifications.info(`「${user.name}」の手札を作成しました。`);
        this.render();
    }

    static async _onCreateAllUserHands() {
        for (const user of game.users) {
            const hand = await TnxCardSetupApp._makeHandPile(user);
            const current = getUserFlagData(user);
            await saveUserFlagCards(user, hand.uuid, current.trumpCardPileId);
        }
        ui.notifications.info(`全ユーザーの手札を作成しました。`);
        this.render();
    }

    static async _onClearUserHand(_event, target) {
        const userId = target.closest("[data-user-id]")?.dataset.userId;
        const user = game.users.get(userId);
        if (!user) return;
        const current = getUserFlagData(user);
        await saveUserFlagCards(user, "", current.trumpCardPileId);
        this.render();
    }

    // ─── 切り札タブ ──────────────────────────────────────────────────────────

    static async _onCreateGmTrumpDiscard() {
        const gm = game.users.find(u => u.isGM);
        if (!gm) return ui.notifications.warn("GMが存在しません。");
        const pile = await Cards.create({
            name: `${gm.name}の切り札(使用済)`, type: 'pile',
            ownership: { [gm.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        });
        await game.settings.set(SCOPE, "gmTrumpDiscardId", pile.uuid);
        ui.notifications.info(`RL切り札捨て場「${pile.name}」を作成しました。`);
        this.render();
    }

    static async _onCreateUserTrump(_event, target) {
        const userId = target.closest("[data-user-id]")?.dataset.userId;
        const user = game.users.get(userId);
        if (!user) return;
        const trump = await TnxCardSetupApp._makeTrumpPile(user);
        const current = getUserFlagData(user);
        await saveUserFlagCards(user, current.handPileId, trump.uuid);
        ui.notifications.info(`「${user.name}」の切り札置き場を作成しました。`);
        this.render();
    }

    static async _onCreateAllUserTrumps() {
        for (const user of game.users) {
            const trump = await TnxCardSetupApp._makeTrumpPile(user);
            const current = getUserFlagData(user);
            await saveUserFlagCards(user, current.handPileId, trump.uuid);
        }
        ui.notifications.info(`全ユーザーの切り札置き場を作成しました。`);
        this.render();
    }

    static async _onClearUserTrump(_event, target) {
        const userId = target.closest("[data-user-id]")?.dataset.userId;
        const user = game.users.get(userId);
        if (!user) return;
        const current = getUserFlagData(user);
        await saveUserFlagCards(user, current.handPileId, "");
        this.render();
    }

    // ─── その他タブ ──────────────────────────────────────────────────────────

    static async _onCreateNeuroDeck() {
        const backImg = "systems/tokyo-nova-axleration/assets/cards/neuro-cards/back.png";
        const deck = await Cards.create({
            name: "ニューロデッキ", type: 'deck',
            cards: createNeuroDeckData(), img: backImg, back: { img: backImg },
        });
        await deck.shuffle({ chatNotification: false });
        await game.settings.set(SCOPE, "neuroDeckId", deck.uuid);
        ui.notifications.info(`ニューロデッキ「${deck.name}」を作成しました。`);
        this.render();
    }

    static async _onCreateScenePile() {
        const pile = await Cards.create({
            name: "シーンカード", type: 'pile',
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        });
        await game.settings.set(SCOPE, "scenePileId", pile.uuid);
        ui.notifications.info(`シーンカード置き場「${pile.name}」を作成しました。`);
        this.render();
    }

    static async _onCreateAccessCards() {
        const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
        const backImg = "systems/tokyo-nova-axleration/assets/cards/access-cards/back.png";
        const deck = await Cards.create({
            name: "アクセスカード山", type: 'deck',
            cards: createAccessCardsData(), img: backImg, back: { img: backImg },
        });
        const pile = await Cards.create({ name: "アクセスカード置き場", type: 'pile', ownership });
        await deck.pass(pile, deck.cards.map(c => c.id), { chatNotification: false });

        const gm = game.users.find(u => u.isGM);
        if (gm) {
            const gmTrumpPileId = getUserFlagData(gm).trumpCardPileId;
            if (gmTrumpPileId) {
                const gmTrumpPile = await fromUuid(gmTrumpPileId);
                const trumpCard = pile.cards.find(c => c.name === "切り札");
                if (trumpCard && gmTrumpPile) {
                    await pile.pass(gmTrumpPile, [trumpCard.id], { chatNotification: false });
                    ui.notifications.info("「切り札」をRLの切り札置き場に配布しました。");
                }
            }
        }

        await game.settings.set(SCOPE, "accessCardPileId", pile.uuid);
        ui.notifications.info(`アクセスカード置き場「${pile.name}」を作成しました。`);
        this.render();
    }

    // ─── 共通ヘルパー ────────────────────────────────────────────────────────

    static async _makeHandPile(user) {
        const ownership = TnxCardSetupApp._makeOwnership(user);
        return Cards.create({
            name: `${user.name}の手札`, type: "hand",
            description: `「${user.name}」の手札です。`,
            img: "icons/svg/card-hand.svg", ownership,
        });
    }

    static async _makeTrumpPile(user) {
        const ownership = TnxCardSetupApp._makeOwnership(user);
        return Cards.create({
            name: `${user.name}の切り札`, type: "pile",
            description: `「${user.name}」の切り札置き場です。`,
            img: "icons/svg/card-hand.svg", ownership,
            flags: { [SCOPE]: { isTrumpPile: true } },
        });
    }

    static _makeOwnership(user) {
        const gm = game.users.find(u => u.isGM);
        const ownership = {
            default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
            [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        };
        if (gm && gm.id !== user.id) {
            ownership[gm.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        }
        return ownership;
    }

    // ─── クリア / 保存 ────────────────────────────────────────────────────────

    static async _onClearSetting(_event, target) {
        const key = target.dataset.setting;
        if (key) await game.settings.set(SCOPE, key, "");
        this.render();
    }

    static async _onSubmitForm(_event, _form, formData) {
        const data = formData.object;

        const settingKeys = ["cardDeckId", "discardPileId", "neuroDeckId", "scenePileId", "accessCardPileId", "gmTrumpDiscardId"];
        for (const key of settingKeys) {
            await game.settings.set(SCOPE, key, data[key] ?? "");
        }

        for (const user of game.users) {
            const newHandId  = data[`hand-${user.id}`]  ?? "";
            const newTrumpId = data[`trump-${user.id}`] ?? "";
            const current = getUserFlagData(user);
            if (newHandId !== current.handPileId || newTrumpId !== current.trumpCardPileId) {
                await saveUserFlagCards(user, newHandId, newTrumpId);
            }
        }

        ui.notifications.info("カード設定を保存しました。");
        this.render();
    }
}
