import { TnxActionHandler } from './tnx-action-handler.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// V12対応: HandlebarsApplicationMixin を ApplicationV2 と組み合わせて基底クラスを作成 
class TnxBaseApplication extends HandlebarsApplicationMixin(ApplicationV2) {}

export class TnxHud extends TnxBaseApplication {
    /**
     * @override
     * V12対応: デフォルトオプションを static DEFAULT_OPTIONS プロパティで定義 
     * V12対応: クリックイベントを actions として静的に定義
     */
    static DEFAULT_OPTIONS = {
        id: "tnx-hud",
        classes: ["tokyo-nova"],
        popOut: false,
        resizable: false,
        window: {
            header: false, // ヘッダーを非表示
            frame: false   // ウィンドウ枠を非表示
        },
        actions: {
            "draw-from-deck": TnxHud.onDrawFromDeck,
            "play-card": TnxHud.onPlayCard,
            "draw-neuro": TnxHud.onDrawNeuro,
            "take-from-discard": TnxHud.onTakeFromDiscard,
            "use-trump": TnxHud.onUseTrump
        }
    };

    static PARTS = {
        body: {
          template: 'systems/tokyo-nova-axleration/templates/hud/hud.hbs'
        }
    };

    /**
     * V12対応: getData(options) を _prepareContext(options) にリネーム 
     * superの呼び出しは不要になります。
     */
    async _prepareContext(options) {
        const context = {}; // V2では空のオブジェクトから開始
        
        // --- 1. ID変数の準備 ---
        let cardDeckId = "",
            discardPileId = "",
            neuroDeckId = "",
            scenePileId = "",
            accessCardPileId = "",
            gmTrumpDiscardId = "";

        // --- 2. ID取得ロジック (変更なし) ---
        const autoLoad = game.settings.get("tokyo-nova-axleration", "autoLoadFromScenario");
        const scenarioId = game.settings.get("tokyo-nova-axleration", "activeScenarioId");

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

        if (!cardDeckId) cardDeckId = game.settings.get("tokyo-nova-axleration", "cardDeckId");
        if (!discardPileId) discardPileId = game.settings.get("tokyo-nova-axleration", "discardPileId");
        if (!neuroDeckId) neuroDeckId = game.settings.get("tokyo-nova-axleration", "neuroDeckId");
        if (!scenePileId) scenePileId = game.settings.get("tokyo-nova-axleration", "scenePileId");
        if (!accessCardPileId) accessCardPileId = game.settings.get("tokyo-nova-axleration", "accessCardPileId");
        if (!gmTrumpDiscardId) gmTrumpDiscardId = game.settings.get("tokyo-nova-axleration", "gmTrumpDiscardId");

        // --- 3. 取得したIDを元にドキュメントを読み込み、コンテキストにセット (変更なし) ---
        const cardDeck = await fromUuid(cardDeckId);
        if (cardDeck) {
            context.cardDeck = cardDeck;
            context.cardDeck.count = cardDeck.availableCards.length;
        }

        const discardPile = await fromUuid(discardPileId);
        if (discardPile) {
            context.discardPile = discardPile;
            const cardsArray = discardPile.cards.contents;
            context.topDiscardImage = cardsArray[cardsArray.length - 1]?.img;
        }
        
        const neuroDeck = await fromUuid(neuroDeckId);
        if (neuroDeck) {
            context.neuroDeck = neuroDeck;
            context.neuroDeck.count = neuroDeck.availableCards.length;
        }

        const scenePile = await fromUuid(scenePileId);
        if (scenePile) {
            context.scenePile = scenePile;
            context.topSceneCard = scenePile.cards.contents[scenePile.cards.contents.length - 1];
        }

        // --- 4. ユーザー個別のカード情報を取得 (変更なし) ---
        const currentUser = game.user;
        if (currentUser) {
            const handId = currentUser.getFlag("tokyo-nova-axleration", "handId");
            if (handId) {
                context.hand = await fromUuid(handId);
            }
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
     * V12対応: activateListeners の代わりに _attachListeners を使用
     * ここでは静的actionsでカバーできないイベントリスナー（コンテキストメニューなど）を設定します。
     * @param {HTMLElement} html - アプリケーションのルートDOM要素
     */
    _attachListeners(html) {

        // ドラッグ＆ドロップの設定
        this._setupCardDragGhost(html);
    }

    async _onRender(context, options) {
        // 必要であれば親クラスの処理を呼び出す
        if (typeof super._onRender === "function") {
            super._onRender(context, options);
        }
                    
        this._attachListeners(this.element);

        const bottomBar = this.element.querySelector('.hud-bottom-bar');
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
    }
    
    /**
     * V12対応: 初回描画時に一度だけ実行されるライフサイクルフック 
     * サイドバーやホットバーの開閉など、HUD外の要素との連携をここに記述します。
     */
    async _onFirstRender(html) {
        // コンテキストメニューの設定
        this._initializeContextMenus(html);

        const hudElement = this.element; // this.elementは直接HTMLElementを指す 
        const sidebar = document.getElementById('sidebar');
        const collapseButton = document.querySelector('#sidebar-tabs a.collapse');
        
        // サイドバー開閉追従
        if (sidebar && collapseButton) {
            // 初期状態を反映
            hudElement.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
            // クリックイベントを設定
            collapseButton.addEventListener('click', () => {
                const isCollapsing = !sidebar.classList.contains('collapsed');
                // アニメーションを考慮して少し遅らせる
                setTimeout(() => {
                    hudElement.classList.toggle('sidebar-collapsed', isCollapsing);
                }, isCollapsing ? 200 : 0);
            });
        }
    }
    
    /**
     * コンテキストメニューを初期化するヘルパーメソッド
     * @param {HTMLElement} html - アプリケーションのルートDOM要素
     */
    _initializeContextMenus(html) {
        // ニューロデッキの右クリックメニュー
        ContextMenu.create(this, this.element, '.deck-card[data-action="draw-neuro"]', [
            {
                name: "切り札を配布する",
                icon: '<i class="fas fa-star"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.dealTrumpFromNeuroDeck()
            },
            {
                name: "シャッフルする",
                icon: '<i class="fas fa-random"></i>',
                condition: game.user.isGM,
                callback: async () => {
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
                callback: async () => {
                    const neuroDeck = await TnxActionHandler.getActiveNeuroDeck();
                    if (neuroDeck) {
                        await neuroDeck.recall();
                        ui.notifications.info("ニューロデッキをリセット（全カードを山札に回収）しました。");
                    }
                }
            }
        ]);

        // 山札の右クリックメニュー
        ContextMenu.create(this, this.element, '.deck-card[data-action="draw-from-deck"]', [
            {
                name: "山札から判定する",
                icon: '<i class="fas fa-gavel"></i>',
                callback: () => TnxActionHandler.checkFromDeck()
            },
            {
                name: "初期手札を配布",
                icon: '<i class="fas fa-hand-holding"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.dealInitialHands()
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
                name: "リセットする",
                icon: '<i class="fas fa-undo"></i>',
                condition: game.user.isGM,
                callback: async () => {
                    const cardDeck = await TnxActionHandler.getActiveDeck();
                    if (cardDeck) {
                        await cardDeck.recall();
                        ui.notifications.info("山札をリセット（全カードを回収）しました。");
                    }
                }
            }
        ]);

        // 手札のカードの右クリックメニュー
        ContextMenu.create(this, this.element, '.hand-area .card-in-hand', [
            // callbackの第一引数(header)はjQueryオブジェクトなので、ネイティブDOM要素にアクセスするために[0]をつけます
            {
                name: "手札を渡す",
                icon: '<i class="fas fa-user-friends"></i>',
                callback: header => TnxActionHandler.passSingleCard(header[0].dataset.cardId)
            },
            {
                name: "指定枚数を渡す",
                icon: '<i class="fas fa-users"></i>',
                callback: () => TnxActionHandler.selectAndPassMultipleCards()
            },
            {
                name: "捨てる",
                icon: '<i class="fas fa-trash-alt"></i>',
                callback: header => TnxActionHandler.discardCard(header[0].dataset.cardId)
            }
        ]);
    }

    /**
     * ドラッグ＆ドロップのゴースト表示とイベントを設定します。
     * このメソッドは既にネイティブDOM APIを使用しているため、大きな変更は不要です。
     * @param {HTMLElement} rootEl - アプリケーションのルートDOM要素
     */
    _setupCardDragGhost(rootEl) {
        // (内部ロジックは変更なし)
        // ... 元の _setupCardDragGhost のコードをここにペースト ...
        let ghost = document.querySelector(".tnx-card-ghost");
        if (!ghost) {
            ghost = document.createElement("img");
            ghost.className = "tnx-card-ghost";
            document.body.appendChild(ghost);
        }
        const dragSelector = "[data-drag-type]";
        const dropSelector = "[data-drop-area]";
        const dragTargets = rootEl.querySelectorAll(dragSelector);
        const dropAreas = rootEl.querySelectorAll(dropSelector);
        if (dragTargets.length === 0 || dropAreas.length === 0) return;
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
        dropAreas.forEach(area => {
            area.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
            area.addEventListener('drop', (event) => {
                event.preventDefault();
                try {
                    const dataString = event.dataTransfer.getData('text/plain');
                    if (!dataString) return;
                    const data = JSON.parse(dataString);
                    const dropAreaType = area.dataset.dropArea;
                    if (data.sourceType === 'deck') {
                        if (dropAreaType === 'hand') TnxActionHandler.drawCard({ user: game.user });
                        else if (dropAreaType === 'discard') TnxActionHandler.checkFromDeck();
                    } else if (data.sourceType === 'hand-card') {
                        if (dropAreaType === 'discard' && data.cardId) TnxActionHandler.playCard(data.cardId);
                    } else if (data.sourceType === 'discard-card') {
                        if (dropAreaType === 'hand') TnxActionHandler.takeFromDiscard();
                    } else if (data.sourceType === 'neuro-deck') {
                        if (dropAreaType === 'scene') TnxActionHandler.drawNeuroCard();
                    } else if (data.sourceType === 'trump-card') {
                        if (dropAreaType === 'scene' && !game.user.isGM && data.cardId) TnxActionHandler.useTrump(data.cardId);
                    } else if (data.sourceType === 'actor-hand-card') {
                        if (dropAreaType === 'discard' && data.cardId && data.actorId) {
                            const actor = game.actors.get(data.actorId);
                            if (actor) TnxActionHandler.playCard(data.cardId, { actor: actor });
                        }
                    }
                } catch (e) {
                    console.error("Error on drop:", e);
                }
            });
        });
    }


    // --- 静的アクションハンドラ ---
    // V12対応: data-action属性に対応する静的メソッドを定義 

    static async onDrawFromDeck(event, target) {
        return TnxActionHandler.drawCard({ user: game.user });
    }

    static async onPlayCard(event, target) {
        const cardId = target.dataset.cardId;
        if (cardId) return TnxActionHandler.playCard(cardId);
    }

    static async onDrawNeuro(event, target) {
        return TnxActionHandler.drawNeuroCard();
    }

    static async onTakeFromDiscard(event, target) {
        return TnxActionHandler.takeFromDiscard();
    }

    static async onUseTrump(event, target) {
        const cardId = target.dataset.cardId;
        if (cardId) return TnxActionHandler.useTrump(cardId);
    }
}