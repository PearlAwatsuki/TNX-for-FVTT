import { 
    DealTrumpDialog,
    AmountInputDialog,
    CardSelectionDialog,
    TargetSelectionDialog
    } from './tnx-dialog.mjs';

export class TnxActionHandler {
    /**
     * 現在アクティブな山札（Cardsドキュメント）を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveDeck() {
        let cardDeckId = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario")
            ? (await fromUuid(game.settings.get("tokyo-nova-axleration", "activeScenarioId")))?.getFlag("tokyo-nova-axleration", "cardDeckId")
            : undefined;

        if (!cardDeckId) {
            cardDeckId = game.settings.get("tokyo-nova-axleration", "cardDeckId");
        }

        if (!cardDeckId) {
            ui.notifications.error("操作対象の山札が設定されていません。");
            return null;
        }
        return await fromUuid(cardDeckId);
    }

    /**
     * 現在アクティブな捨て札（Cardsドキュメント）を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveDiscardPile() {
        let discardPileId = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario")
            ? (await fromUuid(game.settings.get("tokyo-nova-axleration", "activeScenarioId")))?.getFlag("tokyo-nova-axleration", "discardPileId")
            : undefined;

        if (!discardPileId) {
            discardPileId = game.settings.get("tokyo-nova-axleration", "discardPileId");
        }

        if (!discardPileId) {
            ui.notifications.error("操作対象の捨て札が設定されていません。");
            return null;
        }
        return await fromUuid(discardPileId);
    }

    static async getActiveNeuroDeck() {
        let neuroDeckId = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario")
            ? (await fromUuid(game.settings.get("tokyo-nova-axleration", "activeScenarioId")))?.getFlag("tokyo-nova-axleration", "neuroDeckId")
            : undefined;
        // フォールバックは不要（シナリオ設定でのみ指定される想定）
        if (!neuroDeckId) {
            ui.notifications.error("操作対象のニューロデッキが設定されていません。");
            return null;
        }
        return await fromUuid(neuroDeckId);
    }

    static async getActiveScenePile() {
        let scenePileId = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario")
            ? (await fromUuid(game.settings.get("tokyo-nova-axleration", "activeScenarioId")))?.getFlag("tokyo-nova-axleration", "scenePileId")
            : undefined;
        if (!scenePileId) {
            ui.notifications.error("操作対象のシーンカード置き場が設定されていません。");
            return null;
        }
        return await fromUuid(scenePileId);
    }
    
    /**
     * 現在アクティブなRL切り札捨て場を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveGmTrumpDiscardPile() {
        let discardId = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario")
            ? (await fromUuid(game.settings.get("tokyo-nova-axleration", "activeScenarioId")))?.getFlag("tokyo-nova-axleration", "gmTrumpDiscardId")
            : undefined;

        if (!discardId) {
            // シナリオにない場合、システム設定からもフォールバックする
            discardId = game.settings.get("tokyo-nova-axleration", "gmTrumpDiscardId");
        }

        if (!discardId) {
            ui.notifications.error("操作対象のRL切り札捨て場が設定されていません。");
            return null;
        }
        return await fromUuid(discardId);
    }

    /**
     * カードをプレイする（手札から捨て札に移動する）
     * @param {string} cardId - プレイするカードのID
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async playCard(cardId, context = {}) {
        let hand;
        let handSourceDescription;

        if (context.actor) {
            // アクターシート等から明示的に指定された場合
            const handId = context.actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            handSourceDescription = `アクター「${context.actor.name}」`;
        } else {
            // HUD等からの操作：ユーザーキャラクターを参照
            const actor = game.user.character;
            if (!actor) return ui.notifications.warn("操作するキャラクターがユーザーに割り当てられていません。");
            
            const handId = actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            handSourceDescription = `キャラクター「${actor.name}」`;
        }

        if (!hand) return ui.notifications.error(`${handSourceDescription}に手札が設定されていません。`);
        
        const card = hand.cards.get(cardId);
        const discardPile = await this.getActiveDiscardPile();

        if (!card) {
            return ui.notifications.warn("指定されたカードが手札に見つかりませんでした。");
        }
        if (!discardPile) {
            return ui.notifications.error("捨て札が見つかりません。");
        }

        await card.play(discardPile);
    }

    /**
     * 切り札を使用する
     * @param {string} cardId - 使用する切り札のID
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async useTrump(cardId, context = {}) {
        let trumpPile, actor;

        // コンテキストに応じてどの切り札を操作するか決定
        if (context.actor) {
            // ケース1：アクターシートから呼び出された場合
            actor = context.actor;
            const trumpPileId = actor.system.trumpCardPileId;
            if (!trumpPileId) return ui.notifications.error(`アクター「${actor.name}」に切り札が設定されていません。`);
            trumpPile = trumpPileId ? await fromUuid(trumpPileId) : null;
        } else {
           const actor = game.user.character;
            if (!actor) return ui.notifications.warn("操作するキャラクターがユーザーに割り当てられていません。");
            
            const trumpPileId = actor.system.trumpCardPileId;
            trumpPile = trumpPileId ? await fromUuid(trumpPileId) : null;
        }

        if (!trumpPile) return ui.notifications.error("切り札のカード置き場が見つかりませんでした。");
        
        const card = trumpPile.cards.get(cardId);
        if (!card) return ui.notifications.warn("指定された切り札が手札に見つかりませんでした。");

        const isGM = game.user.isGM;
        const destinationPile = isGM 
            ? await this.getActiveGmTrumpDiscardPile()
            : await this.getActiveScenePile();

        if (!destinationPile) return;

        await trumpPile.pass(destinationPile, [cardId], { render: false, chatNotification: false });

        if (!isGM) {
            const passedCard = destinationPile.cards.get(card.id);
            await destinationPile.updateEmbeddedDocuments("Card", [{_id: passedCard.id, face: 0}]);
            const cardData = destinationPile.cards.get(passedCard.id);
            await this._postCardToChat(cardData, { speakerActor: actor });
        }

        ui.notifications.info(`切り札「${card.name}」を使用しました。`);
    }

    /**
     * カードを引く
     * アクターシートからの呼び出しと、ユーザーからの呼び出しを両方処理する
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async drawCard(context = {}) {
        const deck = await this.getActiveDeck();
        if (!deck || deck.availableCards.length === 0) {
            return ui.notifications.warn("山札にカードがありません。");
        }

        let hand, limit;

        // コンテキスト（actor or user）に応じて手札と上限を決定
        if (context.actor) {
            // 【ケース1】アクターシートから呼び出された場合
            const handId = context.actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = context.actor.system.handMaxSize || 0;
            if (!hand) {
                return ui.notifications.warn(`アクター「${context.actor.name}」に手札が設定されていません。`);
            }
        } else {
            // ユーザーキャラクターを参照
            const actor = game.user.character;
            if (!actor) return ui.notifications.warn("操作するキャラクターがユーザーに割り当てられていません。");

            const handId = actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = actor.system.handMaxSize ?? game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");
            
            if (!hand) return ui.notifications.warn(`キャラクター「${actor.name}」に手札が設定されていません。`);
        }

        // 上限を超えているかチェックし、警告を表示
        if (limit > 0 && hand.cards.size >= limit) {
            ui.notifications.warn(`手札が上限(${limit}枚)を超えます。`);
        }
        
        // ドローを実行
        await hand.draw(deck, 1, { render: false, updateData: { face: 0 } });
    }

    /**
     * 山札から1枚カードを表向きで捨て札に移動する（判定処理）
     */
    static async checkFromDeck() {
        const deck = await this.getActiveDeck();
        const discardPile = await this.getActiveDiscardPile();

        if (!deck || deck.availableCards.length === 0) {
            return ui.notifications.warn("山札にカードがありません。");
        }
        if (!discardPile) {
            return ui.notifications.warn("捨て札が設定されていません。");
        }

        // 1. 捨て札の山に、山札から1枚カードを引く
        const drawnCards = await discardPile.draw(deck, 1, { render: false, chatNotification: false });
        if (drawnCards.length === 0) return;
        
        // 2. 引いたカードを表向きにする
        const card = drawnCards[0];
        await discardPile.updateEmbeddedDocuments("Card", [{_id: card.id, face: 0}]);
        
        // 3. 完了を通知
        ui.notifications.info(`山札から判定を行いました： ${card.name}`);
    }

    static async drawNeuroCard() {
        const neuroDeck = await this.getActiveNeuroDeck();
        const scenePile = await this.getActiveScenePile();
        if (!neuroDeck || !scenePile || neuroDeck.availableCards.length === 0) return;
        
        const drawnCards = await scenePile.draw(neuroDeck, 1, { render: false, chatNotification: false });
        if (drawnCards.length === 0) return;
        
        const card = drawnCards[0];
        await scenePile.updateEmbeddedDocuments("Card", [{_id: card.id, face: 0}]);
        const cardData = scenePile.cards.get(card.id);

        await this._postCardToChat(cardData);
    }

    /**
     * 他のアクターにカードを渡す（データ操作のみ）
     * @param {string} sourceActorId - カードの渡し元アクターID
     * @param {string} targetActorId - カードの渡し先アクターID
     * @param {string[]} cardIds - 渡すカードのID配列
     */
    static async passCards(sourceActorId, targetActorId, cardIds) {
        const sourceActor = game.actors.get(sourceActorId);
        const targetActor = game.actors.get(targetActorId);
        if (!sourceActor || !targetActor || !cardIds || cardIds.length === 0) return;

        const sourceHand = await fromUuid(sourceActor.system.handPileId);
        const targetHand = await fromUuid(targetActor.system.handPileId);
        if (!sourceHand || !targetHand) return;

        await sourceHand.pass(targetHand, cardIds, { render: false });
        ui.notifications.info(`「${sourceActor.name}」から「${targetActor.name}」へ${cardIds.length}枚のカードを渡しました。`);
    }

    /**
     * 捨て札からカードを引く（アクターまたはユーザーの手札へ）
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async takeFromDiscard(context = {}) {
        let hand, limit, handSourceDescription;

        // アクターが指定されていれば、アクターの手札を対象にする
        if (context.actor) {
            const actor = context.actor;
            const handId = actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = actor.system.handMaxSize || 0;
            handSourceDescription = `アクター「${actor.name}」`;
        } 
        // 指定がなければ、操作しているユーザーのHUD手札を対象にする
        else {
            const actor = game.user.character;
            const handId = actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = actor?.system.handMaxSize ?? game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");
            handSourceDescription = "あなた";
        }

        if (!hand) {
            return ui.notifications.warn(`${handSourceDescription}に手札が設定されていません。`);
        }

        if (limit > 0 && hand.cards.size >= limit) {
            ui.notifications.warn(`${handSourceDescription}の手札が上限(${limit}枚)を超えます。`);
        }

        const discardPile = await this.getActiveDiscardPile();
        if (!discardPile || discardPile.cards.size === 0) {
            return ui.notifications.warn("捨て札にカードがありません。");
        }

        const cardsArray = discardPile.cards.contents;
        const topCard = cardsArray[cardsArray.length - 1];

        if (topCard) {
            await discardPile.pass(hand, [topCard.id], { render: false });
            ui.notifications.info(`捨て札から${handSourceDescription}の手札にカードを1枚移動しました。`);
        }
    }

    /**
     * すべての手札に、上限まで1枚ずつカードを補充する
     */
    static async dealInitialHands() {
        // --- 1. 配布に必要な基本情報を取得 ---
        const deck = await this.getActiveDeck();
        if (!deck || deck.availableCards.length < 1) {
            return ui.notifications.warn("山札にカードがありません。");
        }

        const defaultMaxSize = game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");
        if (!defaultMaxSize || defaultMaxSize <= 0) {
            return ui.notifications.warn("システム設定で初期手札枚数が設定されていません。");
        }

        // --- 2. 配布対象となるすべての手札と、それぞれのカード上限を計算 ---
        const allHands = game.cards.filter(c => c.type === 'hand');
        if (allHands.length === 0) {
            return ui.notifications.info("配布対象の手札がワールドに存在しません。");
        }

        const castActors = game.actors.filter(a => a.type === 'cast');
        const handsToDeal = allHands.map(hand => {
            const linkedActor = castActors.find(a => a.system.handPileId === hand.uuid);
            const limit = linkedActor?.system.handMaxSize ?? defaultMaxSize;
            return { hand, limit };
        });

        // --- 3. 手札のリセット処理を削除 ---
        
        ui.notifications.info(`${handsToDeal.length}個のすべての手札に、上限までカードを補充します...`);

        // --- 4. 1枚ずつ順番に、すべての手札が満タンになるまで配布 ---
        let totalCardsDealt = 0;
        let continueDealing = true;

        while (continueDealing) {
            let cardsDealtInThisRound = 0;

            if (deck.availableCards.length === 0) {
                ui.notifications.warn("山札がなくなりました。配布を終了します。");
                break;
            }

            for (const target of handsToDeal) {
                if (deck.availableCards.length === 0) break;

                // 手札がまだ上限に達していなければ1枚引く
                if (target.hand.cards.size < target.limit) {
                    await target.hand.draw(deck, 1, { render: false, updateData: { face: 0 }, chatNotification: false });
                    cardsDealtInThisRound++;
                    totalCardsDealt++;
                }
            }

            if (cardsDealtInThisRound === 0) {
                continueDealing = false;
            }
        }

        // --- 5. 最終結果を通知 ---
        if (totalCardsDealt > 0) {
            ui.notifications.info(`合計${totalCardsDealt}枚のカードを補充しました。`);
        } else {
            ui.notifications.info("すべての手札が上限に達していたため、カードは補充されませんでした。");
        }
    }


    /**
     * 【HUD用】操作したユーザーが、自身の手に複数枚カードを引く
     */
    static async drawMultipleCardsFromDeck() {
        const character = game.user.character;
        if (!character) return ui.notifications.warn("操作するキャラクターがユーザーに割り当てられていません。");
        
        const handId = character.system.handPileId;
        if (!handId) return ui.notifications.warn("キャラクター設定に手札が割り当てられていません。");
        
        const userHand = await fromUuid(handId);

        const handLimit = character?.system.handMaxSize ?? game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");

        const numToDraw = await AmountInputDialog.prompt({
            title: "複数枚カードを引く",
            label: `あなたの手札に何枚カードを引きますか？ (現在${userHand.cards.size}枚 / 上限${handLimit}枚)`,
            initialValue: 1, min: 1
        });

        if (!numToDraw) return;

        if (handLimit > 0 && (userHand.cards.size + numToDraw) > handLimit) {
            ui.notifications.warn(`手札が上限(${handLimit}枚)を超えます。`);
        }
        
        const deck = await this.getActiveDeck();
        if (!deck || deck.availableCards.length < numToDraw) {
            return ui.notifications.warn("山札のカードが足りません。");
        }

        await userHand.draw(deck, numToDraw, { render: false, updateData: { face: 0 } });
        ui.notifications.info(`${numToDraw}枚のカードを引きました。`);
    }

    /**
     * GMがニューロデッキから特定のキャストに切り札を1枚配布する
     */
    static async dealTrumpFromNeuroDeck() {
        // 1. 配布に必要なアクターとカードの情報を取得
        const castActors = game.actors.filter(a => a.type === 'cast');
        if (castActors.length === 0) {
            return ui.notifications.warn("配布対象のキャストが存在しません。");
        }

        const neuroDeck = await this.getActiveNeuroDeck();
        if (!neuroDeck || neuroDeck.cards.size === 0) {
            return ui.notifications.warn("ニューロデッキにカードがありません。");
        }
        const availableCards = neuroDeck.cards.contents;

        // 2. 専用ダイアログを呼び出して、アクターとカードを選択させる
        const selection = await DealTrumpDialog.prompt({
            actors: castActors,
            cards: availableCards
        });

        // 3. 選択されなかった場合（キャンセル時）は処理を中断
        if (!selection || !selection.actorId || !selection.cardId) {
            return;
        }

        // 4. 選択されたアクターとカードの情報を取得
        const targetActor = game.actors.get(selection.actorId);
        const selectedCard = neuroDeck.cards.get(selection.cardId);
        if (!targetActor || !selectedCard) {
            return ui.notifications.error("選択されたアクターまたはカードが見つかりませんでした。");
        }

        // 5. 配布先の切り札置き場を検証
        if (!targetActor.system.trumpCardPileId) {
            return ui.notifications.warn(`「${targetActor.name}」に切り札置き場が設定されていません。`);
        }
        const trumpPile = await fromUuid(targetActor.system.trumpCardPileId);
        if (!trumpPile) {
            return ui.notifications.error("対象の切り札置き場が見つかりませんでした。");
        }
        if (trumpPile.cards.size > 0) {
            return ui.notifications.warn(`「${targetActor.name}」の切り札置き場には既にカードがあります。`);
        }

        // 6. 選択されたカードをニューロデッキから切り札置き場へ移動
        await neuroDeck.pass(trumpPile, [selection.cardId], { updateData: { face: 0 } });

        // 7. 完了を通知
        ui.notifications.info(`ニューロデッキから「${selectedCard.name}」を「${targetActor.name}」の切り札として配布しました。`);
    }

    /**
     * 【HUD用】特定のカード1枚を、選択した別のユーザーに渡す
     * @param {string} cardId - 渡すカードのID
     */
    static async passSingleCard(cardId) {
        const sourceActor = game.user.character;
        const sourceHandId = sourceActor?.system.handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;

        const cardToPass = sourceHand.cards.get(cardId);
        if (!cardToPass) return ui.notifications.error("渡すカードが見つかりませんでした。");

        const targetUsers = game.users.filter(u => 
            u.id !== game.user.id && 
            u.character?.system.handPileId
        );

        if (targetUsers.length === 0) return ui.notifications.warn("カードを渡せる相手（手札を持つキャラクターを操作中のユーザー）がいません。");
        
        // ユーザーをプレイヤーとGMに分け、ソートする
        const playerUsers = targetUsers.filter(u => !u.isGM);
        const gmUsers = targetUsers.filter(u => u.isGM);
        playerUsers.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        gmUsers.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        const sortedUsers = [...playerUsers, ...gmUsers];

        const targetUserId = await TargetSelectionDialog.prompt({
            title: "カードを渡す相手を選択",
            label: `「${cardToPass.name}」を誰に渡しますか？`,
            options: sortedUsers.map(u => ({ value: u.id, label: u.name })),
            selectLabel: "決定"
        });
        if (!targetUserId) return;
        
        const targetUser = game.users.get(targetUserId);
        const targetHandId = targetUser.character.system.handPileId;
        const targetHand = await fromUuid(targetHandId);
        if (!targetHand) return ui.notifications.error("相手の手札が見つかりませんでした。");
        
        await sourceHand.pass(targetHand, [cardId]);
        ui.notifications.info(`「${cardToPass.name}」を「${targetUser.name}」に渡しました。`);
    }

    /**
     * 【HUD用】選択した複数枚のカードを、選択した別のユーザーに渡す
     */
    static async selectAndPassMultipleCards() {
        const sourceActor = game.user.character;
        const sourceHandId = sourceActor?.system.handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;
        if (!sourceHand || sourceHand.cards.size === 0) return ui.notifications.warn("渡せるカードが手札にありません。");

        const selectedCardsIds = await CardSelectionDialog.prompt({
            title: "渡すカードを選択",
            content: "渡したいカードをすべて選択してください。",
            cards: sourceHand.cards.contents,
            passLabel: "決定"
        });
        if (!selectedCardsIds || selectedCardsIds.length === 0) return;

        const targetUsers = game.users.filter(u => 
            u.id !== game.user.id && 
            u.character?.system.handPileId
        );
        if (targetUsers.length === 0) return ui.notifications.warn("カードを渡せる相手がいません。");

        // ユーザーをプレイヤーとGMに分け、ソートする
        const playerUsers = targetUsers.filter(u => !u.isGM);
        const gmUsers = targetUsers.filter(u => u.isGM);
        playerUsers.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        gmUsers.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
        const sortedUsers = [...playerUsers, ...gmUsers];

        const targetUserId = await TargetSelectionDialog.prompt({
            title: "カードを渡す相手を選択",
            label: `${selectedCardsIds.length}枚のカードを誰に渡しますか？`,
            options: sortedUsers.map(u => ({ value: u.id, label: u.name })),
            selectLabel: "決定"
        });
        if (!targetUserId) return;

        const targetUser = game.users.get(targetUserId);
        const targetHandId = targetUser.character.system.handPileId;
        if (!targetHandId) return ui.notifications.warn(`「${targetUser.name}」に手札が設定されていません。`);
        
        const targetHand = await fromUuid(targetHandId);
        if (!targetHand) return ui.notifications.error("相手の手札が見つかりませんでした。");

        await sourceHand.pass(targetHand, selectedCardsIds);
        ui.notifications.info(`「${targetUser.name}」に${selectedCardsIds.length}枚のカードを渡しました。`);
    }

    /**
     * 【HUD用】特定のカード1枚を捨て札に送る
     * @param {string} cardId - 捨てるカードのID
     */
    static async discardCard(cardId) {
        const sourceActor = game.user.character;
        const sourceHandId = sourceActor?.system.handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;
        if (!sourceHand) return ui.notifications.warn("あなたの手札が設定されていません。");

        const cardToDiscard = sourceHand.cards.get(cardId);
        if (!cardToDiscard) return ui.notifications.error("捨てるカードが見つかりませんでした。");
        
        const discardPile = await this.getActiveDiscardPile();
        if (!discardPile) return ui.notifications.error("捨て札が設定されていません。");

        // playではなくpassでカードを移動
        await sourceHand.pass(discardPile, [cardId]);
        ui.notifications.info(`「${cardToDiscard.name}」を捨てました。`);
    }

    /**
     * 捨て札にある全てのカードを山札に戻す
     */
    static async retrieveDiscardPile() {
        const deck = await this.getActiveDeck();
        const discardPile = await this.getActiveDiscardPile();
        
        if (!deck || !discardPile) return;
        if (discardPile.cards.size === 0) {
            return ui.notifications.warn("捨て札がありません。");
        }

        // 捨て札の全カードIDを取得
        const ids = discardPile.cards.map(c => c.id);

        // 山札に移動（pass）し、オプションで裏向き（face: null）に更新する
        await discardPile.pass(deck, ids, { 
            chatNotification: false,
            updateData: { face: null } 
        });
        
        if (game.settings.get("tokyo-nova-axleration", "shuffleOnDeckReset")) {
            await deck.shuffle();
            ui.notifications.info("捨て札を回収し、山札をシャッフルしました。");
        } else {
            ui.notifications.info("捨て札をすべて山札に回収しました。");
        }
    }

    /**
     * 捨て札の一番上のカード（最新の1枚）を山札の一番上に戻す
     */
    static async returnTopDiscardToDeck() {
        const deck = await this.getActiveDeck();
        const discardPile = await this.getActiveDiscardPile();
        
        if (!deck || !discardPile) return;
        if (discardPile.cards.size === 0) {
            return ui.notifications.warn("捨て札がありません。");
        }

        const cardsArray = discardPile.cards.contents;
        const topCard = cardsArray[cardsArray.length - 1]; // 配列の末尾が最新（一番上）

        // 山札に移動し、裏向きにする
        await discardPile.pass(deck, [topCard.id], { 
            chatNotification: false,
            updateData: { face: null }
        });

        ui.notifications.info(`「${topCard.name}」を山札に戻しました。`);
    }

    /**
     * カード情報をチャットに投稿する共通ヘルパー
     * @param {Card} card - チャットに投稿するカードドキュメント
     * @param {object} [options={}] - 追加オプション
     * @param {Actor} [options.speakerActor=null] - メッセージのスピーカーとなるアクター
     * @private
     */
    static async _postCardToChat(card, { speakerActor = null } = {}) {
        const templateData = {
            cardName: card.name,
            cardImage: card.img,
            keyword: card.faces[0]?.text || "（キーワードなし）",
            implication: card.description || "（暗示なし）"
        };
        
        const chatContent = await renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs", 
            templateData
        );

        const messageData = { content: chatContent };
        if (speakerActor) {
            messageData.speaker = ChatMessage.getSpeaker({ actor: speakerActor });
        }

        await ChatMessage.create(messageData);
    }
}