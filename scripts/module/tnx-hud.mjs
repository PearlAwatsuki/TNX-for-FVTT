import { TnxActionHandler } from './tnx-action-handler.mjs';

export class TnxHud extends Application {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "tnx-hud",
            classes: ["tokyo-nova"],
            template: "systems/tokyo-nova-axleration/templates/hud/hud.hbs",
            popOut: false,
            resizable: false
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        
        // --- 1. ID変数の準備 ---
        let cardDeckId = "",
            discardPileId = "",
            neuroDeckId = "",
            scenePileId = "",
            accessCardPileId = "",
            gmTrumpDiscardId = "";

        // --- 2. ID取得ロジック ---
        const autoLoad = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario");
        const scenarioId = game.settings.get("tokyo-nova-axleration", "activeScenarioId");

        // ステップA: シナリオから読み込みを試行
        if (autoLoad && scenarioId) {
            const scenarioJournal = await fromUuid(scenarioId);
            if (scenarioJournal) {
                cardDeckId = scenarioJournal.getFlag("tokyo-nova-axleration", "cardDeckId");
                discardPileId = scenarioJournal.getFlag("tokyo-nova-axleration", "discardPileId");
                neuroDeckId = scenarioJournal.getFlag("tokyo-nova-axleration", "neuroDeckId");
                scenePileId = scenarioJournal.getFlag("tokyo-nova-axleration", "scenePileId");
                accessCardPileId = scenarioJournal.getFlag("tokyo-nova-axleration", "accessCardPileId");
                gmTrumpDiscardId = scenarioJournal.getFlag("tokyo-nova-axleration", "gmTrumpDiscardId");
            }
        }

        // ステップB: シナリオに設定がなかった場合、システム設定からフォールバック
        if (!cardDeckId) cardDeckId = game.settings.get("tokyo-nova-axleration", "cardDeckId");
        if (!discardPileId) discardPileId = game.settings.get("tokyo-nova-axleration", "discardPileId");
        if (!neuroDeckId) neuroDeckId = game.settings.get("tokyo-nova-axleration", "neuroDeckId");
        if (!scenePileId) scenePileId = game.settings.get("tokyo-nova-axleration", "scenePileId");
        if (!accessCardPileId) accessCardPileId = game.settings.get("tokyo-nova-axleration", "accessCardPileId");
        if (!gmTrumpDiscardId) gmTrumpDiscardId = game.settings.get("tokyo-nova-axleration", "gmTrumpDiscardId");

        // --- 3. 取得したIDを元にドキュメントを読み込み、コンテキストにセット ---

        // 山札のデータ
        const cardDeck = await fromUuid(cardDeckId);
        if (cardDeck) {
            context.cardDeck = cardDeck;
            context.cardDeck.count = cardDeck.availableCards.length;
        }

        // 捨て札のデータ
        const discardPile = await fromUuid(discardPileId);
        if (discardPile) {
            context.discardPile = discardPile;
            const cardsArray = discardPile.cards.contents;
            context.topDiscardImage = cardsArray[cardsArray.length - 1]?.img;
        }
        
        // ニューロデッキのデータ
        const neuroDeck = await fromUuid(neuroDeckId);
        if (neuroDeck) {
            context.neuroDeck = neuroDeck;
            context.neuroDeck.count = neuroDeck.availableCards.length;
        }

        // シーンカードのデータ
        const scenePile = await fromUuid(scenePileId);
        if (scenePile) {
            context.scenePile = scenePile;
            context.topSceneCard = scenePile.cards.contents[scenePile.cards.contents.length - 1];
        }

        // --- 4. ユーザー個別のカード情報を取得 ---
        const currentUser = game.user;
        if (currentUser) {
            // 手札
            const handId = currentUser.getFlag("tokyo-nova-axleration", "handId");
            if (handId) {
                context.hand = await fromUuid(handId);
            }
            // 切り札
            const trumpPileId = currentUser.getFlag("tokyo-nova-axleration", "trumpPileId");
            if (trumpPileId) {
                const trumpPile = await fromUuid(trumpPileId);
                if (trumpPile) {
                    context.trumpPile = trumpPile;
                    context.trumpCard = trumpPile.cards.contents[0];
                }
            }
        }

        return context;
    }

    /**
     * DOM要素が描画された後にリスナーを設定します。
     * @param {jQuery} html - アプリケーションのjQueryオブジェクト
     */
    activateListeners(html) {
        super.activateListeners(html);
    
        const hudElement = this.element[0];
        const sidebar = document.getElementById('sidebar');
        const collapseButton = document.querySelector('#sidebar-tabs a.collapse');
        if (sidebar) {
            const isInitiallyCollapsed = sidebar.classList.contains('collapsed');
            hudElement.classList.toggle('sidebar-collapsed', isInitiallyCollapsed);
        }
        if (collapseButton) {
            collapseButton.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (!sidebar) return;
                const isCollapsing = !sidebar.classList.contains('collapsed');
                const delay = isCollapsing ? 200 : 0;
        
                setTimeout(() => {
                    hudElement.classList.toggle('sidebar-collapsed');
                }, delay);
            });
        }

        const bottomBar = this.element.find('.hud-bottom-bar')[0];
        const actionBar = document.getElementById('action-bar');
        const hotbarCollapseButton = document.getElementById('bar-toggle');

        if (bottomBar && actionBar && hotbarCollapseButton) {
            const isInitiallyCollapsed = actionBar.classList.contains('collapsed');
            bottomBar.classList.toggle('hotbar-is-collapsed', isInitiallyCollapsed);

            hotbarCollapseButton.addEventListener('click', () => {
                const isCurrentlyCollapsed = actionBar.classList.contains('collapsed');
                bottomBar.classList.toggle('hotbar-is-collapsed', !isCurrentlyCollapsed);
            });
        }

        html.on('click', '[data-action]', async (event) => {
            event.preventDefault();
            const action = event.currentTarget.dataset.action;
            const actor = canvas.tokens.controlled[0]?.actor || game.user.character;

            if (action === 'draw-from-deck') {
                await TnxActionHandler.drawCard({ user: game.user });
            } else if (action === 'play-card') {
                const cardId = event.currentTarget.dataset.cardId;
                if (!cardId) return;
                await TnxActionHandler.playCard(cardId);
            } else if (action === 'draw-neuro') {
                await TnxActionHandler.drawNeuroCard();
            } else if (action === 'take-from-discard') {
                await TnxActionHandler.takeFromDiscard();
            } else if (action === 'use-trump') {
                const cardId = event.currentTarget.dataset.cardId;
                if (!cardId) return;
                await TnxActionHandler.useTrump(cardId);
            }
        });

        // ニューロデッキの右クリックメニュー
        const neuroDeckElement = html.find('.deck-card[data-action="draw-neuro"]');
        if (neuroDeckElement.length > 0) {
            const contextMenuOptions = [
                {
                    name: "切り札を配布する",
                    icon: '<i class="fas fa-star"></i>',
                    condition: game.user.isGM,
                    callback: () => {
                        TnxActionHandler.dealTrumpFromNeuroDeck();
                    }
                },
                {
                    name: "シャッフルする",
                    icon: '<i class="fas fa-random"></i>',
                    condition: game.user.isGM,
                    callback: async (header) => {
                        const neuroDeck = await TnxActionHandler.getActiveNeuroDeck();
                        if (neuroDeck) {
                            await neuroDeck.shuffle();
                            ui.notifications.info("ニューロデッキをシャッフルしました。");
                        }
                    }
                },
                {
                    name: "リセットする",
                    icon: '<i class="fas fa-undo"></i>',
                    condition: game.user.isGM,
                    callback: async (header) => {
                        const neuroDeck = await TnxActionHandler.getActiveNeuroDeck();
                        if (neuroDeck) {
                            await neuroDeck.recall();
                            ui.notifications.info("ニューロデッキをリセット（全カードを山札に回収）しました。");
                        }
                    }
                }
            ];
            new ContextMenu(html, '.deck-card[data-action="draw-neuro"]', contextMenuOptions);
        }

        const cardDeckElement = html.find('.deck-card[data-action="draw-from-deck"]');
        if (cardDeckElement.length > 0) {
            const contextMenuOptions = [
                {
                    name: "山札から判定する",
                    icon: '<i class="fas fa-gavel"></i>',
                    callback: () => {
                        TnxActionHandler.checkFromDeck();
                    }
                },
                {
                    name: "初期手札を配布",
                    icon: '<i class="fas fa-hand-holding"></i>',
                    condition: game.user.isGM,
                    callback: () => {
                        TnxActionHandler.dealInitialHands();
                    }
                },
                {
                    name: "複数枚ドローする",
                    icon: '<i class="fas fa-cards"></i>',
                    callback: () => TnxActionHandler.drawMultipleCardsFromDeck()
                },
                {
                    name: "シャッフルする",
                    icon: '<i class="fas fa-random"></i>',
                    condition: game.user.isGM,
                    callback: async () => {
                        const cardDeck = await TnxActionHandler.getActiveDeck();
                        if (cardDeck) {
                            await cardDeck.shuffle();
                            ui.notifications.info("山札をシャッフルしました。");
                        }
                    }
                },
                {
                    name: "捨て札を回収",
                    icon: '<i class="fas fa-recycle"></i>',
                    condition: game.user.isGM,
                    callback: async () => {
                        TnxActionHandler.retrieveDiscardPile();
                    }
                },
                {
                    name: "リセットする",
                    icon: '<i class="fas fa-undo"></i>',
                    condition: game.user.isGM,
                    callback: async () => {
                        const cardDeck = await TnxActionHandler.getActiveDeck();
                        if (cardDeck) {
                            await cardDeck.recall();
                            if (game.settings.get("tokyo-nova-axleration", "shuffleOnDeckReset")) {
                                await cardDeck.shuffle();
                                ui.notifications.info("山札をリセット（全カードを回収）し、シャッフルしました。");
                            } else {
                                ui.notifications.info("山札をリセット（全カードを回収）しました。");
                            }
                        }
                    }
                }
            ];
            new ContextMenu(html, '.deck-card[data-action="draw-from-deck"]', contextMenuOptions);
        }

        const discardPileElement = html.find('.deck-card[data-action="take-from-discard"]');
        if (discardPileElement.length > 0) {
            const contextMenuOptions = [
                {
                    name: "1枚手札に戻す",
                    icon: '<i class="fas fa-hand-holding"></i>',
                    callback: () => {
                        // 既存の左クリック時と同じ挙動
                        TnxActionHandler.takeFromDiscard();
                    }
                },
                {
                    name: "1枚山札に戻す",
                    icon: '<i class="fas fa-arrow-up"></i>',
                    condition: game.user.isGM, // 山札操作のためGM推奨（必要に応じて外してください）
                    callback: () => {
                        TnxActionHandler.returnTopDiscardToDeck();
                    }
                },
                {
                    name: "全て山札に戻す",
                    icon: '<i class="fas fa-recycle"></i>',
                    condition: game.user.isGM, // 山札回収と同じ挙動のためGM限定
                    callback: () => {
                        TnxActionHandler.retrieveDiscardPile();
                    }
                }
            ];
            new ContextMenu(html, '.deck-card[data-action="take-from-discard"]', contextMenuOptions);
        }

        // 手札のカードの右クリックメニュー
        const handCardElement = html.find('.hand-area .card-in-hand');
        if (handCardElement.length > 0) {
            const contextMenuOptions = [
                {
                    name: "手札を渡す",
                    icon: '<i class="fas fa-user-friends"></i>',
                    callback: (header) => {
                        const cardId = header.data('card-id');
                        TnxActionHandler.passSingleCard(cardId);
                    }
                },
                {
                    name: "指定枚数を渡す",
                    icon: '<i class="fas fa-users"></i>',
                    callback: () => {
                        TnxActionHandler.selectAndPassMultipleCards();
                    }
                },
                {
                    name: "捨てる",
                    icon: '<i class="fas fa-trash-alt"></i>',
                    callback: (header) => {
                        const cardId = header.data('card-id');
                        TnxActionHandler.discardCard(cardId);
                    }
                }
            ];
            new ContextMenu(html, '.hand-area .card-in-hand', contextMenuOptions);
        }

        this._setupCardDragGhost(html[0]);
    }

    _setupCardDragGhost(rootEl) {
        // 1) 使い回すゴースト<img>を準備
        let ghost = document.querySelector(".tnx-card-ghost");
        if (!ghost) {
            ghost = document.createElement("img");
            ghost.className = "tnx-card-ghost";
            document.body.appendChild(ghost);
        }
    
        // 2) セレクターをデータ属性ベースに統一
        const dragSelector = "[data-drag-type]";
        const dropSelector = "[data-drop-zone]";
        
        // 3) ドラッグ＆ドロップ対象の要素をすべて取得
        const dragTargets = rootEl.querySelectorAll(dragSelector);
        const dropZones = rootEl.querySelectorAll(dropSelector);
    
        if (dragTargets.length === 0 || dropZones.length === 0) return;
    
        // 4) すべてのドラッグ対象要素に、ネイティブイベントリスナーを設定
        dragTargets.forEach(target => {
    
            target.addEventListener('dragstart', (event) => {
                event.stopPropagation();
                
                const dragData = {
                    sourceType: target.dataset.dragType,
                    cardId: target.dataset.cardId
                };
                
                event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
                event.dataTransfer.setDragImage(new Image(), 0, 0);
    
                const img = target.querySelector("img") || target;
                if (img && ghost) {
                    ghost.src = img.src;
                    const maxW = 220;
                    const w = img.naturalWidth || img.width || 160;
                    ghost.style.width = `${Math.min(w, maxW)}px`;
                    ghost.style.display = 'block';
                }
            });
    
            target.addEventListener('drag', (event) => {
                if (!ghost || ghost.style.display === "none") return;
                if (event.clientX !== 0 || event.clientY !== 0) {
                    requestAnimationFrame(() => {
                        ghost.style.left = `${event.clientX - (ghost.width / 2)}px`;
                        ghost.style.top  = `${event.clientY - (ghost.height / 2)}px`;
                    });
                }
            });
    
            target.addEventListener('dragend', (event) => {
                if (ghost) ghost.style.display = 'none';
            });
        });
    
        // 5) すべてのドロップ先の要素にイベントリスナーを設定
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
    
            zone.addEventListener('drop', (event) => {
                event.preventDefault();
                
                try {
                    const dataString = event.dataTransfer.getData('text/plain');
                    if (!dataString) return;
                    const data = JSON.parse(dataString);
                    const dropZoneType = zone.dataset.dropZone;
    
                    // --- ドラッグ＆ドロップ処理の分岐 ---
    
                    if (data.sourceType === 'deck') {
                        if (dropZoneType === 'hand') {
                            TnxActionHandler.drawCard({ user: game.user });
                        }
                        else if (dropZoneType === 'discard') {
                            TnxActionHandler.checkFromDeck();
                        }
                    }
                    
                    else if (data.sourceType === 'hand-card') {
                        if (dropZoneType === 'discard') {
                            if (data.cardId) {
                                TnxActionHandler.playCard(data.cardId);
                            }
                        }
                    }
                    
                    else if (data.sourceType === 'neuro-deck') {
                        if (dropZoneType === 'scene') {
                            TnxActionHandler.drawNeuroCard();
                        }
                    }

                    else if (data.sourceType === 'trump-card') {
                        // ドロップ先が「シーンカード」置き場の場合
                        if (dropZoneType === 'scene') {
                            // さらに、操作しているユーザーがGMでない（＝プレイヤーである）ことを確認
                            if (!game.user.isGM) {
                                if (data.cardId) {
                                    TnxActionHandler.useTrump(data.cardId);
                                }
                            }
                            // GMの場合は何もしない（このブロックが実行されないため）
                        }
                    }

                    // ドラッグ元が「キャストシートの手札のカード」の場合
                    else if (data.sourceType === 'actor-hand-card') {
                        // ドロップ先が「捨て札」の場合
                        if (dropZoneType === 'discard') {
                            if (data.cardId && data.actorId) {
                                const actor = game.actors.get(data.actorId);
                                if (actor) {
                                    // playCardに、どのキャラクターが使ったかを伝える
                                    TnxActionHandler.playCard(data.cardId, { actor: actor });
                                }
                            }
                        }
                    }
    
                } catch (e) {
                    console.error("Error on drop:", e);
                }
            });
        });
    }
}