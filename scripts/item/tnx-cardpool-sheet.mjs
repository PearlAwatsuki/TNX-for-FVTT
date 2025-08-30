import { createDefaultDeckData } from '../module/tnx-playing-cards.mjs';
import { createNeuroDeckData } from '../module/tnx-neuro-cards.mjs';
import {
    DeckCreationDialog,
    AmountInputDialog,
    TargetSelectionDialog,
    DealTrumpDialog,
    UnlinkConfirmDialog
} from '../module/tnx-dialog.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';

export class TokyoNovaCardPoolSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "cardpool", "cardpool-sheet"],
            template: "systems/tokyo-nova-axleration/templates/item/cardpool-sheet.hbs",
            width: 550,
            height: 500,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "operations" }],
            dragDrop: [{ dragSelector: null, dropSelector: ".sheet-body" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = foundry.utils.deepClone(this.item.system || {});
        context.isGM = game.user.isGM;

        // リンクされたカード置き場の情報を取得
        await this._getLinkedCardsData(context);

        // カード置き場が存在すれば、モードに応じた操作パネルのデータを準備
        if (context.linkedCards) {
            context.operationData = this._getOperationData(context);
        }

        // 選択肢などのUIデータを準備
        this._getUIData(context);

        return context;
    }

    // ▼▼▼ 以下、getDataから分割されたヘルパーメソッド群 ▼▼▼

    /**
     * リンクされたカード置き場の情報を取得し、コンテキストに設定します。
     * @param {object} context - データコンテキストオブジェクト
     * @private
     */
    async _getLinkedCardsData(context) {
        context.linkedCards = null;
        if (context.system.linkedHandPileId) {
            try {
                const linkedDoc = await fromUuid(context.system.linkedHandPileId);
                if (linkedDoc && linkedDoc.documentName === "Cards") {
                    context.linkedCards = linkedDoc;
                } else if (this.isEditable) {
                    this.item.update({"system.linkedHandPileId": ""});
                }
            } catch (err) {
                console.error(`TokyoNOVA | Error fetching linked document for UUID ${context.system.linkedHandPileId}`, err);
            }
        }
    }

    /**
     * カードプールのモードに応じて、操作パネルの表示データを返します。
     * @param {object} context - データコンテキストオブジェクト
     * @returns {object} - 操作パネルのデータ
     * @private
     */
    _getOperationData(context) {
        const mode = context.system.mode;
        const linkedCards = context.linkedCards;

        switch (mode) {
            case 'deck':
            case 'neuro':
                return {
                    cardCount: linkedCards.availableCards.length,
                    backImage: linkedCards.back?.img || linkedCards.thumbnail || CONST.DEFAULT_TOKEN
                };
            case 'discard':
                const topDiscard = Array.from(linkedCards.cards.values()).pop();
                return {
                    cardCount: linkedCards.cards.size,
                    topCardImage: topDiscard?.face?.img || topDiscard?.faces[0]?.img || CONST.DEFAULT_TOKEN,
                    topCardName: topDiscard?.name,
                    topCardId: topDiscard?.id
                };
            case 'scene':
                const topSceneCard = Array.from(linkedCards.cards.values()).pop();
                if (topSceneCard) {
                    return {
                        cardName: topSceneCard.name,
                        cardImage: topSceneCard.face?.img || topSceneCard.faces[0]?.img || CONST.DEFAULT_TOKEN,
                        keyword: topSceneCard.faces[0]?.text || "（キーワードなし）",
                        implication: topSceneCard.description || "（暗示なし）"
                    };
                }
                return {};
            default:
                return {};
        }
    }

    /**
     * シートのUI（モード選択肢など）に関するデータを準備します。
     * @param {object} context - データコンテキストオブジェクト
     * @private
     */
    _getUIData(context) {
        const currentMode = context.system.mode;

        // モード選択肢
        const modeOptions = { 
            "deck": "TNX.CardPoolModeDeck", 
            "discard": "TNX.CardPoolModeDiscard",
            "neuro": "TNX.CardPoolModeNeuro",
            "scene": "TNX.CardPoolModeScene"
        };
        context.cardPoolModeOptions = Object.entries(modeOptions).map(([value, labelKey]) => ({
            value: value,
            label: game.i18n.localize(labelKey),
            selected: value === currentMode
        }));

        // 「新規作成してリンク」ボタンのテキスト
        const createActionLabels = {
            "deck": { label: "TNX.CreateAndLinkDeck", hint: "TNX.CreateAndLinkDeckHint" },
            "neuro": { label: "TNX.CreateAndLinkNeuroDeck", hint: "TNX.CreateAndLinkNeuroDeckHint" },
            "scene": { label: "TNX.CreateAndLinkScene", hint: "TNX.CreateAndLinkSceneHint" },
            "discard": { label: "TNX.CreateAndLinkDiscard", hint: "TNX.CreateAndLinkDiscardHint" }
        };
        context.createActionData = createActionLabels[currentMode] || createActionLabels.deck;
    }
    
    // ▲▲▲ ヘルパーメソッド群ここまで ▲▲▲

    /**
     * @param {Cards} hand - 更新された手札ドキュメント
     * @private
     */
    async _triggerActorSheetRefresh(hand) {
        if (!hand) return;
        const linkedActor = game.actors.find(a => a.type === "cast" && a.system.handPileId === hand.uuid);

        if (linkedActor) {
            // アクターシートに再描画を促すためのフラグを立てます
            await linkedActor.setFlag("tokyo-nova-axleration", "refreshSheet", true);
        }
    }
    
    /**
     * カードを引くリクエストをしたアクターを取得するヘルパー
     * @returns {Actor|null}
     * @private
     */
    _getRequestingActor() {
        let targetActor = game.user.character;
        if (!targetActor && canvas.ready) {
            const controlled = canvas.tokens.controlled;
            if (controlled.length === 1) targetActor = controlled[0].actor;
        }
        if (!targetActor) {
            ui.notifications.warn("カードを引くキャラクターを選択（またはユーザー設定で割り当て）してください。");
            return null;
        }
        return targetActor;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.on('click', '[data-action]', this._handleActionClick.bind(this));
        // html.on('click', '.linked-cards-button', this._onOpenLinkedCardsSheet.bind(this)); // ← この行を削除
        if (!this.isEditable) return;
    
        const menuItems = [
            { name: game.i18n.localize("SHEET.Open"), icon: '<i class="fas fa-external-link-alt"></i>', condition: () => !!this.item.system.linkedHandPileId, callback: () => fromUuid(this.item.system.linkedHandPileId).then(doc => doc?.sheet?.render(true))},
            { 
                name: game.i18n.localize("TNX.UnlinkCards"), 
                icon: '<i class="fas fa-unlink"></i>', 
                condition: () => !!this.item.system.linkedHandPileId, 
                callback: async () => {
                    const linkedUuid = this.item.system.linkedHandPileId;
                    if (!linkedUuid) return;
    
                    const linkedCards = await fromUuid(linkedUuid);
                    if (!linkedCards) { 
                        ui.notifications.warn("リンク先のカードドキュメントが見つかりませんでした。リンクをクリアします。"); 
                        return this.item.update({"system.linkedHandPileId": ""}); 
                    }
                    
                    // 汎用ダイアログを呼び出す
                    const choice = await UnlinkConfirmDialog.prompt({ linkedDoc: linkedCards });
    
                    // ダイアログの選択結果に応じて処理を実行
                    switch (choice) {
                        case 'delete':
                            await this.item.update({"system.linkedHandPileId": ""});
                            await linkedCards.delete();
                            ui.notifications.info(`カードスタック「${linkedCards.name}」を削除し、リンクを解除しました。`);
                            break;
                        case 'unlink':
                            await this.item.update({"system.linkedHandPileId": ""});
                            ui.notifications.info(`カードスタック「${linkedCards.name}」とのリンクを解除しました。`);
                            break;
                        default: // null or cancel
                            return;
                    }
                }
            }
        ];
        new ContextMenu(html, ".tnx-linked-button", menuItems);
    }

    _broadcastRefresh() {
        if (game.user.isGM) {
            game.socket.emit("system.tokyo-nova-axleration", { type: "refreshSheets" });
        }
    }
    
    async _onDrop(event) {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (err) { return false; }
        if (data?.type !== "Cards" || !data.uuid) return super._onDrop(event);
        const droppedDocument = await fromUuid(data.uuid);
        if (!droppedDocument) return false;
        const currentMode = this.item.system.mode;
        const droppedType = droppedDocument.type;
        const expectedTypes = { deck: "deck", discard: "pile", neuro: "deck", scene: "pile" };
        if (droppedType === expectedTypes[currentMode]) {
            await this.item.update({ "system.linkedHandPileId": data.uuid });
            ui.notifications.info(`カードスタック「${droppedDocument.name}」がリンクされました。`);
        } else {
            const modeLabel = game.i18n.localize(`TNX.CardPoolMode${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}`);
            const expectedTypeLabel = game.i18n.localize(`CARDS.Type${expectedTypes[currentMode].charAt(0).toUpperCase() + expectedTypes[currentMode].slice(1)}`);
            const droppedTypeLabel = game.i18n.localize(`CARDS.Type${droppedType.charAt(0).toUpperCase() + droppedType.slice(1)}`);
            ui.notifications.warn(`「${modeLabel}」モードには「${expectedTypeLabel}」タイプのカードスタックが必要です。ドロップされた「${droppedTypeLabel}」はリンクできません。`);
            return false;
        }
    }
    
    async _handleActionClick(event) {
        event.preventDefault();
        const action = event.currentTarget.dataset.action;
        
        if (['shuffle', 'deal-to-all', 'collect-all-cards', 'deal-trump-card'].includes(action) && !game.user.isGM) {
            ui.notifications.warn(game.i18n.localize("TNX.WarningGMOnlyAction"));
            return;
        }
    
        const requiresLinkedCard = ['shuffle', 'draw-card', 'deal-to-all', 'draw-specific-amount', 'take-from-discard', 'deal-trump-card'];
        if (requiresLinkedCard.includes(action) && !this.item.system.linkedHandPileId) {
            ui.notifications.warn("操作対象のカードスタックがリンクされていません。");
            return;
        }
        const actions = {
            'create-and-link-document': this._onCreateAndLinkDocument,
            'shuffle': this._onShuffleDeck,
            'draw-card': () => this._onDealCards(1),
            'deal-to-all': () => TnxActionHandler.dealToAll(this.item.id),
            'draw-specific-amount': this._onDrawSpecificAmount,
            'collect-all-cards': this._onCollectAllCards,
            'take-from-discard': this._onTakeFromDiscard,
            'deal-trump-card': this._onDealTrumpCard,
            'open-linked-sheet': this._onOpenLinkedCardsSheet
        };
        if (actions[action]) await actions[action].call(this, event);
    }
    
    async _onDrawSpecificAmount() {
        const deck = await this._getLinkedDeck();
        if (!deck) return;
    
        const amount = await AmountInputDialog.prompt({
            title: game.i18n.localize("TNX.SpecifyDrawAmount"),
            label: game.i18n.localize("TNX.DrawAmount"),
            initialValue: 1,
            min: 1,
            max: deck.availableCards.length
        });
    
        if (amount === null || amount <= 0) return;
    
        const actor = this._getRequestingActor();
        if (actor) {
            await TnxActionHandler.dealCardsToActor(this.item.id, actor.id, amount);
        }
    }
    
    async _getLinkedDeck() {
        const deck = await fromUuid(this.item.system.linkedHandPileId);
        if (!deck || deck.type !== 'deck') { 
            ui.notifications.error(game.i18n.localize("TNX.ErrorInvalidDeckLink")); 
            return null; 
        }
        return deck;
    }
    
    async _onShuffleDeck() {
        const deck = await this._getLinkedDeck();
        if (deck) { 
            await deck.shuffle({render: false}); 
            ui.notifications.info(game.i18n.format("TNX.InfoDeckShuffled", { deckName: deck.name })); 
            this.render(false);
            this._broadcastRefresh();
        }
    }

    async _onDealCards(amount = 1) {
        const deck = await this._getLinkedDeck();
        if (!deck) return;
    
        if (deck.availableCards.length < amount) {
            ui.notifications.warn(game.i18n.localize("TNX.WarningNotEnoughCards"));
            return;
        }
    
        // --- ニューロデッキモード ---
        if (this.item.system.mode === 'neuro') {
            await TnxActionHandler.dealNeuroToScene(deck.id, amount);
            return;
        }
    
        // --- 通常の山札モード ---
        const actor = this._getRequestingActor();
        if (actor) {
            // プレイヤーまたはキャラ選択中のGM
            await TnxActionHandler.dealCardsToActor(this.item.id, actor.id, amount);
        } else if (game.user.isGM) {
            // キャラ未選択のGMは、手動で手札を選択
            const ownedHands = game.cards.filter(c => c.type === "hand" && c.isOwner);
            if (ownedHands.length === 0) return ui.notifications.warn(game.i18n.localize("TNX.WarningNoOwnedHandFound"));
            
            let hand;
            if (ownedHands.length === 1) {
                hand = ownedHands[0];
            } else {
                const handId = await TargetSelectionDialog.prompt({
                    title: game.i18n.localize("TNX.SelectHandDialogTitle"),
                    label: game.i18n.localize("TNX.SelectHandDialogContent"),
                    options: ownedHands.map(h => ({ value: h.id, label: h.name })),
                    selectLabel: game.i18n.localize("TNX.Draw")
                });
                if (!handId) return;
                hand = game.cards.get(handId);
            }
            if (!hand) return;
            
            const targetActor = game.actors.find(a => a.system.handPileId === hand.uuid);
            if (!targetActor) return ui.notifications.warn(`手札「${hand.name}」に紐づくキャストが見つかりませんでした。`);

            await TnxActionHandler.dealCardsToActor(this.item.id, targetActor.id, amount);
        }
    }

    async _onDealToAll() {
        await TnxActionHandler.dealToAll(this.item.id, 4);
        this.render(false);
        this._broadcastRefresh();
    }

    async _onOpenLinkedCardsSheet(event) {
        event.preventDefault();
        if (this.item.system.linkedHandPileId) fromUuid(this.item.system.linkedHandPileId).then(doc => doc?.sheet?.render(true));
    }

    async _onCollectAllCards() {
        const deck = await this._getLinkedDeck();
        if (!deck) return;
        const currentMode = this.item.system.mode;
        const isNeuroMode = currentMode === 'neuro';
        const cardTypeToCollect = isNeuroMode ? 'neuroCards' : 'playingCards';
        const deckTypeName = isNeuroMode ? 'ニューロデッキ' : '山札';
    
        // 回収元の候補となるカードスタックをリストアップ
        let sourceStacks = [];
        
        // 1. ワールド内のすべてのカードドキュメントを追加
        sourceStacks.push(...game.cards.contents);
    
        // 2. ニューロモードの場合、全キャストの切り札置き場を追加
        if (isNeuroMode) {
            const trumpPileIds = game.actors.filter(a => a.type === 'cast' && a.system.trumpCardPileId).map(a => a.system.trumpCardPileId);
            const trumpPiles = (await Promise.all(trumpPileIds.map(uuid => fromUuid(uuid)))).filter(Boolean);
            sourceStacks.push(...trumpPiles);
        }
    
        // 重複を除外し、回収先デッキ自身は除外する
        const uniqueSourceStacks = [...new Set(sourceStacks)].filter(c => c.id !== deck.id && c.cards.size > 0);
    
        if (uniqueSourceStacks.length === 0) { 
            ui.notifications.info("回収対象となるカードを持つスタックがありません。");
            return;
        }
    
        const stackNames = uniqueSourceStacks.map(p => `「${p.name}」`).join('、');
        const confirmed = await Dialog.confirm({
            title: "全カードの回収確認",
            content: `<p>ワールド内に存在する以下のカードスタックから、全ての「${isNeuroMode ? 'タロット' : 'トランプ'}」カードを${deckTypeName}「${deck.name}」に回収します。</p><p style="margin-top: 10px;"><strong>回収元:</strong> ${stackNames}</p><p style="margin-top: 10px;">この操作は元に戻せません。よろしいですか？</p>`,
            defaultYes: false
        });
        if (!confirmed) return;
        
        ui.notifications.info(`カードを回収しています...`);
        for (const source of uniqueSourceStacks) {
            // 回収対象のカードタイプでフィルタリング
            const cardsToPass = source.cards.filter(c => c.type === cardTypeToCollect).map(c => c.id);
            if (cardsToPass.length > 0) {
                await source.pass(deck, cardsToPass, { render: false });
            }
            
            // 各種シートの更新トリガー
            if (source.type === "hand") {
                await this._triggerActorSheetRefresh(source);
            }
            const sourcePoolItem = game.items.find(i => i.type === 'cardpool' && i.system.linkedHandPileId === source.uuid);
            if (sourcePoolItem?.sheet?.rendered) {
                sourcePoolItem.sheet.render(true);
            }
            const ownerActor = game.actors.find(a => a.system.handPileId === source.uuid || a.system.trumpCardPileId === source.uuid);
            if (ownerActor?.sheet?.rendered) {
                ownerActor.sheet.render(true);
            }
        }
        ui.notifications.info(`全ての対象カードが${deckTypeName}「${deck.name}」に回収されました。`);
    
        this.render(false);
        this._broadcastRefresh();
    }

    async _onCreateAndLinkDocument() {
        if (this.item.system.linkedHandPileId) {
            const confirm = await Dialog.confirm({ title: "確認", content: "<p>既にカードスタックがリンクされています。新しいスタックを作成して上書きしますか？</p>", defaultYes: false });
            if (!confirm) return;
        }
        const currentMode = this.item.system.mode;
        let newCardsDocument = null;
        try {
            const ownership = { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
            if (currentMode === 'deck') {
                const creationOptions = await DeckCreationDialog.prompt();
                if (!creationOptions) return;
                const { deckCount, createFaceDown, shuffleDeck } = creationOptions;
                const defaultCards = createDefaultDeckData(deckCount, createFaceDown);
                const deckName = `${this.item.name}(${deckCount}デッキ分)`;
                const backImagePath = "systems/tokyo-nova-axleration/assets/cards/back.png";
                newCardsDocument = await Cards.create({
                    name: deckName, type: "deck", img: backImagePath,
                    back: { img: backImagePath }, cards: defaultCards,
                    ownership: ownership
                });
                if (newCardsDocument && shuffleDeck) await newCardsDocument.shuffle({render: false});
            } 
            else if (currentMode === 'neuro') {
                const neuroCards = createNeuroDeckData();
                const deckName = game.i18n.localize("TNX.DefaultNeuroPileName");;
                const backImagePath = "systems/tokyo-nova-axleration/assets/neuro-cards/neuro_back.png";
                newCardsDocument = await Cards.create({
                    name: deckName, type: "deck", img: backImagePath,
                    back: { img: backImagePath }, cards: neuroCards,
                    ownership: ownership
                });
                if (newCardsDocument) await newCardsDocument.shuffle({render: false});
            }
            else if (currentMode === 'scene') {
                const sceneName = game.i18n.localize("TNX.DefaultSceneCardPileName");
                newCardsDocument = await Cards.create({
                    name: sceneName, type: "pile", img: "icons/svg/card-hand.svg",
                    ownership: ownership
                });
            }
            else if (currentMode === 'discard') {
                const discardName = game.i18n.localize("TNX.DefaultDiscardPileName");
                newCardsDocument = await Cards.create({
                    name: discardName, type: "pile", img: "icons/svg/card-hand.svg",
                    ownership: ownership
                });
            }
    
            if (newCardsDocument) {
                await this.item.update({"system.linkedHandPileId": newCardsDocument.uuid});
                ui.notifications.info(`新規カードスタック「${newCardsDocument.name}」が作成され、リンクされました。`);
                this._broadcastRefresh();
            }
        } catch (err) {
            console.error(`TokyoNOVA | Failed to create and link document for mode "${currentMode}"`, err);
            ui.notifications.error("カードスタックの作成に失敗しました。");
        }
    }

    async _onTakeFromDiscard() {
        const discardPile = await fromUuid(this.item.system.linkedHandPileId);
        if (!discardPile || discardPile.cards.size === 0) return;
    
        const actor = this._getRequestingActor();
        if (actor) {
            await TnxActionHandler.takeFromDiscard(this.item.id, actor.id);
        } else if (game.user.isGM) {
            // GMがキャラクター未選択の状態で操作する場合
            const topCard = Array.from(discardPile.cards.values()).pop();
            if (!topCard) return;

            const ownedHands = game.cards.filter(c => c.type === "hand" && c.isOwner);
            if (ownedHands.length === 0) return ui.notifications.warn("戻し先となる、所有権を持つ「手札」タイプのカードスタックが見つかりません。");

            let targetHand;
            if (ownedHands.length === 1) {
                targetHand = ownedHands[0];
            } else {
                 const handId = await TargetSelectionDialog.prompt({
                    title: "戻し先の手札を選択",
                    label: "どの手札にカードを戻しますか？",
                    options: ownedHands.map(h => ({ value: h.id, label: h.name })),
                    selectLabel: "手札に戻す"
                });
                if (!handId) return;
                targetHand = game.cards.get(handId);
            }
            if (!targetHand) return;

            const targetActor = game.actors.find(a => a.system.handPileId === targetHand.uuid);
            if (!targetActor) return ui.notifications.warn(`手札「${targetHand.name}」に紐づくキャストが見つかりませんでした。`);

            await TnxActionHandler.takeFromDiscard(this.item.id, targetActor.id);
        }
    }

    async _onDealTrumpCard() {
        const sourceDeck = await this._getLinkedDeck();
        if (!sourceDeck) return;
    
        const targetActors = game.actors.filter(a => a.type === 'cast');
        if (targetActors.length === 0) {
            return ui.notifications.warn("配布先となるキャスト（PC）が見つかりません。");
        }
    
        const availableCards = sourceDeck.availableCards.sort((a, b) => a.value - b.value);

        const result = await DealTrumpDialog.prompt({
            actors: targetActors,
            cards: availableCards
        });

        if (!result || !result.actorId || !result.cardId) return;

        const { actorId, cardId } = result;
        const targetActor = game.actors.get(actorId);
        const cardToDeal = sourceDeck.cards.get(cardId);
        if (!targetActor || !cardToDeal) return;

        const trumpPile = await fromUuid(targetActor.system.trumpCardPileId);
        if (!trumpPile) {
            return ui.notifications.warn(game.i18n.format("TNX.WarningNoTrumpPileForTarget", { actorName: targetActor.name }));
        }

        if (trumpPile.cards.size >= 1) {
            return ui.notifications.warn(game.i18n.format("TNX.WarnTrumpPileFull", { actorName: targetActor.name }));
        }

        await sourceDeck.pass(trumpPile, [cardToDeal.id], {render: false});
        await targetActor.setFlag("tokyo-nova-axleration", "refreshSheet", true);

        if (targetActor.sheet.rendered) {
            targetActor.sheet.render(true);
        }

        const dealtCardName = cardToDeal.faces[0]?.name || "名前不明のカード";
        ui.notifications.info(game.i18n.format("TNX.InfoTrumpCardDealt", { actorName: targetActor.name, cardName: dealtCardName }));
        
        this.render(false);
        this._broadcastRefresh();
    }
}