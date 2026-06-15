import { TnxActionHandler } from './tnx-action-handler.mjs';
import { TnxJudgmentFlow } from './tnx-judgment-flow.mjs';
import { getCardJudgmentValue, getAbilityBySuit } from './tnx-judgment-engine.mjs';
import { getUserFlagData } from './user-flag-schema.mjs';

/** カードの suit 文字列を TNX スートキーに正規化する */
function _normalizeSuit(rawSuit) {
    const s = (rawSuit ?? "").toLowerCase();
    if (s === "spades"   || s === "spade")   return "spade";
    if (s === "clubs"    || s === "club")     return "club";
    if (s === "hearts"   || s === "heart")    return "heart";
    if (s === "diamonds" || s === "diamond")  return "diamond";
    return null;
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxHud extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-hud",
        classes: ["tokyo-nova"],
        window: {
            frame: false,      // ウィンドウクロームなし (V1 popOut: false 相当)
            positioned: false, // Foundry の位置管理を使わない (CSS fixed で自己管理)
        },
        actions: {
            drawFromDeck:    TnxHud._onDrawFromDeck,
            playCard:        TnxHud._onPlayCard,
            drawNeuro:       TnxHud._onDrawNeuro,
            takeFromDiscard: TnxHud._onTakeFromDiscard,
            useTrump:        TnxHud._onUseTrump,
            resetRlTrump:    TnxHud._onResetRlTrump,
            toggleHudColumn:    TnxHud._onToggleHudColumn,
            toggleAccessArea:   TnxHud._onToggleAccessArea,
            presentAccessCard:  TnxHud._onPresentAccessCard,
            giveCardsToPlayer:  TnxHud._onGiveCardsToPlayer,
        },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/hud/hud.hbs",
        },
    };

    // ─── コンテキスト準備 ──────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        context.isGM = game.user.isGM;

        // --- カードID取得（ゲーム設定から直接読み込み）---
        const cardDeckId    = game.settings.get("tokyo-nova-axleration", "cardDeckId");
        const discardPileId = game.settings.get("tokyo-nova-axleration", "discardPileId");
        const neuroDeckId   = game.settings.get("tokyo-nova-axleration", "neuroDeckId");
        const scenePileId   = game.settings.get("tokyo-nova-axleration", "scenePileId");

        // --- 3. 取得したIDを元にドキュメントを読み込み、コンテキストにセット ---

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

        const userFlag = getUserFlagData(game.user);

        // 判定待機状態をコンテキストに反映
        const judgmentCtx  = TnxJudgmentFlow.context;
        const validSuits   = judgmentCtx?.validSuits ?? [];
        context.judgmentPending   = TnxJudgmentFlow.isPending;
        context.judgmentTrumpMode = TnxJudgmentFlow.trumpMode;

        if (userFlag.handPileId) {
            const hand = await fromUuid(userFlag.handPileId);
            if (hand) {
                context.hand = hand;

                // 判定中は達成値プレビューを計算する
                let abilitiesCtx = null;
                if (judgmentCtx) {
                    const jActor = game.actors.get(judgmentCtx.actorId);
                    if (jActor) abilitiesCtx = TnxJudgmentFlow._buildAbilitiesCtx(jActor);
                }

                context.handCards = hand.cards.contents.map(card => {
                    const suit    = _normalizeSuit(card.suit);
                    const isJoker = card.suit === "joker";
                    const judgmentValid = judgmentCtx !== null
                        && (isJoker || (suit !== null && validSuits.includes(suit)));

                    let preview = null;
                    if (judgmentCtx && abilitiesCtx) {
                        if (isJoker) {
                            preview = "?";
                        } else if (!suit || !validSuits.includes(suit)) {
                            // スート不一致 → 達成値 0
                            preview = "0";
                        } else if (card.value === 1 && judgmentCtx.type !== "controlCheck") {
                            // A: 11ルート達成値 / 21固定 を "nn/21" 形式で表示
                            const elevenPath = 11 + getAbilityBySuit(suit, abilitiesCtx).totalValue;
                            preview = `${elevenPath}/21`;
                        } else {
                            const cardJudgmentValue = getCardJudgmentValue({ numericValue: card.value });
                            if (typeof cardJudgmentValue === "number") {
                                if (judgmentCtx.type === "controlCheck") {
                                    preview = cardJudgmentValue;
                                } else {
                                    preview = cardJudgmentValue + getAbilityBySuit(suit, abilitiesCtx).totalValue;
                                }
                            }
                        }
                    }

                    return {
                        id:   card.id,
                        img:  card.img,
                        name: card.name,
                        suit: suit ?? card.suit,
                        isJoker,
                        judgmentValid,
                        preview,
                    };
                });
            }
        }

        if (userFlag.trumpCardPileId) {
            const trumpPile = await fromUuid(userFlag.trumpCardPileId);
            if (trumpPile) {
                context.trumpPile = trumpPile;
                context.trumpCard = trumpPile.cards.contents[0];
            }
        }

        // --- アクセスカード（全ユーザーに表示。pile 未設定・空のときはエリアごと非表示）---
        const accessCardPileId = game.settings.get("tokyo-nova-axleration", "accessCardPileId");
        const accessPile = await fromUuid(accessCardPileId);
        if (accessPile && accessPile.cards.size > 0) {
            context.accessCards = accessPile.cards.contents;
        }

        // --- プレイヤー手札（revealPlayerHands が true のときのみ表示）---
        context.showPlayerHands = game.settings.get("tokyo-nova-axleration", "revealPlayerHands");
        if (!context.showPlayerHands) return context;

        const allUsersWithHand = game.users.filter(u => u.active && !u.isGM && getUserFlagData(u).handPileId);
        const handTargets = game.user.isGM
            ? allUsersWithHand
            : allUsersWithHand.filter(u => u.id !== game.user.id);

        const playerHands = [];
        for (const u of handTargets) {
            const hand = await fromUuid(getUserFlagData(u).handPileId);
            if (hand) {
                playerHands.push({
                    userId:   u.id,
                    userName: u.name,
                    color:    u.color?.css ?? "#888888",
                    cards:    hand.cards.contents,
                });
            }
        }
        if (playerHands.length > 0) context.playerHands = playerHands;

        return context;
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    _onRender(_context, _options) {
        this._setupContextMenus();
        this._setupCardDragGhost(this.element);
        TnxHud._setupRightOffsetObserver();
        TnxHud._setupPlayerListObserver();
        this._restoreCollapseState();
    }

    _restoreCollapseState() {
        const rightCollapsed  = game.settings.get("tokyo-nova-axleration", "hudRightCollapsed");
        const bottomCollapsed = game.settings.get("tokyo-nova-axleration", "hudBottomCollapsed");
        const accessCollapsed = game.settings.get("tokyo-nova-axleration", "hudAccessCollapsed");
        const right  = this.element.querySelector(".hud-right-column");
        const bottom = this.element.querySelector(".hud-bottom-bar");
        const access = this.element.querySelector(".access-area");
        if (right  && rightCollapsed)  right.classList.add("collapsed");
        if (bottom && bottomCollapsed) bottom.classList.add("collapsed");
        if (access && accessCollapsed) access.classList.add("collapsed");
        TnxHud._syncHotbarVisibility(!bottomCollapsed);
        TnxHud._updateCollapseIcons(this.element);
    }

    // ─── サイドバー幅連動 ─────────────────────────────────────────────────────

    static _rightOffsetObserver = null;

    static _setupRightOffsetObserver() {
        if (TnxHud._rightOffsetObserver) return;
        // #sidebar-content のクラスを監視する。
        // - expanded 追加/削除 → サイドバー展開/収納 → CSS遷移(250ms)後に再測定
        // - active-{tab} 変化 → タブ切替 → 同上
        // chatNotifications が "pip"（通知バッジ）の場合は #chat-notifications が表示されないため
        // 常に #sidebar 左端を基準にする。"cards"（チャットカード）の場合は従来通り。
        const content = document.querySelector("#sidebar-content");
        if (!content) return;

        const apply = () => {
            const isPip = game.settings.get("core", "uiConfig").chatNotifications === "pip";
            const isChat = content.classList.contains("active-chat");
            const target = (isPip || isChat)
                ? document.querySelector("#sidebar")
                : document.querySelector("#ui-right");
            if (!target) return;
            const fromRight = window.innerWidth - target.getBoundingClientRect().left;
            // pip モードではサイドバー収納時にも追従できるよう下限を小さくし、10px の余白を加える
            const minOffset = isPip ? 18 : 370;
            document.documentElement.style.setProperty(
                "--tnx-right-offset", `${Math.max(minOffset, isPip ? fromRight + 10 : fromRight)}px`
            );
        };

        // サイドバーの CSS 遷移(250ms)中は毎フレーム再測定し、HUD を連続的に追従させる
        const follow = () => {
            const start = performance.now();
            const step = () => {
                apply();
                if (performance.now() - start < 400) requestAnimationFrame(step);
            };
            step();
        };

        TnxHud._rightOffsetObserver = new MutationObserver(follow);
        TnxHud._rightOffsetObserver.observe(content, { attributes: true, attributeFilter: ["class"] });
        // チャット通知モードの切替時にも再計算する
        Hooks.on("renderChatInput", apply);
        apply();
    }

    // ─── プレイヤーリスト連動 ──────────────────────────────────────────────────

    static _playerListObserver = null;
    static _playerListUpdate   = null;

    static _setupPlayerListObserver() {
        if (TnxHud._playerListObserver) return;
        const el = document.querySelector("#player-list") ?? document.querySelector("#players");
        if (!el) return;

        TnxHud._playerListUpdate = () => {
            // 下バーはプレイヤーリストの右隣に配置するため、リストの右端を公開する。
            // 名前の長さ・人数の増減で幅が変わっても ResizeObserver 経由で追従する。
            const rect = el.getBoundingClientRect();
            document.documentElement.style.setProperty("--tnx-players-right", `${rect.right}px`);
        };

        TnxHud._playerListObserver = new ResizeObserver(TnxHud._playerListUpdate);
        TnxHud._playerListObserver.observe(el);
        TnxHud._playerListUpdate();
    }

    // ─── コンテキストメニュー ──────────────────────────────────────────────────

    _setupContextMenus() {
        const el = this.element;

        const CM = foundry.applications.ux.ContextMenu.implementation;

        new CM(el, '.deck-card[data-action="drawNeuro"]', [
            {
                name: "切り札を配布する",
                icon: '<i class="fas fa-star"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.dealTrumpFromNeuroDeck(),
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
                },
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
                },
            },
        ], { jQuery: false, fixed: true });

        new CM(el, '.deck-card[data-action="drawFromDeck"]', [
            {
                name: "山札から判定する",
                icon: '<i class="fas fa-gavel"></i>',
                callback: () => TnxActionHandler.checkFromDeck(),
            },
            {
                name: "初期手札を配布",
                icon: '<i class="fas fa-hand-holding"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.dealInitialHands(),
            },
            {
                name: "複数枚ドローする",
                icon: '<i class="fas fa-cards"></i>',
                callback: () => TnxActionHandler.drawMultipleCardsFromDeck(),
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
                },
            },
            {
                name: "捨て札を回収",
                icon: '<i class="fas fa-recycle"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.retrieveDiscardPile(),
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
                },
            },
        ], { jQuery: false, fixed: true });

        new CM(el, '.deck-card[data-action="takeFromDiscard"]', [
            {
                name: "1枚手札に戻す",
                icon: '<i class="fas fa-hand-holding"></i>',
                callback: () => TnxActionHandler.takeFromDiscard(),
            },
            {
                name: "1枚山札に戻す",
                icon: '<i class="fas fa-arrow-up"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.returnTopDiscardToDeck(),
            },
            {
                name: "全て山札に戻す",
                icon: '<i class="fas fa-recycle"></i>',
                condition: game.user.isGM,
                callback: () => TnxActionHandler.retrieveDiscardPile(),
            },
        ], { jQuery: false, fixed: true });

        new CM(el, '.hand-area .card-in-hand', [
            {
                name: "手札を渡す",
                icon: '<i class="fas fa-user-friends"></i>',
                callback: (header) => TnxActionHandler.passSingleCard(header.dataset.cardId),
            },
            {
                name: "指定枚数を渡す",
                icon: '<i class="fas fa-users"></i>',
                callback: () => TnxActionHandler.selectAndPassMultipleCards(),
            },
            {
                name: "捨てる",
                icon: '<i class="fas fa-trash-alt"></i>',
                callback: (header) => TnxActionHandler.discardCard(header.dataset.cardId),
            },
        ], { jQuery: false, fixed: true });
    }

    // ─── ドラッグゴースト ──────────────────────────────────────────────────────

    _setupCardDragGhost(rootEl) {
        let ghost = document.querySelector(".tnx-card-ghost");
        if (!ghost) {
            ghost = document.createElement("img");
            ghost.className = "tnx-card-ghost";
            document.body.appendChild(ghost);
        }

        const dragTargets = rootEl.querySelectorAll("[data-drag-type]");
        const dropZones   = rootEl.querySelectorAll("[data-drop-zone]");

        if (dragTargets.length === 0 || dropZones.length === 0) return;

        dragTargets.forEach(target => {
            target.addEventListener('dragstart', (event) => {
                event.stopPropagation();
                event.dataTransfer.setData('text/plain', JSON.stringify({
                    sourceType: target.dataset.dragType,
                    cardId:     target.dataset.cardId,
                }));
                event.dataTransfer.setDragImage(new Image(), 0, 0);

                const img = target.querySelector("img") || target;
                if (img && ghost) {
                    ghost.src = img.src;
                    const maxW = 220;
                    const w    = img.naturalWidth || img.width || 160;
                    ghost.style.width   = `${Math.min(w, maxW)}px`;
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

            target.addEventListener('dragend', () => {
                if (ghost) ghost.style.display = 'none';
            });
        });

        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (event) => { event.preventDefault(); });

            zone.addEventListener('drop', (event) => {
                event.preventDefault();
                try {
                    const dataString = event.dataTransfer.getData('text/plain');
                    if (!dataString) return;
                    const data = JSON.parse(dataString);
                    const dropZoneType = zone.dataset.dropZone;

                    if (data.sourceType === 'deck') {
                        if (dropZoneType === 'hand')    TnxActionHandler.drawCard({ user: game.user });
                        else if (dropZoneType === 'discard') TnxActionHandler.checkFromDeck();
                    } else if (data.sourceType === 'hand-card') {
                        if (dropZoneType === 'discard' && data.cardId) TnxActionHandler.playCard(data.cardId);
                    } else if (data.sourceType === 'neuro-deck') {
                        if (dropZoneType === 'scene') TnxActionHandler.drawNeuroCard();
                    } else if (data.sourceType === 'trump-card') {
                        if (dropZoneType === 'scene' && !game.user.isGM && data.cardId) {
                            TnxActionHandler.useTrump(data.cardId);
                        }
                    } else if (data.sourceType === 'actor-hand-card') {
                        if (dropZoneType === 'discard' && data.cardId && data.actorId) {
                            const actor = game.actors.get(data.actorId);
                            if (actor) TnxActionHandler.playCard(data.cardId, { actor });
                        }
                    }
                } catch (e) {
                    console.error("TnxHud | drop error:", e);
                }
            });
        });
    }

    // ─── 静的アクションハンドラ ────────────────────────────────────────────────

    static async _onDrawFromDeck(event, _target) {
        event.preventDefault();
        await TnxActionHandler.drawCard({ user: game.user });
    }

    static async _onPlayCard(event, target) {
        event.preventDefault();
        const cardId = target.dataset.cardId;
        if (!cardId) return;

        // 判定待機中はカード選択として処理する
        if (TnxJudgmentFlow.isPending) {
            await TnxJudgmentFlow.executeFromHand(cardId);
            return;
        }

        await TnxActionHandler.playCard(cardId);
    }

    static async _onDrawNeuro(event, _target) {
        event.preventDefault();
        await TnxActionHandler.drawNeuroCard();
    }

    static async _onTakeFromDiscard(event, _target) {
        event.preventDefault();
        await TnxActionHandler.takeFromDiscard();
    }

    static async _onUseTrump(event, target) {
        event.preventDefault();
        const cardId = target.dataset.cardId;
        if (!cardId) return;
        await TnxActionHandler.useTrump(cardId);
    }

    static async _onResetRlTrump(event, _target) {
        event.preventDefault();
        await TnxActionHandler.resetRlTrump();
    }

    static _onToggleAccessArea(event, target) {
        event.preventDefault();
        const area = target.closest(".access-area");
        if (!area) return;
        const nowCollapsed = area.classList.toggle("collapsed");
        game.settings.set("tokyo-nova-axleration", "hudAccessCollapsed", nowCollapsed);
    }

    /**
     * アクセスカードを全接続ユーザーに提示する。カードは pile から移動させない。
     * GM 権限に依存しないよう、コアの shareImage ではなくシステム独自ソケットで配信する。
     * 受信側の表示処理は tnx.mjs の ready フックで登録している。
     */
    static async _onPresentAccessCard(event, target) {
        event.preventDefault();
        const cardId = target.dataset.cardId;
        if (!cardId) return;

        const accessPile = await fromUuid(game.settings.get("tokyo-nova-axleration", "accessCardPileId"));
        const card = accessPile?.cards.get(cardId);
        if (!card) return ui.notifications.warn("アクセスカードが見つかりませんでした。");

        // emit は自分のクライアントには届かないため、自分の分は直接表示する
        new foundry.applications.apps.ImagePopout({
            src: card.img,
            window: { title: card.name },
        }).render(true);
        game.socket.emit("system.tokyo-nova-axleration", {
            type: "presentAccessCard",
            src: card.img,
            title: card.name,
        });
    }

    static _onToggleHudColumn(event, target) {
        event.preventDefault();
        const column = target.dataset.column;
        if (!column) return;

        const settingKey = column === "right" ? "hudRightCollapsed" : "hudBottomCollapsed";
        const selector   = column === "right" ? ".hud-right-column" : ".hud-bottom-bar";
        const container  = target.closest(selector) ?? target.closest(".tnx-hud")?.querySelector(selector);
        if (!container) return;

        const nowCollapsed = container.classList.toggle("collapsed");
        game.settings.set("tokyo-nova-axleration", settingKey, nowCollapsed);

        if (column === "bottom") TnxHud._syncHotbarVisibility(!nowCollapsed);

        const hud = target.closest(".tnx-hud");
        if (hud) TnxHud._updateCollapseIcons(hud);
    }

    /**
     * 下バーとコアのホットバーは排他表示。
     * 下バー展開中はホットバーを退避させ、収納したら復帰させる(CSS は tnx2.css 参照)。
     */
    static _syncHotbarVisibility(hudExpanded) {
        document.body.classList.toggle("tnx-bottom-hud-expanded", hudExpanded);
    }

    static async _onGiveCardsToPlayer(event, target) {
        event.preventDefault();
        const targetUserId = target.dataset.targetUserId;
        if (!targetUserId) return;
        await TnxActionHandler.selectAndPassToUser(targetUserId);
    }

    static _updateCollapseIcons(hudEl) {
        const right  = hudEl.querySelector(".hud-right-column");
        const bottom = hudEl.querySelector(".hud-bottom-bar");

        if (right) {
            const icon = right.querySelector(".hud-collapse-right i");
            if (icon) {
                icon.classList.toggle("fa-chevron-right", !right.classList.contains("collapsed"));
                icon.classList.toggle("fa-chevron-left",   right.classList.contains("collapsed"));
            }
        }
        if (bottom) {
            // 展開時: 左向き(収納方向) / 収納時: 右向き(展開方向)
            const icon = bottom.querySelector(".hud-collapse-bottom i");
            if (icon) {
                icon.classList.toggle("fa-chevron-left",  !bottom.classList.contains("collapsed"));
                icon.classList.toggle("fa-chevron-right",  bottom.classList.contains("collapsed"));
            }
        }
    }
}
