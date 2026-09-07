import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";
import { TnxActionHandler, buildNeuroCardChatHTML } from '../cards/tnx-action-handler.mjs';
import { TnxCheckFlow } from '../flow/tnx-check-flow.mjs';
import { isDamageCardPending, executeDamageCardFromHand } from '../flow/damage-flow.mjs';
import { getCardCheckValue, getAbilityBySuit, SUIT_TO_ABILITY } from '../rules/tnx-check-engine.mjs';
import { getUserFlagData } from '../core/user-flag-schema.mjs';
import { getSessionState, getActiveActJournal } from '../session/session-state.mjs';
import { isAppearing } from '../session/appearance-state.mjs';
import {
    hudInfoItems, hudInfoTnChips, withResolvedInfoSkillNames, buildInfoCardData, infoDesignationRows,
} from '../rules/session.mjs';
import { loadGeneralSkillNameByKey } from '../dictionary/skill-dictionary.mjs';

/** トランプの裏面画像(非開示時・RL手札の裏向き表示に使用) */
const PLAYING_CARD_BACK = "systems/tokyo-nova-axleration/assets/cards/playing-cards/back.png";

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
            replenishHand:   TnxHud._onReplenishHand,
            toggleHudColumn:    TnxHud._onToggleHudColumn,
            toggleAccessArea:   TnxHud._onToggleAccessArea,
            toggleParticipantsArea: TnxHud._onToggleParticipantsArea,
            presentAccessCard:  TnxHud._onPresentAccessCard,
            infoCheck:          TnxHud._onInfoCheck,
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

        // 折り畳み状態はテンプレートに直接出力し、初期描画＝最終状態にする(描画後 JS トグルの
        // チラつき＝展開状態で描画→直後に収納、を防ぐ。_restoreCollapseState は冪等に残す)
        context.rightCollapsed  = game.settings.get(SYSTEM_ID, "hudRightCollapsed");
        context.bottomCollapsed = game.settings.get(SYSTEM_ID, "hudBottomCollapsed");
        context.accessCollapsed = game.settings.get(SYSTEM_ID, "hudAccessCollapsed");
        context.participantsCollapsed = game.settings.get(SYSTEM_ID, "hudParticipantsCollapsed");

        // --- カードID取得（ゲーム設定から直接読み込み）---
        const cardDeckId    = game.settings.get(SYSTEM_ID, "cardDeckId");
        const discardPileId = game.settings.get(SYSTEM_ID, "discardPileId");
        const neuroDeckId   = game.settings.get(SYSTEM_ID, "neuroDeckId");
        const scenePileId   = game.settings.get(SYSTEM_ID, "scenePileId");

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
            // シーンカードはカード画像しか見えないので、ホバーでチャットカードと同じ意匠の
            // ツールチップを出す(2026-08-16 ユーザー指示。説明が既に見えているシナリオ
            // コントロールパネルには付けない)。HTML はチャット投稿と同じ生成関数
            context.sceneCardTooltip = context.topSceneCard
                ? await buildNeuroCardChatHTML(context.topSceneCard)
                : null;
        }

        // 情報項目(14-9): 上演中のアクトの情報項目を一覧表示する
        context.infoItems = await TnxHud._buildInfoItems();

        const userFlag = getUserFlagData(game.user);

        // 判定待機状態をコンテキストに反映
        const checkCtx  = TnxCheckFlow.context;
        const validSuits   = checkCtx?.validSuits ?? [];
        context.checkPending   = TnxCheckFlow.isPending;
        context.checkTrumpMode = TnxCheckFlow.trumpMode;

        if (userFlag.handPileId) {
            const hand = await fromUuid(userFlag.handPileId);
            if (hand) {
                context.hand = hand;

                // 判定中は達成値プレビューを計算する
                let abilitiesCtx = null;
                let jActor = null;
                if (checkCtx) {
                    jActor = game.actors.get(checkCtx.actorId);
                    if (jActor) abilitiesCtx = TnxCheckFlow._buildAbilitiesCtx(jActor);
                }

                context.handCards = hand.cards.contents.map(card => {
                    const suit    = _normalizeSuit(card.suit);
                    const isJoker = card.suit === "joker";
                    const checkValid = checkCtx !== null
                        && (isJoker || (suit !== null && validSuits.includes(suit)));

                    let preview = null;
                    if (checkCtx && abilitiesCtx) {
                        // 判定バフ(check.)を達成値プレビューにも反映。能力値判定はスートで対象能力値が変わる
                        // ため、カード(スート)ごとに算出する。21固定は達成値 21 のためバフ非対象。
                        const checkBonus = jActor
                            ? TnxCheckFlow._computeCheckBonus(jActor, checkCtx, SUIT_TO_ABILITY[suit]).total
                            : 0;
                        if (isJoker) {
                            preview = "?";
                        } else if (!suit || !validSuits.includes(suit)) {
                            // スート不一致 → 達成値 0
                            preview = "0";
                        } else if (card.value === 1 && checkCtx.type !== "controlCheck") {
                            // A: 11ルート達成値 / 21固定 を "nn/21" 形式で表示
                            const elevenPath = 11 + getAbilityBySuit(suit, abilitiesCtx).totalValue + checkBonus;
                            preview = `${elevenPath}/21`;
                        } else {
                            const cardCheckValue = getCardCheckValue({ numericValue: card.value });
                            if (typeof cardCheckValue === "number") {
                                if (checkCtx.type === "controlCheck") {
                                    preview = cardCheckValue;
                                } else {
                                    preview = cardCheckValue + getAbilityBySuit(suit, abilitiesCtx).totalValue + checkBonus;
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
                        checkValid,
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
        const accessCardPileId = game.settings.get(SYSTEM_ID, "accessCardPileId");
        const accessPile = await fromUuid(accessCardPileId);
        if (accessPile && accessPile.cards.size > 0) {
            context.accessCards = accessPile.cards.contents;
        }

        // --- ステータスカード(14-7): 提示式でなく状態からの自動表示 ---
        context.statusCards = TnxHud._buildUserStatusCards(game.user);

        // --- 参加者パネル(自分以外の手札所持ユーザー。ステータス+手札を常時表示) ---
        // 手札の表裏: revealPlayerHands がオンのときのみプレイヤーの手札を表向きにする。
        // RL の手札は設定によらず常に裏向き。裏向きのカードには名前等の情報を一切載せない
        // (ツールチップからの内容漏れ防止)
        const revealHands = game.settings.get(SYSTEM_ID, "revealPlayerHands");
        const others = game.users.filter(u =>
            u.active && u.id !== game.user.id && getUserFlagData(u).handPileId);
        // 並びは受け渡しダイアログと同じ規則: プレイヤー(名前順)→GM(名前順)
        const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
        const ordered = [
            ...others.filter(u => !u.isGM).sort(byName),
            ...others.filter(u => u.isGM).sort(byName),
        ];
        const participants = [];
        for (const u of ordered) {
            const hand = await fromUuid(getUserFlagData(u).handPileId);
            if (!hand) continue;
            const isRL = u.isGM;
            const faceUp = revealHands && !isRL;
            participants.push({
                userId:   u.id,
                userName: u.name,
                color:    u.color?.css ?? "#888888",
                isRL,
                statusCards: isRL ? [] : TnxHud._buildUserStatusCards(u),
                cards: hand.cards.contents.map(card => faceUp
                    ? { img: card.img, name: card.name, faceUp: true }
                    : { img: card.back?.img || PLAYING_CARD_BACK, faceUp: false }),
            });
        }
        context.participants = participants;

        return context;
    }

    /**
     * ユーザーの現在ステータスカード群を組み立てる(14-7: 状態からの自動表示)。
     * 自分のステータスパネルと参加者パネルの各行が共用する。
     * 登場状態の三態はプレイヤーのみ・排他: シーンプレイヤー/登場中(プレート)/舞台裏。
     * 舞台裏カード=文字通り舞台裏にいる(登場していない)の表示(2026-08-22 裁定。
     * 旧「舞台裏枠の開始〜終了の間は全員に表示」は誤解釈につき撤回)。
     * ゴースト/抹殺は担当キャラクターの状態から追加表示。
     * @param {User} user 対象ユーザー
     * @returns {Array<{img: string, label: string}|{plate: string, label: string}>}
     */
    static _buildUserStatusCards(user) {
        const statusBase = "systems/tokyo-nova-axleration/assets/cards/access-cards/";
        const cards = [];
        const character = user.character;
        if (!user.isGM) {
            if (getUserFlagData(user).isScenePlayer) {
                cards.push({ img: `${statusBase}scene_player.png`, label: "シーン・プレイヤー" });
            } else if (isAppearing(character)) {
                // 登場中の専用アクセスカード画像は無いため、アクセスカードの意匠
                // (英題+和文リボン)に合わせた CSS プレートで表示する
                cards.push({ plate: { en: "ON STAGE", ja: "登場中" }, label: "登場中" });
            } else {
                cards.push({ img: `${statusBase}behind_the_scene.png`, label: "舞台裏" });
            }
        }
        if (character?.system?.isGhost === true) {
            cards.push({ img: `${statusBase}ghost.png`, label: "ゴースト" });
        }
        if (character?.effects?.some(e => !e.disabled
            && e.flags?.[SYSTEM_ID]?.conditionKind === "erased")) {
            cards.push({ img: `${statusBase}erasure.png`, label: "抹殺" });
        }
        return cards;
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
        const rightCollapsed  = game.settings.get(SYSTEM_ID, "hudRightCollapsed");
        const bottomCollapsed = game.settings.get(SYSTEM_ID, "hudBottomCollapsed");
        const accessCollapsed = game.settings.get(SYSTEM_ID, "hudAccessCollapsed");
        const participantsCollapsed = game.settings.get(SYSTEM_ID, "hudParticipantsCollapsed");
        const right  = this.element.querySelector(".hud-right-column");
        const bottom = this.element.querySelector(".hud-bottom-bar");
        const access = this.element.querySelector(".access-area");
        const participants = this.element.querySelector(".participants-area");
        if (right  && rightCollapsed)  right.classList.add("collapsed");
        if (bottom && bottomCollapsed) bottom.classList.add("collapsed");
        if (access && accessCollapsed) access.classList.add("collapsed");
        if (participants && participantsCollapsed) participants.classList.add("collapsed");
        TnxHud._syncHotbarVisibility(!bottomCollapsed);
        TnxHud._updateCollapseIcons(this.element);
    }

    // ─── サイドバー幅連動 ─────────────────────────────────────────────────────

    static _rightOffsetObserver = null;
    /** ロード直後の不安定な測定でサイドバーにめり込むのを防ぐ沈静化フラグ(ready 後に true) */
    static _settled = false;
    /** 最新の apply クロージャ参照(沈静化完了後に外部から再測定を促すため) */
    static _applyRightOffset = null;

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
            if (!TnxHud._settled) {
                // 沈静化前(ロード直後)はサイドバー位置が未確定。測定せず何もしない。
                // 右カラムは CSS で非表示にしておき、沈静化時に実測位置へ置いてからフェードインで出す
                // (位置をカクっと動かして見せない。下バーは別要素なので表示のまま)。
                return;
            }
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

        TnxHud._applyRightOffset = apply;

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
                        await neuroDeck.shuffle({ chatNotification: false });
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
                        await neuroDeck.recall({ chatNotification: false });
                        ui.notifications.info("ニューロデッキをリセット（全カードを山札に回収）しました。");
                    }
                },
            },
        ], { jQuery: false, fixed: true });

        new CM(el, '.deck-card[data-action="drawFromDeck"]', [
            {
                // 山札からの判定は判定ダイアログ経由に移行済み。ここは公開で1枚めくる汎用操作
                // (2026-07-09 改名。判定には使わないが山札をめくる必要自体はありうる)
                name: "山札から1枚めくる",
                icon: '<i class="fas fa-clone"></i>',
                callback: () => TnxActionHandler.flipFromDeck(),
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
                        await cardDeck.shuffle({ chatNotification: false });
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
                        await cardDeck.recall({ chatNotification: false });
                        if (game.settings.get(SYSTEM_ID, "shuffleOnDeckReset")) {
                            await cardDeck.shuffle({ chatNotification: false });
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
                        if (dropZoneType === 'hand')    TnxActionHandler.drawCard();
                        else if (dropZoneType === 'discard') TnxActionHandler.flipFromDeck();
                    } else if (data.sourceType === 'hand-card') {
                        if (dropZoneType === 'discard' && data.cardId) TnxActionHandler.playCard(data.cardId);
                        // 参加者パネルの手札行へドロップ=そのユーザーにカードを渡す
                        else if (dropZoneType === 'participant' && data.cardId && zone.dataset.userId) {
                            TnxActionHandler.passCardToUser(data.cardId, zone.dataset.userId);
                        }
                    } else if (data.sourceType === 'discard-card') {
                        // 捨て札の一番上のカードを移す(右クリックメニューと同じ操作の D&D 版。
                        // 山札へ戻せるのは RL のみ=メニューの権限と同一)
                        if (dropZoneType === 'deck') {
                            if (game.user.isGM) TnxActionHandler.returnTopDiscardToDeck();
                            else ui.notifications.warn("捨て札を山札に戻せるのはRLのみです。");
                        } else if (dropZoneType === 'hand') {
                            TnxActionHandler.takeFromDiscard();
                        }
                    } else if (data.sourceType === 'neuro-deck') {
                        if (dropZoneType === 'scene') TnxActionHandler.drawNeuroCard();
                    } else if (data.sourceType === 'trump-card') {
                        if (dropZoneType === 'scene' && !game.user.isGM && data.cardId) {
                            TnxActionHandler.useTrump(data.cardId);
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
        await TnxActionHandler.drawCard();
    }

    static async _onPlayCard(event, target) {
        event.preventDefault();
        const cardId = target.dataset.cardId;
        if (!cardId) return;

        // 判定待機中はカード選択として処理する
        if (TnxCheckFlow.isPending) {
            await TnxCheckFlow.executeFromHand(cardId);
            return;
        }

        // ダメージカード待機中は手札クリック=ダメージカードを出す(判定と同じ操作系・12-3)
        if (isDamageCardPending()) {
            await executeDamageCardFromHand(cardId);
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

    static async _onReplenishHand(event, _target) {
        event.preventDefault();
        await TnxActionHandler.autoReplenishHand();
    }

    static _onToggleAccessArea(event, target) {
        event.preventDefault();
        const area = target.closest(".access-area");
        if (!area) return;
        const nowCollapsed = area.classList.toggle("collapsed");
        game.settings.set(SYSTEM_ID, "hudAccessCollapsed", nowCollapsed);
    }

    static _onToggleParticipantsArea(event, target) {
        event.preventDefault();
        const area = target.closest(".participants-area");
        if (!area) return;
        const nowCollapsed = area.classList.toggle("collapsed");
        game.settings.set(SYSTEM_ID, "hudParticipantsCollapsed", nowCollapsed);
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

        const accessPile = await fromUuid(game.settings.get(SYSTEM_ID, "accessCardPileId"));
        const card = accessPile?.cards.get(cardId);
        if (!card) return ui.notifications.warn("アクセスカードが見つかりませんでした。");

        // emit は自分のクライアントには届かないため、自分の分は直接表示する
        new foundry.applications.apps.ImagePopout({
            src: card.img,
            window: { title: card.name },
        }).render(true);
        game.socket.emit(SOCKET_CHANNEL, {
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
        game.settings.set(SYSTEM_ID, settingKey, nowCollapsed);

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

    // ─── 情報項目(14-9・正本 Scenario_Progress「情報収集判定の裁定」) ──────────

    /**
     * HUD の情報項目一覧を組み立てる(上演中のみ)。公開状態3段階(2026-08-16 裁定):
     * PL には非公開を「非公開の情報」として存在だけ見せる(技能・目標値・内容は伏せる)。
     * ツールチップは**常設**(開示済み=内容/未開示=指定技能と目標値。チャットが流れた場合に
     * 備える)——送信カードと同じ組み立て(buildInfoCardData)＝チャットカード意匠。
     * @returns {Promise<Array<object>>}
     */
    static async _buildInfoItems() {
        const st = getSessionState();
        const journal = st.actStarted ? getActiveActJournal() : null;
        const raw = journal?.getFlag(SYSTEM_ID, "infoItems") ?? [];
        if (!raw.length) return [];
        const nameByKey = await loadGeneralSkillNameByKey();
        const shaped = hudInfoItems(raw, { isGM: game.user.isGM });
        return Promise.all(shaped.map(async (row, i) => {
            // PL の非公開項目は存在表示のみ(ツールチップ・判定ボタンなし)
            if (row.masked) return { ...row, hiddenMark: true, tooltipHtml: "", canCheck: false };
            const resolved = withResolvedInfoSkillNames(raw[i], nameByKey);
            // 本文のエンリッチ(16-x): ツールチップ内でも @UUID コンテンツリンク等を解決する
            const { enrichInfoCardData } = await import("../chat/reference-links.mjs");
            const tooltipHtml = await foundry.applications.handlebars.renderTemplate(
                "systems/tokyo-nova-axleration/templates/chat/info-card.hbs",
                await enrichInfoCardData(buildInfoCardData(resolved)));
            return {
                ...row,
                hiddenMark: !row.isPublic,   // RL 向け=非公開の印
                tooltipHtml,
                // 目標値チップ(2026-08-17 装飾化): 公開項目の目標値は卓に見える情報。
                // 開示が進むとチップが埋まる=進捗の表現
                tns: hudInfoTnChips(resolved),
                // 判定ボタンは項目に1つ(2026-08-16 裁定)。公開項目・担当キャラクターあり・
                // 挑める技能行がある場合のみ。RL は判定しない(管理はパネル)
                canCheck: !game.user.isGM && row.isPublic && !!game.user.character
                    && infoDesignationRows(raw[i], nameByKey).length > 0,
            };
        }));
    }

    /** 情報収集判定の起動(項目の判定ボタン・14-9)。 */
    static async _onInfoCheck(event, target) {
        event.preventDefault();
        const { startInfoGatheringCheck } = await import("../flow/info-gathering.mjs");
        await startInfoGatheringCheck(target.dataset.itemId);
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
