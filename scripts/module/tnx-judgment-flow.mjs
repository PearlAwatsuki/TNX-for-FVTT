/**
 * @fileoverview TnxJudgmentFlow - 判定フローの状態管理と実行ロジック
 *
 * HUD 中心フロー:
 *   1. open(context) → ダイアログを開き、HUD を pending 状態に
 *   2. プレイヤーが HUD の有効スートカードをクリック
 *   3. executeFromHand(cardId) → 判定計算 → チャット投稿
 *
 * 特殊ケース:
 *   - A(numericValue=1): 11 か 21固定かをダイアログで選択
 *   - Joker(suit="joker"): スートと値を宣言
 *   - 切り札モード: 任意の手札1枚をJokerとして使い、切り札を消費
 *   - 山札から判定: デッキから1枚引いて制御判定 or 通常判定
 *
 * ルール正本: llm-wiki/01_Wiki/Game_Rules/Judgment_Rules.md
 */

import { getCardJudgmentValue, calcSkillCheck, calcControlCheck, ALL_SUITS } from './tnx-judgment-engine.mjs';
import { TnxActionHandler } from './tnx-action-handler.mjs';
import { TnxSocketHandler } from './tnx-socket-handler.mjs';
import { getUserFlagData } from './user-flag-schema.mjs';

/**
 * @typedef {object} JudgmentContext
 * @property {"skillCheck"|"controlCheck"|"abilityCheck"} type - 判定種別
 * @property {string}        actorId          - 判定を行うキャスト Actor ID
 * @property {string[]}      skillIds         - 使用技能 Item ID（能力値判定は空）
 * @property {string}        skillLabel       - 表示用技能名 "〈電脳〉+〈ハッキング〉" 等
 * @property {string[]}      validSuits       - 使用可能スート ["spade","heart"] 等
 * @property {number|null}   targetValue      - 目標値（未決定は null）
 * @property {number}        bountyAvailable  - 使用可能報酬点
 * @property {string|null}   requestMessageId - RL 要求 ChatMessage ID（自発判定は null）
 */

const SUIT_LABELS = Object.freeze({
    spade:   "♠ スペード（理性）",
    club:    "♣ クラブ（感情）",
    heart:   "♥ ハート（生命）",
    diamond: "♦ ダイヤ（外界）",
});

export class TnxJudgmentFlow {

    /** @type {JudgmentContext|null} */
    static _context = null;

    /** 切り札モード: 任意の手札を Joker として扱う */
    static _trumpMode = false;

    /** ダイアログクラスの参照（tnx.mjs で注入） */
    static dialogClass = null;

    static get isPending()  { return TnxJudgmentFlow._context !== null; }
    static get context()    { return TnxJudgmentFlow._context; }
    static get trumpMode()  { return TnxJudgmentFlow._trumpMode; }

    // ─── 公開 API ──────────────────────────────────────────────────────────────

    /**
     * 判定コンテキストを設定してダイアログを開く。
     * @param {JudgmentContext} context
     */
    static async open(context) {
        TnxJudgmentFlow.cancel({ _noRefresh: true });
        TnxJudgmentFlow._context   = foundry.utils.deepClone(context);
        TnxJudgmentFlow._trumpMode = false;

        if (TnxJudgmentFlow.dialogClass) {
            await new TnxJudgmentFlow.dialogClass().render(true);
        }
        game.tnx.hud?.render(false);
    }

    /**
     * 判定を中止してダイアログを閉じる。
     */
    static cancel({ _noRefresh = false } = {}) {
        if (!TnxJudgmentFlow._context) return;
        TnxJudgmentFlow._context   = null;
        TnxJudgmentFlow._trumpMode = false;
        TnxJudgmentFlow._closeDialog();
        if (!_noRefresh) game.tnx.hud?.render(false);
    }

    /**
     * 切り札モードを切り替える。
     */
    static toggleTrumpMode() {
        TnxJudgmentFlow._trumpMode = !TnxJudgmentFlow._trumpMode;
        TnxJudgmentFlow._refreshDialog();
        game.tnx.hud?.render(false);
    }


    /**
     * 手札カードをクリックして判定を実行する（HUD _onPlayCard から呼ぶ）。
     * @param {string} cardId
     * @returns {Promise<boolean>}  true = 判定実行, false = キャンセル / 無効
     */
    static async executeFromHand(cardId) {
        const ctx = TnxJudgmentFlow._context;
        if (!ctx) return false;

        const userFlag = getUserFlagData(game.user);
        const hand     = userFlag.handPileId ? await fromUuid(userFlag.handPileId) : null;
        if (!hand) return false;

        const card = hand.cards.get(cardId);
        if (!card) return false;

        // 切り札モード: 選択したカードを Joker として使い、切り札を消費
        if (TnxJudgmentFlow._trumpMode) {
            return TnxJudgmentFlow._executeAsTrumpJoker(card, userFlag, ctx);
        }

        const isJoker = TnxJudgmentFlow._isJoker(card);

        // Joker カード: スートとランクを宣言し、通常カードと同じルールで計算する
        if (isJoker) {
            const declared = await TnxJudgmentFlow._promptJokerDeclaration();
            if (!declared) return false;
            const { suit: declaredSuit, numericValue } = declared;

            // スート不一致 → 判定不成立による失敗（プレイヤーは失敗する権利を持つ）
            if (!ctx.validSuits.includes(declaredSuit)) {
                return TnxJudgmentFlow._execute({
                    card, cardJudgmentValue: null, suit: declaredSuit, ctx, suitMismatch: true,
                });
            }

            // A → Ace 選択ダイアログ（制御判定を除く）
            if (numericValue === 1 && ctx.type !== "controlCheck") {
                return TnxJudgmentFlow._handleAceChoice(card, declaredSuit, ctx);
            }

            const cardJudgmentValue = getCardJudgmentValue({ numericValue });
            return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit: declaredSuit, ctx });
        }

        const suit = TnxJudgmentFlow._normalizeSuit(card.suit);

        // スート不一致 → 判定不成立による失敗（起動は拒否しない。カードをプレイしてチャットに投稿）
        if (!suit || !ctx.validSuits.includes(suit)) {
            return TnxJudgmentFlow._execute({
                card, cardJudgmentValue: null, suit: suit ?? "spade", ctx, suitMismatch: true,
            });
        }

        // A: 11 か 21固定を選択（制御判定は選択不要）
        if (card.value === 1 && ctx.type !== "controlCheck") {
            return TnxJudgmentFlow._handleAceChoice(card, suit, ctx);
        }

        // 通常カード
        const cardJudgmentValue = getCardJudgmentValue({ numericValue: card.value });
        return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit, ctx });
    }

    /**
     * 山札から1枚引いて判定する（ダイアログの「山札から判定」ボタンから呼ぶ）。
     */
    static async executeFromDeck() {
        const ctx = TnxJudgmentFlow._context;
        if (!ctx) return;

        const deck    = await TnxActionHandler.getActiveDeck();
        const discard = await TnxActionHandler.getActiveDiscardPile();

        if (!deck || deck.availableCards.length === 0) {
            return ui.notifications.warn("山札にカードがありません。");
        }
        if (!discard) {
            return ui.notifications.warn("捨て札が設定されていません。");
        }

        // 山札から捨て札へ1枚引く（表向き）
        const drawnCards = await discard.draw(deck, 1, { render: false, chatNotification: false });
        if (!drawnCards.length) return;
        const drawnCard = drawnCards[0];
        await discard.updateEmbeddedDocuments("Card", [{ _id: drawnCard.id, face: 0 }]);

        // draw() 直後のカードは裏向き(face:-1)のため card.suit が null になる。
        // updateEmbeddedDocuments await 後に捨て札山から再取得して表向き状態のスートを読む。
        const card  = discard.cards.get(drawnCard.id) ?? drawnCard;

        const isJoker = TnxJudgmentFlow._isJoker(card);
        const suit    = isJoker ? null : TnxJudgmentFlow._normalizeSuit(card.suit);

        // Joker: スートとランクを宣言し、通常カードと同じルールで計算する
        if (isJoker) {
            const declared = await TnxJudgmentFlow._promptJokerDeclaration({ title: "Joker の宣言（山札から）" });
            if (!declared) { TnxJudgmentFlow.cancel(); return; }
            const { suit: declaredSuit, numericValue } = declared;

            // A → Ace 選択ダイアログ（制御判定を除く）
            if (numericValue === 1 && ctx.type !== "controlCheck") {
                return TnxJudgmentFlow._handleAceChoice(card, declaredSuit, ctx, { fromDeck: true });
            }

            const cardJudgmentValue = getCardJudgmentValue({ numericValue, isFromDeck: true });

            // 絵札宣言 → FUMBLE（山札引き特有ルール）
            if (cardJudgmentValue === "FUMBLE") {
                return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit: declaredSuit, ctx, fromDeck: true });
            }

            // スート不一致 → 判定不成立による失敗
            if (!ctx.validSuits.includes(declaredSuit)) {
                return TnxJudgmentFlow._execute({
                    card, cardJudgmentValue: null, suit: declaredSuit, ctx, fromDeck: true, suitMismatch: true,
                });
            }

            return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit: declaredSuit, ctx, fromDeck: true });
        }

        // 山札判定: 絵札 → FUMBLE（スート不一致チェックより先）
        const cardJudgmentValue = getCardJudgmentValue({ numericValue: card.value, isFromDeck: true });
        if (cardJudgmentValue === "FUMBLE") {
            return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit: suit ?? ctx.validSuits[0] ?? "spade", ctx, fromDeck: true });
        }

        // スート不一致 → 判定不成立による失敗（手札判定と同様）
        if (!suit || !ctx.validSuits.includes(suit)) {
            return TnxJudgmentFlow._execute({
                card, cardJudgmentValue: null, suit: suit ?? "spade", ctx, fromDeck: true, suitMismatch: true,
            });
        }

        return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit, ctx, fromDeck: true });
    }

    // ─── プライベートヘルパー ──────────────────────────────────────────────────

    static _normalizeSuit(rawSuit) {
        const s = (rawSuit ?? "").toLowerCase();
        if (s === "spades"   || s === "spade")   return "spade";
        if (s === "clubs"    || s === "club")     return "club";
        if (s === "hearts"   || s === "heart")    return "heart";
        if (s === "diamonds" || s === "diamond")  return "diamond";
        return null;
    }

    static _isJoker(card) {
        return card.suit === "joker" || card.value === 99;
    }

    static async _promptJokerDeclaration({ title = "Joker の宣言" } = {}) {
        const suitOptions = ALL_SUITS.map(s => `<option value="${s}">${SUIT_LABELS[s] ?? s}</option>`).join("");
        const rankOptions = [
            ["A", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7],
            ["8", 8], ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13],
        ].map(([label, v]) => `<option value="${v}">${label}</option>`).join("");
        return foundry.applications.api.DialogV2.wait({
            window:   { title },
            classes:  ["tokyo-nova"],
            position: { width: 360 },
            content:  `<form autocomplete="off">
<div class="form-group"><label>スート</label><select name="suit">${suitOptions}</select></div>
<div class="form-group"><label>ランク</label><select name="numericValue">${rankOptions}</select></div>
</form>`,
            buttons: [
                {
                    action:   "ok",
                    icon:     "fas fa-check",
                    label:    "確定",
                    default:  true,
                    callback: (_event, _button, dialog) => ({
                        suit:         dialog.element.querySelector("[name=suit]").value,
                        numericValue: parseInt(dialog.element.querySelector("[name=numericValue]").value),
                    }),
                },
                {
                    action:   "cancel",
                    icon:     "fas fa-times",
                    label:    "キャンセル",
                    callback: () => null,
                },
            ],
            close: () => null,
        });
    }

    static async _chooseSuit(validSuits) {
        const buttons = validSuits.map((s, i) => ({
            action:  s,
            label:   SUIT_LABELS[s] ?? s,
            default: i === 0,
        }));
        buttons.push({ action: "cancel", label: "キャンセル", icon: "fas fa-times" });
        return foundry.applications.api.DialogV2.wait({
            window:       { title: "スートを選択" },
            content:      "<p>判定に使用するスートを選んでください。</p>",
            buttons,
            rejectClose:  false,
        });
    }

    static async _handleAceChoice(card, suit, ctx, extraParams = {}) {
        const choice = await foundry.applications.api.DialogV2.wait({
            window:  { title: "A の使い方" },
            content: "<p>A をどちらとして使いますか？</p>",
            buttons: [
                { action: "eleven",  label: "11 として使う",     default: true },
                { action: "fixed21", label: "21 固定（完全固定）"              },
                { action: "cancel",  label: "キャンセル",         icon: "fas fa-times" },
            ],
            rejectClose: false,
        });
        if (!choice || choice === "cancel") return false;

        const fixedAt21         = choice === "fixed21";
        const cardJudgmentValue = getCardJudgmentValue({ numericValue: 1, fixedAt21 });
        return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit, ctx, ...extraParams });
    }

    static async _executeAsTrumpJoker(card, userFlag, ctx) {
        const trumpPile = userFlag.trumpCardPileId ? await fromUuid(userFlag.trumpCardPileId) : null;
        const trumpCard = trumpPile?.cards.contents[0];

        if (!trumpCard) {
            ui.notifications.warn("切り札がありません。");
            return false;
        }

        const declared = await TnxJudgmentFlow._promptJokerDeclaration({ title: "切り札: Joker として宣言" });
        if (!declared) return false;

        const { suit: declaredSuit, numericValue } = declared;

        // 切り札を消費（RL切り札捨て場へ）
        await TnxActionHandler.useTrump(trumpCard.id);

        // スート不一致 → 判定不成立による失敗
        if (!ctx.validSuits.includes(declaredSuit)) {
            return TnxJudgmentFlow._execute({
                card, cardJudgmentValue: null, suit: declaredSuit, ctx, suitMismatch: true, trumpUsed: true,
            });
        }

        // A → Ace 選択ダイアログ（制御判定を除く）
        if (numericValue === 1 && ctx.type !== "controlCheck") {
            return TnxJudgmentFlow._handleAceChoice(card, declaredSuit, ctx, { trumpUsed: true });
        }

        const cardJudgmentValue = getCardJudgmentValue({ numericValue });
        return TnxJudgmentFlow._execute({ card, cardJudgmentValue, suit: declaredSuit, ctx, trumpUsed: true });
    }

    /**
     * キャスト Actor の能力値実効値コンテキストを構築する。
     * tnx-cast-sheet.mjs の _getAbilitiesData と同じ計算式。
     */
    static _buildAbilitiesCtx(actor) {
        const equippedStyles = actor.items.filter(i => i.type === "style" && i.system.equipped);
        const sys      = actor.system;
        const outfitMod = sys.outfitMod ?? {};
        const abilities = {};
        for (const key of ["reason", "passion", "life", "mundane"]) {
            const ab = sys[key] ?? {};
            let sv = 0, sc = 0;
            for (const style of equippedStyles) {
                sv += (style.system[key]?.value   ?? 0) * (style.system.level || 1);
                sc += (style.system[key]?.control ?? 0) * (style.system.level || 1);
            }
            abilities[key] = {
                totalValue:   (ab.growth ?? 0) + sv + (ab.mod ?? 0) + (ab.effectMod ?? 0) + (outfitMod[key] ?? 0),
                totalControl: (ab.controlGrowth ?? 0) + sc + (ab.controlMod ?? 0) + (ab.controlEffectMod ?? 0) + (outfitMod.control ?? 0),
            };
        }
        return abilities;
    }

    /**
     * カード選択後に報酬点の消費数を入力させる。
     * 報酬点が 0 の場合や制御判定・スート不一致の場合は呼び出さない。
     * ダイアログをキャンセルした場合は 0 を返す。
     * @param {number} bountyAvailable
     * @returns {Promise<number>}
     */
    static async _promptBountyUsage(bountyAvailable, { baseAchievement = null } = {}) {
        if (!bountyAvailable || bountyAvailable <= 0) return 0;

        const spinnerContent = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
            { label: `使用する報酬点（0〜${bountyAvailable}）`, initialValue: 0, min: 0, max: bountyAvailable },
        );

        const achievementRow = baseAchievement !== null
            ? `<p>現在の達成値: <strong>${baseAchievement}</strong>（報酬点1点 = +1 加算）</p>`
            : `<p>報酬点を消費すると達成値に加算されます（1点 = +1）。</p>`;

        const result = await foundry.applications.api.DialogV2.wait({
            window:   { title: "報酬点の使用" },
            classes:  ["tokyo-nova", "tnx-amount-dialog"],
            position: { width: 480 },
            content:  `${achievementRow}${spinnerContent}`,
            actions: {
                decrement: (_event, target) => {
                    target.closest(".number-input-spinner")?.querySelector("input[type='number']")?.stepDown();
                },
                increment: (_event, target) => {
                    target.closest(".number-input-spinner")?.querySelector("input[type='number']")?.stepUp();
                },
            },
            buttons: [
                {
                    action:   "ok",
                    icon:     "fas fa-check",
                    label:    "確定",
                    default:  true,
                    callback: (_event, _button, dialog) => {
                        const raw = parseInt(dialog.element.querySelector("[name=amount]")?.value) || 0;
                        return Math.max(0, Math.min(raw, bountyAvailable));
                    },
                },
                {
                    action:   "cancel",
                    icon:     "fas fa-times",
                    label:    "使用しない",
                    callback: () => 0,
                },
            ],
            close: () => 0,
        });

        return result ?? 0;
    }

    /**
     * 用途起動前に使用回数の消費を確認する（D&D 方式の消費ダイアログ）。
     * 原則ブロック: チェック済みで残り0の技能があれば起動不可。チェックを外せば消費せず判定可能。
     * @param {Actor} actor
     * @param {string[]} skillIds  参加技能（ベース＋コンボ）の Item ID
     * @returns {Promise<{consumeIds: string[]}|null>}  null = キャンセル / ブロック
     */
    static async planUsesConsumption(actor, skillIds) {
        if (!actor) return { consumeIds: [] };
        const limited = (skillIds ?? [])
            .map(id => actor.items.get(id))
            .filter(s => s && s.system.uses?.isLimit === true);
        if (!limited.length) return { consumeIds: [] };

        const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
        const remainingOf = (u) => Math.max(0, (u.max ?? 0) - (u.spent ?? 0));
        const rows = limited.map(s => {
            const u = s.system.uses;
            const remaining = remainingOf(u);
            const out = remaining <= 0;
            return `<div class="tnx-uses-row">
                <label>
                    <input type="checkbox" name="consume" value="${esc(s.id)}" checked>
                    <span>「${esc(s.name)}」の使用回数を消費</span>
                </label>
                <span class="tnx-uses-count${out ? " tnx-uses-out" : ""}">残り ${remaining}/${u.max ?? 0}</span>
            </div>`;
        }).join("");

        const content = `<div class="tnx-uses-consume">
            <p class="tnx-uses-note">使用する技能の使用回数を消費します。チェックを外すと消費せずに判定します。</p>
            ${rows}
        </div>`;

        const result = await foundry.applications.api.DialogV2.wait({
            window:   { title: "使用回数の消費" },
            classes:  ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
            position: { width: 380 },
            content,
            buttons: [
                {
                    action: "ok", icon: "fas fa-check", label: "判定する", default: true,
                    callback: (event, button, dialog) =>
                        [...dialog.element.querySelectorAll('input[name="consume"]:checked')].map(cb => cb.value),
                },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });

        if (!result) return null; // キャンセル

        // 原則ブロック: チェック済みで残り0の技能があれば起動不可
        for (const id of result) {
            const s = actor.items.get(id);
            const u = s?.system.uses;
            if (u && ((u.max ?? 0) - (u.spent ?? 0)) <= 0) {
                ui.notifications.warn(`「${s.name}」の使用回数が残っていません。消費チェックを外すと判定できます。`);
                return null;
            }
        }
        return { consumeIds: result };
    }

    /**
     * 参加技能の使用回数を実際に消費する（判定実行時に呼ぶ）。
     * @param {Actor} actor
     * @param {string[]} skillIds  消費対象の Item ID
     */
    static async _consumeUses(actor, skillIds) {
        if (!actor || !skillIds?.length) return;
        const updates = [];
        for (const id of skillIds) {
            const s = actor.items.get(id);
            const u = s?.system.uses;
            if (!u || u.isLimit !== true) continue;
            updates.push({ _id: id, "system.uses.spent": Math.min(u.max ?? 0, (u.spent ?? 0) + 1) });
        }
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }

    static async _execute({ card, cardJudgmentValue, suit, ctx, fromDeck = false, trumpUsed = false, suitMismatch = false }) {
        const actor = game.actors.get(ctx.actorId);
        if (!actor) {
            ui.notifications.error("判定するキャストが見つかりません。");
            TnxJudgmentFlow.cancel();
            return false;
        }

        // ダイアログを閉じて判定状態をクリア（カード選択後に即時）
        TnxJudgmentFlow._context   = null;
        TnxJudgmentFlow._trumpMode = false;
        TnxJudgmentFlow._closeDialog();

        // 手札からカードをプレイ（山札から判定の場合は既に捨て札にある）
        if (!fromDeck) {
            await TnxActionHandler.playCard(card.id);
            // 手札を使用した直後に上限まで自動補充
            await TnxActionHandler.autoReplenishHand();
        }

        game.tnx.hud?.render(false);

        // 用途起動による使用回数の消費（参加技能。組み合わせ技能の遠隔消費を含む）
        // 起動時の消費ダイアログで確定した consumeUses を判定実行時に適用する（キャンセル時は未到達＝非消費）
        if (ctx.consumeUses?.length) {
            await TnxJudgmentFlow._consumeUses(actor, ctx.consumeUses);
        }

        // 能力値コンテキストを先に構築（報酬点プレビュー計算と本計算で共用）
        const abilitiesCtx = suitMismatch ? null : TnxJudgmentFlow._buildAbilitiesCtx(actor);

        // 報酬点の使用を決定（スート不一致・制御判定・ファンブル確定はスキップ）
        let bountyUsed = 0;
        if (!suitMismatch && ctx.type !== "controlCheck" && cardJudgmentValue !== "FUMBLE") {
            // 報酬点 0 時のベース達成値を先計算してダイアログに表示
            const baseResult       = calcSkillCheck({ cardJudgmentValue, suit, abilitiesCtx, bountyUsed: 0, targetValue: ctx.targetValue });
            const baseAchievement  = typeof baseResult.achievement === "number" ? baseResult.achievement : null;
            bountyUsed = await TnxJudgmentFlow._promptBountyUsage(ctx.bountyAvailable ?? 0, { baseAchievement });
        }

        // 判定結果の計算
        let result;
        if (suitMismatch) {
            // スート不一致 → 判定不成立。不成立ゆえに達成値 0 の失敗（カードはプレイされる）
            result = {
                fumble:      false,
                achievement: 0,
                cardValue:   0,
                abilityVal:  0,
                bountyUsed:  0,
                targetValue: ctx.targetValue,
                diff:        ctx.targetValue !== null ? -ctx.targetValue : null,
                success:     false,
            };
        } else {
            if (ctx.type === "controlCheck") {
                result = calcControlCheck({ cardJudgmentValue, suit, abilitiesCtx });
            } else {
                result = calcSkillCheck({ cardJudgmentValue, suit, abilitiesCtx, bountyUsed, targetValue: ctx.targetValue });
            }
        }

        // チャットに結果を投稿
        await TnxJudgmentFlow._postResultChat({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch });

        // RL 要求フロー: GM に結果を送信
        if (ctx.requestMessageId) {
            TnxSocketHandler.emitJudgmentResult(ctx.requestMessageId, ctx.actorId, result);
        }

        return true;
    }

    static async _postResultChat({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch = false }) {
        const actor = game.actors.get(ctx.actorId);
        const SUIT_SYMBOL   = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
        const TYPE_LABEL    = { skillCheck: "技能判定", controlCheck: "制御判定", abilityCheck: "能力値判定" };
        const ABILITY_LABEL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };

        const isControlCheck = ctx.type === "controlCheck";
        const content = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/judgment-result.hbs",
            {
                actor,
                actorName:    actor?.name ?? "不明",
                typeLabel:    TYPE_LABEL[ctx.type] ?? ctx.type,
                skillLabel:   ctx.skillLabel,
                cardImg:      card.img,
                cardName:     card.name,
                suit,
                suitSymbol:   SUIT_SYMBOL[suit] ?? "",
                abilityLabel: ABILITY_LABEL[result.abilityKey] ?? "",
                result,
                isControlCheck,
                isFixed21:    result.fixedAt21 === true,
                hasTargetValue: ctx.targetValue !== null,
                showSuccess:  !isControlCheck ? (ctx.targetValue !== null && !result.fumble) : !result.fumble,
                fromDeck,
                trumpUsed,
                suitMismatch,
            }
        );

        await ChatMessage.create({
            content,
            speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
            flags: {
                "tokyo-nova-axleration": {
                    judgmentResult: { actorId: ctx.actorId, result },
                },
            },
        });
    }

    static _closeDialog() {
        for (const app of foundry.applications.instances.values()) {
            if (app.id === "tnx-judgment-dialog") {
                app.close({ animate: false });
                break;
            }
        }
    }

    static _refreshDialog() {
        for (const app of foundry.applications.instances.values()) {
            if (app.id === "tnx-judgment-dialog") {
                app.render(false);
                break;
            }
        }
    }
}
