import {
    DealTrumpDialog,
    AmountInputDialog,
    CardSelectionDialog,
    TargetSelectionDialog
    } from './tnx-dialog.mjs';
import { lookupDrawTables } from './tnx-draw-table.mjs';

/** スタイル枠ニューロカードの日本語名 → タロット名アルファベット対応表 */
const NEURO_STYLE_ROMAJI = {
    "アヤカシ":   "AYAKASHI",
    "エトランゼ": "ETRANGER",
    "カゲムシャ": "KAGEMUSHA",
    "アラシ":     "ARASHI",
    "シキガミ":   "SHIKIGAMI",
    "イブキ":     "IBUKI",
    "クロガネ":   "KUROGANE",
    "ヒルコ":     "HIRUKO",
    "コモン":     "COMMON",
};

export class TnxActionHandler {
    /**
     * 現在アクティブな山札（Cardsドキュメント）を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveDeck() {
        const id = game.settings.get("tokyo-nova-axleration", "cardDeckId");
        if (!id) { ui.notifications.error("操作対象の山札が設定されていません。"); return null; }
        return await fromUuid(id);
    }

    /**
     * 現在アクティブな捨て札（Cardsドキュメント）を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveDiscardPile() {
        const id = game.settings.get("tokyo-nova-axleration", "discardPileId");
        if (!id) { ui.notifications.error("操作対象の捨て札が設定されていません。"); return null; }
        return await fromUuid(id);
    }

    static async getActiveNeuroDeck() {
        const id = game.settings.get("tokyo-nova-axleration", "neuroDeckId");
        if (!id) { ui.notifications.error("操作対象のニューロデッキが設定されていません。"); return null; }
        return await fromUuid(id);
    }

    static async getActiveScenePile() {
        const id = game.settings.get("tokyo-nova-axleration", "scenePileId");
        if (!id) { ui.notifications.error("操作対象のシーンカード置き場が設定されていません。"); return null; }
        return await fromUuid(id);
    }

    /**
     * 現在アクティブなRL切り札捨て場を取得するヘルパー関数
     * @returns {Promise<Cards|null>}
     */
    static async getActiveGmTrumpDiscardPile() {
        const id = game.settings.get("tokyo-nova-axleration", "gmTrumpDiscardId");
        if (!id) { ui.notifications.error("操作対象のRL切り札捨て場が設定されていません。"); return null; }
        return await fromUuid(id);
    }

    /**
     * RL切り札捨て場にある「切り札」カードを GM の切り札置き場に戻す。
     * HUD の空切り札エリアクリックから呼ぶ。
     */
    static async resetRlTrump() {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');

        const gmTrumpDiscard = await this.getActiveGmTrumpDiscardPile();
        if (!gmTrumpDiscard) return;

        const gm = game.users.find(u => u.isGM);
        if (!gm) return ui.notifications.warn("GMユーザーが見つかりません。");

        const gmTrumpPile = getUserFlagData(gm).trumpCardPileId
            ? await fromUuid(getUserFlagData(gm).trumpCardPileId)
            : null;
        if (!gmTrumpPile) return ui.notifications.warn("GMユーザーの切り札置き場が設定されていません。");

        if (gmTrumpPile.cards.size > 0) return ui.notifications.warn("RLの切り札には既にカードがあります。");

        const trumpCard = gmTrumpDiscard.cards.find(c => c.name === "切り札");
        if (!trumpCard) return ui.notifications.info("RL切り札捨て場に「切り札」カードはありません。");

        await gmTrumpDiscard.pass(gmTrumpPile, [trumpCard.id], { chatNotification: false });
        ui.notifications.info("「切り札」をRLの切り札に再配布しました。");
    }

    /**
     * カードをプレイする（手札から捨て札に移動する）
     * @param {string} cardId - プレイするカードのID
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async playCard(cardId, context = {}) {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        let hand;
        let handSourceDescription;

        if (context.actor) {
            // アクターシート等から明示的に指定された場合
            const handId = context.actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            handSourceDescription = `アクター「${context.actor.name}」`;
        } else {
            // HUD等からの操作：ユーザー自身の手札を参照
            const handId = getUserFlagData(game.user).handPileId;
            hand = handId ? await fromUuid(handId) : null;
            handSourceDescription = `ユーザー「${game.user.name}」`;
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

        await card.play(discardPile, { chatNotification: false });
    }

    /**
     * 切り札を使用する
     * @param {string} cardId - 使用する切り札のID
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async useTrump(cardId, context = {}) {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        let trumpPile, actor;

        // コンテキストに応じてどの切り札を操作するか決定
        if (context.actor) {
            // ケース1：アクターシートから呼び出された場合
            actor = context.actor;
            const trumpPileId = actor.system.trumpCardPileId;
            if (!trumpPileId) return ui.notifications.error(`アクター「${actor.name}」に切り札が設定されていません。`);
            trumpPile = trumpPileId ? await fromUuid(trumpPileId) : null;
        } else {
            // ケース2：HUD等からの操作：ユーザー自身の切り札を参照
            const trumpPileId = getUserFlagData(game.user).trumpCardPileId;
            trumpPile = trumpPileId ? await fromUuid(trumpPileId) : null;
            // 演出用にアクターを取得しておく（設定されていなくてもエラーにはしない）
            actor = game.user.character;
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
        const { getUserFlagData, resolveEffectiveHandMaxSize } = await import('./user-flag-schema.mjs');
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
            const ownerUser = context.actor.type === 'cast' && context.actor.system.ownerUserId
                ? game.users.find(u => u.uuid === context.actor.system.ownerUserId)
                : null;
            limit = resolveEffectiveHandMaxSize(ownerUser);
            if (!hand) {
                return ui.notifications.warn(`アクター「${context.actor.name}」に手札が設定されていません。`);
            }
        } else {
            // ユーザー自身の手札を参照
            const flagData = getUserFlagData(game.user);
            const handId = flagData.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = resolveEffectiveHandMaxSize(game.user);

            if (!hand) return ui.notifications.warn(`ユーザー「${game.user.name}」に手札が設定されていません。`);
        }

        // 上限を超えているかチェックし、警告を表示
        if (limit > 0 && hand.cards.size >= limit) {
            ui.notifications.warn(`手札が上限(${limit}枚)を超えます。`);
        }
        
        // ドローを実行
        await hand.draw(deck, 1, { render: false, chatNotification: false, updateData: { face: 0 } });
    }

    /**
     * 手札を上限まで補充する（手札判定後の自動ドロー用）。
     * 山札が不足している場合は引ける枚数だけ引く。通知は行わない。
     */
    static async autoReplenishHand() {
        const { getUserFlagData, resolveEffectiveHandMaxSize } = await import('./user-flag-schema.mjs');
        const deck = await this.getActiveDeck();
        if (!deck || deck.availableCards.length === 0) return;

        const flagData = getUserFlagData(game.user);
        const hand     = flagData.handPileId ? await fromUuid(flagData.handPileId) : null;
        if (!hand) return;

        const limit = resolveEffectiveHandMaxSize(game.user);
        if (limit <= 0) return;

        const deficit = limit - hand.cards.size;
        if (deficit <= 0) return;

        const drawCount = Math.min(deficit, deck.availableCards.length);
        if (drawCount <= 0) return;

        await hand.draw(deck, drawCount, { render: false, chatNotification: false, updateData: { face: 0 } });
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

        // 開いているドロー表（設定デッキ = ニューロデッキ）に結果をルックアップ
        await lookupDrawTables(cardData, neuroDeck.uuid);
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

        await sourceHand.pass(targetHand, cardIds, { render: false, chatNotification: false });
        ui.notifications.info(`「${sourceActor.name}」から「${targetActor.name}」へ${cardIds.length}枚のカードを渡しました。`);
    }

    /**
     * 捨て札からカードを引く（アクターまたはユーザーの手札へ）
     * @param {object} [context={}] - 操作のコンテキスト
     */
    static async takeFromDiscard(context = {}) {
        const { getUserFlagData, resolveEffectiveHandMaxSize } = await import('./user-flag-schema.mjs');
        let hand, limit, handSourceDescription;

        // アクターが指定されていれば、アクターの手札を対象にする
        if (context.actor) {
            const actor = context.actor;
            const handId = actor.system.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            const ownerUser = actor.type === 'cast' && actor.system.ownerUserId
                ? game.users.find(u => u.uuid === actor.system.ownerUserId)
                : null;
            limit = resolveEffectiveHandMaxSize(ownerUser);
            handSourceDescription = `アクター「${actor.name}」`;
        }
        // 指定がなければ、操作しているユーザーのHUD手札を対象にする
        else {
            const flagData = getUserFlagData(game.user);
            const handId = flagData.handPileId;
            hand = handId ? await fromUuid(handId) : null;
            limit = resolveEffectiveHandMaxSize(game.user);
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
            await discardPile.pass(hand, [topCard.id], { render: false, chatNotification: false });
            ui.notifications.info(`捨て札から${handSourceDescription}の手札にカードを1枚移動しました。`);
        }
    }

    /**
     * すべての手札に、上限まで1枚ずつカードを補充する
     */
    static async dealInitialHands() {
        const { getUserFlagData, resolveEffectiveHandMaxSize } = await import('./user-flag-schema.mjs');

        // --- 1. 配布に必要な基本情報を取得 ---
        const deck = await this.getActiveDeck();
        if (!deck || deck.availableCards.length < 1) {
            return ui.notifications.warn("山札にカードがありません。");
        }

        const defaultHandMaxSize = game.settings.get("tokyo-nova-axleration", "defaultHandMaxSize");
        if (!defaultHandMaxSize || defaultHandMaxSize <= 0) {
            return ui.notifications.warn("システム設定で初期手札枚数が設定されていません。");
        }

        // --- 2. 配布対象となるすべての手札と、それぞれのカード上限を計算 ---
        const allHands = game.cards.filter(c => c.type === 'hand');
        if (allHands.length === 0) {
            return ui.notifications.info("配布対象の手札がワールドに存在しません。");
        }

        const handsToDeal = [];
        for (const hand of allHands) {
            // その手札を持つUserを探す
            const ownerUser = game.users.find(u => getUserFlagData(u).handPileId === hand.uuid);
            const limit = resolveEffectiveHandMaxSize(ownerUser);
            handsToDeal.push({ hand, limit });
        }
        
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
        const { getUserFlagData, resolveEffectiveHandMaxSize } = await import('./user-flag-schema.mjs');
        const flagData = getUserFlagData(game.user);
        const handId = flagData.handPileId;
        if (!handId) return ui.notifications.warn("ユーザーに手札が割り当てられていません。");

        const userHand = await fromUuid(handId);

        const handLimit = resolveEffectiveHandMaxSize(game.user);

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

        await userHand.draw(deck, numToDraw, { render: false, chatNotification: false, updateData: { face: 0 } });
        ui.notifications.info(`${numToDraw}枚のカードを引きました。`);
    }

    /**
     * GMがニューロデッキから特定のユーザーに切り札を1枚配布する
     */
    static async dealTrumpFromNeuroDeck() {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');

        // 1. 配布に必要なユーザーとカードの情報を取得
        const targetUsers = game.users.filter(u => !u.isGM);
        if (targetUsers.length === 0) {
            return ui.notifications.warn("配布対象のプレイヤーが存在しません。");
        }

        const neuroDeck = await this.getActiveNeuroDeck();
        if (!neuroDeck || neuroDeck.cards.size === 0) {
            return ui.notifications.warn("ニューロデッキにカードがありません。");
        }
        const availableCards = neuroDeck.cards.contents;

        // 2. 専用ダイアログを呼び出して、ユーザーとカードを選択させる
        const selection = await DealTrumpDialog.prompt({
            users: targetUsers,
            cards: availableCards
        });

        // 3. 選択されなかった場合（キャンセル時）は処理を中断
        if (!selection || !selection.userId || !selection.cardId) {
            return;
        }

        // 4. 選択されたユーザーとカードの情報を取得
        const targetUser = game.users.get(selection.userId);
        const selectedCard = neuroDeck.cards.get(selection.cardId);
        if (!targetUser || !selectedCard) {
            return ui.notifications.error("選択されたユーザーまたはカードが見つかりませんでした。");
        }

        // 5. ユーザーの切り札置き場を検証
        const trumpPileId = getUserFlagData(targetUser).trumpCardPileId;
        if (!trumpPileId) {
            return ui.notifications.warn(`「${targetUser.name}」に切り札置き場が設定されていません。`);
        }

        const trumpPile = await fromUuid(trumpPileId);
        if (!trumpPile) {
            return ui.notifications.error("対象の切り札置き場が見つかりませんでした。");
        }
        if (trumpPile.cards.size > 0) {
            return ui.notifications.warn(`「${targetUser.name}」の切り札置き場には既にカードがあります。`);
        }

        // 6. 選択されたカードをニューロデッキから切り札置き場へ移動
        await neuroDeck.pass(trumpPile, [selection.cardId], { chatNotification: false, updateData: { face: 0 } });

        // 7. 完了を通知
        ui.notifications.info(`ニューロデッキから「${selectedCard.name}」を「${targetUser.name}」の切り札として配布しました。`);
    }

    /**
     * 【HUD用】特定のカード1枚を、選択した別のユーザーに渡す
     * @param {string} cardId - 渡すカードのID
     */
    static async passSingleCard(cardId) {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        const sourceHandId = getUserFlagData(game.user).handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;

        const cardToPass = sourceHand?.cards.get(cardId);
        if (!cardToPass) return ui.notifications.error("渡すカードが見つかりませんでした。");

        const targetUsers = game.users.filter(u => 
            u.id !== game.user.id && 
            getUserFlagData(u).handPileId
        );

        if (targetUsers.length === 0) return ui.notifications.warn("カードを渡せる相手（手札を持つユーザー）がいません。");
        
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
        const targetHandId = getUserFlagData(targetUser).handPileId;
        const targetHand = await fromUuid(targetHandId);
        if (!targetHand) return ui.notifications.error("相手の手札が見つかりませんでした。");
        
        await sourceHand.pass(targetHand, [cardId], { chatNotification: false });
        ui.notifications.info(`「${cardToPass.name}」を「${targetUser.name}」に渡しました。`);
    }

    /**
     * 【HUD用】選択した複数枚のカードを、選択した別のユーザーに渡す
     */
    static async selectAndPassMultipleCards() {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        const sourceHandId = getUserFlagData(game.user).handPileId;
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
            getUserFlagData(u).handPileId
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
        const targetHandId = getUserFlagData(targetUser).handPileId;
        if (!targetHandId) return ui.notifications.warn(`「${targetUser.name}」に手札が設定されていません。`);
        
        const targetHand = await fromUuid(targetHandId);
        if (!targetHand) return ui.notifications.error("相手の手札が見つかりませんでした。");

        await sourceHand.pass(targetHand, selectedCardsIds, { chatNotification: false });
        ui.notifications.info(`「${targetUser.name}」に${selectedCardsIds.length}枚のカードを渡しました。`);
    }

    /**
     * 【HUD用】対象ユーザーを事前に決めてカードを渡す（プレイヤー手札エリアのクリックから起動）。
     * カード選択ダイアログのみ表示し、プレイヤー選択ステップはスキップする。
     * @param {string} targetUserId
     */
    static async selectAndPassToUser(targetUserId) {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        const sourceHandId = getUserFlagData(game.user).handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;
        if (!sourceHand || sourceHand.cards.size === 0)
            return ui.notifications.warn("渡せるカードが手札にありません。");

        const targetUser = game.users.get(targetUserId);
        if (!targetUser) return ui.notifications.error("対象ユーザーが見つかりません。");

        const targetHandId = getUserFlagData(targetUser).handPileId;
        const targetHand = targetHandId ? await fromUuid(targetHandId) : null;
        if (!targetHand) return ui.notifications.warn(`「${targetUser.name}」に手札が設定されていません。`);

        const selectedCardIds = await CardSelectionDialog.prompt({
            title: `「${targetUser.name}」に渡すカードを選択`,
            content: "渡したいカードをすべて選択してください。",
            cards: sourceHand.cards.contents,
            passLabel: "渡す",
        });
        if (!selectedCardIds || selectedCardIds.length === 0) return;

        await sourceHand.pass(targetHand, selectedCardIds, { chatNotification: false });
        ui.notifications.info(`「${targetUser.name}」に${selectedCardIds.length}枚のカードを渡しました。`);
    }

    /**
     * 【HUD用】特定のカード1枚を捨て札に送る
     * @param {string} cardId - 捨てるカードのID
     */
    static async discardCard(cardId) {
        const { getUserFlagData } = await import('./user-flag-schema.mjs');
        const sourceHandId = getUserFlagData(game.user).handPileId;
        const sourceHand = sourceHandId ? await fromUuid(sourceHandId) : null;
        if (!sourceHand) return ui.notifications.warn("あなたの手札が設定されていません。");

        const cardToDiscard = sourceHand.cards.get(cardId);
        if (!cardToDiscard) return ui.notifications.error("捨てるカードが見つかりませんでした。");
        
        const discardPile = await this.getActiveDiscardPile();
        if (!discardPile) return ui.notifications.error("捨て札が設定されていません。");

        // playではなくpassでカードを移動
        await sourceHand.pass(discardPile, [cardId], { chatNotification: false });
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
            await deck.shuffle({ chatNotification: false });
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
        const keyword    = await TextEditor.enrichHTML(card.faces[0]?.text ?? "（キーワードなし）");
        const implication = await TextEditor.enrichHTML(card.description ?? "（暗示なし）");
        const cardNameRomaji = NEURO_STYLE_ROMAJI[card.name] ?? null;

        const romajiBlock = cardNameRomaji
            ? `<div class="tnx-neuro-card-chat__name">${cardNameRomaji}</div>`
            : "";
        const imageBlock = card.img
            ? `<img class="tnx-neuro-card-chat__image" src="${card.img}" alt="">`
            : "";

        const chatContent = `<div class="tnx-neuro-card-chat tokyo-nova">
    <div class="tnx-neuro-card-chat__header">
        <span class="tnx-neuro-card-chat__type-label">ニューロカード</span>
    </div>
    <div class="tnx-neuro-card-chat__body">
        ${imageBlock}
        <div class="tnx-neuro-card-chat__info">
            ${romajiBlock}
            <div class="tnx-neuro-card-chat__name">${card.name}</div>
            <hr class="tnx-neuro-card-chat__divider">
            <div class="tnx-neuro-card-chat__field">
                <div class="tnx-neuro-card-chat__field-label">キーワード</div>
                <div class="tnx-neuro-card-chat__field-value">${keyword}</div>
            </div>
            <div class="tnx-neuro-card-chat__field">
                <div class="tnx-neuro-card-chat__field-label">暗示</div>
                <div class="tnx-neuro-card-chat__field-value">${implication}</div>
            </div>
        </div>
    </div>
</div>`;

        const messageData = { content: chatContent };
        if (speakerActor) {
            messageData.speaker = ChatMessage.getSpeaker({ actor: speakerActor });
        }

        await ChatMessage.create(messageData);
    }
}