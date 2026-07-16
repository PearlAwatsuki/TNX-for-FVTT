/**
 * @fileoverview TnxCheckFlow - 判定フローの状態管理と実行ロジック
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
 * ルール正本: llm-wiki/01_Wiki/Game_Rules/Check_Rules.md
 */

import { getCardCheckValue, calcSkillCheck, calcControlCheck, normalizeSuit, ALL_SUITS, SUIT_TO_ABILITY } from './tnx-check-engine.mjs';
import { gatherCheckBonusSources, collectActorEffectBuffs, actorHasSuitChangeBuff, actorCardValueOverride, readFlag } from '../data/item/helpers.mjs';
import { evaluateBonusRows, evaluateSelfBonus } from './tnx-formula.mjs';
import { getEffectiveConditions, gatherConditionCheckSources, getCheckBlock, gatherSkillUseWarnings, computeJammingPenalty, hasBountyBlock } from './conditions.mjs';
import { TnxActionHandler } from './tnx-action-handler.mjs';
import { TnxSocketHandler } from './tnx-socket-handler.mjs';
import { getUserFlagData } from './user-flag-schema.mjs';
import { applyConsumptionPlan } from './usage-consumption.mjs';

/**
 * @typedef {object} CheckContext
 * @property {"skillCheck"|"controlCheck"|"abilityCheck"} type - 判定種別
 * @property {string}        actorId          - 判定を行うキャスト Actor ID
 * @property {string[]}      skillIds         - 使用技能 Item ID（能力値判定は空）
 * @property {string}        skillLabel       - 表示用技能名 "〈電脳〉+〈ハッキング〉" 等
 * @property {string[]}      validSuits       - 使用可能スート ["spade","heart"] 等
 * @property {number|null}   targetValue      - 目標値（未決定は null）
 * @property {number}        bountyAvailable  - 使用可能報酬点
 * @property {string|null}   requestMessageId - RL 要求 ChatMessage ID（自発判定は null）
 */

/** カードの生の数字→表記(A/J/Q/K・その他は数字)。 */
const CARD_NUM_LABEL = (n) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[n] ?? String(n));

const SUIT_LABELS = Object.freeze({
    spade:   "♠ スペード（理性）",
    club:    "♣ クラブ（感情）",
    heart:   "♥ ハート（生命）",
    diamond: "♦ ダイヤ（外界）",
});

export class TnxCheckFlow {

    /** @type {CheckContext|null} */
    static _context = null;

    /** 切り札モード: 任意の手札を Joker として扱う */
    static _trumpMode = false;

    /** ダイアログクラスの参照（tnx.mjs で注入） */
    static dialogClass = null;

    static get isPending()  { return TnxCheckFlow._context !== null; }
    static get context()    { return TnxCheckFlow._context; }
    static get trumpMode()  { return TnxCheckFlow._trumpMode; }

    // ─── 公開 API ──────────────────────────────────────────────────────────────

    /**
     * 判定コンテキストを設定してダイアログを開く。
     * @param {CheckContext} context
     */
    static async open(context) {
        // 判定起動時点のブロック(警告を出して開かない): 負傷の技能使用不可・重圧の能力値判定。
        // ②使用不可は 2026-07-16 改訂で「警告のみ」→重圧に合わせて完全ブロックへ(ユーザー裁定)。
        const blockReason = TnxCheckFlow._activationBlockReason(context);
        if (blockReason) { ui.notifications.warn(blockReason); return; }

        TnxCheckFlow.cancel({ _noRefresh: true });
        TnxCheckFlow._context   = foundry.utils.deepClone(context);
        TnxCheckFlow._trumpMode = false;

        if (TnxCheckFlow.dialogClass) {
            await new TnxCheckFlow.dialogClass().render(true);
        }
        game.tnx.hud?.render(false);
    }

    /**
     * 判定の起動をブロックすべき理由(警告文)を返す。無ければ null。
     * - 技能使用不可(負傷 skillBlock): 参加技能(組み合わせ含む)に該当があれば起動不可。技能の識別は
     *   名前でなく識別キーで行い、選択型(社会/コネ)は付与時に確定した targetSkill を用いる。
     * - 能力値判定 × 重圧: 対象能力値の能力値判定は起動不可(制御判定は可)。技能判定の重圧は
     *   使うスート=能力値がカードで決まるためカードプレイ時(_execute)で判定する。
     * @param {CheckContext} context
     * @returns {?string}
     */
    static _activationBlockReason(context) {
        const actor = game.actors.get(context?.actorId);
        if (!actor) return null;
        const conds = TnxCheckFlow._gatherConditions(actor);

        if (context?.skillIds?.length) {
            const skillKeys = context.skillIds
                .map(id => actor.items.get(id)?.system?.identificationKey)
                .filter(Boolean);
            const warns = gatherSkillUseWarnings(conds, skillKeys);
            if (warns.length) return `「${warns.join("」「")}」により、この判定に使う技能は使用不可です。`;
        }
        if (context?.type === "abilityCheck") {
            const block = getCheckBlock(conds, { upward: true, ability: SUIT_TO_ABILITY[context.validSuits?.[0]] });
            if (block.blocked) return `「${block.by}」により、その能力値を使う判定はできません。`;
        }
        return null;
    }

    /**
     * 判定を中止してダイアログを閉じる。
     */
    static cancel({ _noRefresh = false } = {}) {
        if (!TnxCheckFlow._context) return;
        TnxCheckFlow._context   = null;
        TnxCheckFlow._trumpMode = false;
        TnxCheckFlow._closeDialog();
        if (!_noRefresh) game.tnx.hud?.render(false);
    }

    /**
     * 切り札モードを切り替える。
     */
    static toggleTrumpMode() {
        TnxCheckFlow._trumpMode = !TnxCheckFlow._trumpMode;
        TnxCheckFlow._refreshDialog();
        game.tnx.hud?.render(false);
    }

    /**
     * 状況修正(手動)を設定する(判定ダイアログのスピナーから・2026-07-14 ユーザー確定)。
     * 通常判定=達成値へ加算・制御判定=制御値(成功条件)へ加算。カードプレイ時に読まれる。
     */
    static setManualMod(value) {
        if (TnxCheckFlow._context) TnxCheckFlow._context.manualMod = Number(value) || 0;
    }

    /**
     * スタン/説得の宣言を設定する(攻撃の判定ダイアログのトグルから・2026-07-15 ユーザー確定)。
     * 攻撃ペイロードに載り、攻撃カード→ダメージカードへ引き継がれ、攻撃側合計を10上限にする。
     */
    static setStunDeclared(value) {
        if (TnxCheckFlow._context?.attack) TnxCheckFlow._context.attack.stunDeclared = value === true;
    }


    /**
     * 手札カードをクリックして判定を実行する（HUD _onPlayCard から呼ぶ）。
     * @param {string} cardId
     * @returns {Promise<boolean>}  true = 判定実行, false = キャンセル / 無効
     */
    static async executeFromHand(cardId) {
        const ctx = TnxCheckFlow._context;
        if (!ctx) return false;

        const userFlag = getUserFlagData(game.user);
        const hand     = userFlag.handPileId ? await fromUuid(userFlag.handPileId) : null;
        if (!hand) return false;

        const card = hand.cards.get(cardId);
        if (!card) return false;

        // 切り札モード: 選択したカードを Joker として使い、切り札を消費
        if (TnxCheckFlow._trumpMode) {
            return TnxCheckFlow._executeAsTrumpJoker(card, userFlag, ctx);
        }

        const isJoker = TnxCheckFlow._isJoker(card);

        // Joker カード: スートとランクを宣言し、通常カードと同じルールで計算する
        if (isJoker) {
            const declared = await TnxCheckFlow._promptJokerDeclaration();
            if (!declared) return false;
            const { suit: declaredSuit, numericValue } = declared;

            // スート不一致 → 判定不成立による失敗（プレイヤーは失敗する権利を持つ）
            if (!ctx.validSuits.includes(declaredSuit)) {
                return TnxCheckFlow._execute({
                    card, cardCheckValue: null, suit: declaredSuit, ctx, suitMismatch: true,
                });
            }

            // A → Ace 選択ダイアログ（制御判定を除く）
            if (numericValue === 1 && ctx.type !== "controlCheck") {
                return TnxCheckFlow._handleAceChoice(card, declaredSuit, ctx);
            }

            const cardCheckValue = getCardCheckValue({ numericValue });
            return TnxCheckFlow._execute({ card, cardCheckValue, suit: declaredSuit, ctx });
        }

        const suit = TnxCheckFlow._normalizeSuit(card.suit);

        // カード数字の上書き(AE check.cardValue・2026-07-13): 出したカードの数字を A〜K として
        // 扱い直す(以降の規約=A の21固定選択などは上書き後の数字に従う)。ジョーカー/切り札の
        // 宣言には適用しない。無印「判定」の機構のため制御判定は対象外
        const cardNumeric = TnxCheckFlow._cardValueOverride(ctx) ?? card.value;
        const cardOverride = cardNumeric !== card.value ? { from: card.value, to: cardNumeric } : null;

        // スート不一致 → スート変更(2026-07-12)があれば使用可能スートへ置き換えて成立、
        // なければ判定不成立による失敗（起動は拒否しない。カードをプレイしてチャットに投稿）
        if (!suit || !ctx.validSuits.includes(suit)) {
            const changed = await TnxCheckFlow._trySuitChange(suit, ctx);
            if (changed) {
                if (cardNumeric === 1 && ctx.type !== "controlCheck") {
                    return TnxCheckFlow._handleAceChoice(card, changed, ctx, { suitChangedFrom: suit ?? null, cardOverride });
                }
                return TnxCheckFlow._execute({
                    card, cardCheckValue: getCardCheckValue({ numericValue: cardNumeric }),
                    suit: changed, ctx, suitChangedFrom: suit ?? null, cardOverride,
                });
            }
            return TnxCheckFlow._execute({
                card, cardCheckValue: null, suit: suit ?? "spade", ctx, suitMismatch: true,
            });
        }

        // A: 11 か 21固定を選択（制御判定は選択不要）
        if (cardNumeric === 1 && ctx.type !== "controlCheck") {
            return TnxCheckFlow._handleAceChoice(card, suit, ctx, { cardOverride });
        }

        // 通常カード
        const cardCheckValue = getCardCheckValue({ numericValue: cardNumeric });
        return TnxCheckFlow._execute({ card, cardCheckValue, suit, ctx, cardOverride });
    }

    /**
     * 山札から1枚引いて判定する（ダイアログの「山札から判定」ボタンから呼ぶ）。
     */
    static async executeFromDeck() {
        const ctx = TnxCheckFlow._context;
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

        const isJoker = TnxCheckFlow._isJoker(card);
        const suit    = isJoker ? null : TnxCheckFlow._normalizeSuit(card.suit);

        // Joker: スートとランクを宣言し、通常カードと同じルールで計算する
        if (isJoker) {
            const declared = await TnxCheckFlow._promptJokerDeclaration({ title: "Joker の宣言（山札から）" });
            if (!declared) { TnxCheckFlow.cancel(); return; }
            const { suit: declaredSuit, numericValue } = declared;

            // A → Ace 選択ダイアログ（制御判定を除く）
            if (numericValue === 1 && ctx.type !== "controlCheck") {
                return TnxCheckFlow._handleAceChoice(card, declaredSuit, ctx, { fromDeck: true });
            }

            const cardCheckValue = getCardCheckValue({ numericValue, isFromDeck: true });

            // 絵札宣言 → FUMBLE（山札引き特有ルール）
            if (cardCheckValue === "FUMBLE") {
                return TnxCheckFlow._execute({ card, cardCheckValue, suit: declaredSuit, ctx, fromDeck: true });
            }

            // スート不一致 → 判定不成立による失敗
            if (!ctx.validSuits.includes(declaredSuit)) {
                return TnxCheckFlow._execute({
                    card, cardCheckValue: null, suit: declaredSuit, ctx, fromDeck: true, suitMismatch: true,
                });
            }

            return TnxCheckFlow._execute({ card, cardCheckValue, suit: declaredSuit, ctx, fromDeck: true });
        }

        // カード数字の上書き(AE check.cardValue・2026-07-13): 山札でも上書き後の数字に規約が従う
        // (K 等へ上書きすれば山札の絵札=FUMBLE)。制御判定は対象外
        const cardNumeric = TnxCheckFlow._cardValueOverride(ctx) ?? card.value;
        const cardOverride = cardNumeric !== card.value ? { from: card.value, to: cardNumeric } : null;

        // 山札判定: 絵札 → FUMBLE（スート不一致チェックより先）
        const cardCheckValue = getCardCheckValue({ numericValue: cardNumeric, isFromDeck: true });
        if (cardCheckValue === "FUMBLE") {
            return TnxCheckFlow._execute({ card, cardCheckValue, suit: suit ?? ctx.validSuits[0] ?? "spade", ctx, fromDeck: true, cardOverride });
        }

        // スート不一致 → スート変更(2026-07-12)があれば置き換え、なければ不成立（手札判定と同様）
        if (!suit || !ctx.validSuits.includes(suit)) {
            const changed = await TnxCheckFlow._trySuitChange(suit, ctx);
            if (changed) {
                if (cardNumeric === 1 && ctx.type !== "controlCheck") {
                    return TnxCheckFlow._handleAceChoice(card, changed, ctx, { fromDeck: true, suitChangedFrom: suit ?? null, cardOverride });
                }
                return TnxCheckFlow._execute({ card, cardCheckValue, suit: changed, ctx, fromDeck: true, suitChangedFrom: suit ?? null, cardOverride });
            }
            return TnxCheckFlow._execute({
                card, cardCheckValue: null, suit: suit ?? "spade", ctx, fromDeck: true, suitMismatch: true,
            });
        }

        return TnxCheckFlow._execute({ card, cardCheckValue, suit, ctx, fromDeck: true, cardOverride });
    }

    // ─── プライベートヘルパー ──────────────────────────────────────────────────

    static _normalizeSuit(rawSuit) {
        return normalizeSuit(rawSuit); // 純関数へ委譲(tnx-check-engine・衰弱/重圧ドローと共用)
    }

    /** カード数字の上書き(AE check.cardValue・2026-07-13)。無印判定のみ(制御判定は対象外)。 */
    static _cardValueOverride(ctx) {
        if (ctx.type === "controlCheck") return null;
        const actor = game.actors.get(ctx.actorId);
        return actor ? actorCardValueOverride(actor) : null;
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

    /**
     * スート変更(2026-07-12 ユーザー確定): 「判定で使用できないスートのカードを、使用可能な
     * スートに変更する」能力の表現。発火点はスート不一致の置換——次のいずれかが有効なとき、
     * 不成立にせず使用可能スートの選択ダイアログを出して置き換える(それ以外の判定では出ない):
     * ①用途の「スート変更可能」(ctx.allowSuitChange・組み合わせたスタイル技能の効果の用途側設定)
     * ②付与された AE `check.suitChange`(他者バフの付与形。失効は当面手動＝「1回の判定」Duration
     *   は時間管理フェーズで持続時間側に足す。持続時間と AE キーは独立)
     * ③クリック待ち kind="suitChange"(次の自分の判定・アイテムロールで使用→待ち受け)
     * 無印の「判定」＝能力値判定/技能判定の機構のため**制御判定は対象外**(制御判定は常に明示される
     * =用語規約)。キャンセルは従来どおりスート不一致(不成立)。待ち受けの消費は適用確定時。
     * @param {string|null} originalSuit 出したカードの元スート(不明は null)
     * @param {object} ctx 判定コンテキスト
     * @returns {Promise<string|null>} 置き換え後のスート。null=変更しない(不成立へ)
     */
    static async _trySuitChange(originalSuit, ctx) {
        if (ctx.type === "controlCheck") return null;
        const actor = game.actors.get(ctx.actorId);
        const hasBuff = actor ? actorHasSuitChangeBuff(actor) : false;
        const armed = TnxCheckFlow.peekAchievementAction("suitChange");
        const armedMatch = armed && armed.actorId === ctx.actorId ? armed : null;
        if (ctx.allowSuitChange !== true && !hasBuff && !armedMatch) return null;
        if (!ctx.validSuits?.length) return null;
        const chosen = await TnxCheckFlow._chooseSuit(ctx.validSuits, {
            title: "スート変更",
            content: `<p>このカードのスート${originalSuit ? `（${SUIT_LABELS[originalSuit] ?? originalSuit}）` : ""}は判定に使用できません。使用可能なスートに変更しますか？（キャンセル＝スート不一致で不成立）</p>`,
        });
        if (!chosen || chosen === "cancel") return null;
        // 待ち受け(次の判定)からの発動は、用途設定・付与 AE が無い場合のみ消費する(非消費の源が優先)
        if (armedMatch && ctx.allowSuitChange !== true && !hasBuff) {
            TnxCheckFlow.cancelAchievementAction();
            if (armedMatch.consumeUses?.length) await applyConsumptionPlan(armedMatch.consumeUses);
        }
        return chosen;
    }

    static async _chooseSuit(validSuits, { title = "スートを選択", content = "<p>判定に使用するスートを選んでください。</p>" } = {}) {
        const buttons = validSuits.map((s, i) => ({
            action:  s,
            label:   SUIT_LABELS[s] ?? s,
            default: i === 0,
        }));
        buttons.push({ action: "cancel", label: "キャンセル", icon: "fas fa-times" });
        return foundry.applications.api.DialogV2.wait({
            window:       { title },
            content,
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
        const cardCheckValue = getCardCheckValue({ numericValue: 1, fixedAt21 });
        return TnxCheckFlow._execute({ card, cardCheckValue, suit, ctx, ...extraParams });
    }

    static async _executeAsTrumpJoker(card, userFlag, ctx) {
        const trumpPile = userFlag.trumpCardPileId ? await fromUuid(userFlag.trumpCardPileId) : null;
        const trumpCard = trumpPile?.cards.contents[0];

        if (!trumpCard) {
            ui.notifications.warn("切り札がありません。");
            return false;
        }

        const declared = await TnxCheckFlow._promptJokerDeclaration({ title: "切り札: Joker として宣言" });
        if (!declared) return false;

        const { suit: declaredSuit, numericValue } = declared;

        // 切り札を消費（RL切り札捨て場へ）
        await TnxActionHandler.useTrump(trumpCard.id);

        // スート不一致 → 判定不成立による失敗
        if (!ctx.validSuits.includes(declaredSuit)) {
            return TnxCheckFlow._execute({
                card, cardCheckValue: null, suit: declaredSuit, ctx, suitMismatch: true, trumpUsed: true,
            });
        }

        // A → Ace 選択ダイアログ（制御判定を除く）
        if (numericValue === 1 && ctx.type !== "controlCheck") {
            return TnxCheckFlow._handleAceChoice(card, declaredSuit, ctx, { trumpUsed: true });
        }

        const cardCheckValue = getCardCheckValue({ numericValue });
        return TnxCheckFlow._execute({ card, cardCheckValue, suit: declaredSuit, ctx, trumpUsed: true });
    }

    /**
     * キャスト Actor の能力値実効値コンテキストを構築する。
     * DataModel.prepareDerivedData が算出した実効値(system.<key>.total / .totalControl)を読む。
     * 旧実装は実在しない system.equipped でスタイルをフィルタしており、達成値からスタイル
     * 基本値が丸ごと欠落していた(KI-021)。一本化によりシート表示と同一の値になる。
     */
    static _buildAbilitiesCtx(actor) {
        const sys       = actor.system;
        const abilities = {};
        for (const key of ["reason", "passion", "life", "mundane"]) {
            const ab = sys[key] ?? {};
            abilities[key] = {
                totalValue:   ab.total        ?? 0,
                totalControl: ab.totalControl ?? 0,
            };
        }
        return abilities;
    }

    /**
     * 判定バフ(check./controlCheck.)を収集し、達成値に加える合計を返す(フェーズ9-3 v2)。
     * アクター自身＋全所有アイテムの effects を集め、判定種別に応じた criteria で照合する。
     * 同一効果の重複適用は不可(effect identity 単位・最大採用)。stackable はスタック。
     * @param {Actor} actor
     * @param {object} ctx  判定コンテキスト(type / skillIds 等)
     * @param {string} abilityKey  スートから決まる能力値キー
     * @returns {{total:number, sources:Array<{name:string, value:number}>}}
     */
    static _computeCheckBonus(actor, ctx, abilityKey) {
        if (!actor) return { total: 0, sources: [] };
        const effects = collectActorEffectBuffs(actor);

        let criteria;
        if (ctx.type === "controlCheck") {
            criteria = { type: "control", ability: abilityKey };
        } else if (ctx.type === "abilityCheck" || !(ctx.skillIds?.length)) {
            criteria = { type: "ability", ability: abilityKey };
        } else {
            // 識別キーに加え、スタイル(system.style)・組織(system.special.works.organization)も
            // criteria に載せ、check.style.<キー> / check.works.<キー> のグループ参照を可能にする。
            const skills = (ctx.skillIds ?? [])
                .map(id => actor.items.get(id))
                .filter(it => it?.system?.identificationKey)
                .map(it => ({
                    key: it.system.identificationKey,
                    style: it.system.style ?? "",
                    organization: it.system.special?.works?.organization ?? "",
                }));
            criteria = { type: "skill", skills };
        }
        const sources = gatherCheckBonusSources(effects, criteria);

        // コンディション(BS)由来の達成値修正を合流する(酩酊=上方判定 -n、萎縮/憎悪=攻撃判定。
        // 萎縮/憎悪の発火に必要な isAttack/targetMatched は攻撃判定モデル＝フェーズ12 が供給する)。
        const conditions  = TnxCheckFlow._gatherConditions(actor);
        const upward      = ctx.type !== "controlCheck";
        // 特定技能への達成値ペナルティ(眼部損傷)照合用: 参加技能(組み合わせ含む)の識別キー。
        const skillKeys = (ctx.skillIds ?? [])
            .map(id => actor.items.get(id)?.system?.identificationKey)
            .filter(Boolean);
        const condSources = gatherConditionCheckSources(conditions, {
            upward,
            isAttack:      ctx.isAttack === true,
            targetMatched: ctx.targetMatched === true,
            skillKeys,
        });
        const jamSource = TnxCheckFlow._computeJammingSource(actor, conditions, upward);
        const all = [...sources, ...condSources, ...(jamSource ? [jamSource] : [])];
        return { total: all.reduce((s, e) => s + e.value, 0), sources: all };
    }

    /**
     * 電子妨害(computed)による達成値修正を {name, value} で返す(フェーズ9-4)。
     * 準備中アウトフィットを記述子化し computeJammingPenalty で算出。強度違いは最大 n。
     * @returns {{name:string, value:number}|null}
     */
    static _computeJammingSource(actor, conditions, upward) {
        if (!upward || !actor) return null;
        const jammers = (conditions ?? []).filter(c => c.active && c.kind === "interference");
        if (!jammers.length) return null;
        const n = Math.max(...jammers.map(c => c.magnitude || 0));
        const prepared = [];
        for (const item of (actor.items ?? [])) {
            const s = item.system;
            if (!s || !(s.isPrepared === true || readFlag(s, "noPrepareRequired"))) continue; // 準備中(または準備不要=部位「-」)のみ
            const hack = s.hack?.mode === "value" ? (s.hack.total ?? s.hack.value ?? null) : null;
            prepared.push({
                majorCategory: s.majorCategory, minorCategory: s.minorCategory,
                hack, identKey: s.identificationKey,
            });
        }
        const penalty = computeJammingPenalty(n, prepared, { isGhost: actor.system?.isGhost === true });
        if (!penalty) return null;
        return { name: jammers.find(c => c.name)?.name || "電子妨害", value: -penalty };
    }

    /**
     * アクター自身＋全所有アイテムの effects から condition(BS・戦闘不能)を読み取る(フェーズ9-4)。
     * @param {Actor} actor
     * @returns {Array<object>} readCondition() 済みの配列
     */
    static _gatherConditions(actor) {
        if (!actor) return [];
        // 実効コンディションのうち、無視ゲート済み(effectIgnored)を除いた=効果が実際に適用される行。
        // 存在自体(バッヂ表示・回復)は別経路(getEffectiveConditions を経由=ignore ゲートの単一正本)。
        // ここは達成値ペナルティ・電子妨害・重圧ブロックの消費に使う。
        return getEffectiveConditions(actor).filter(c => !c.effectIgnored);
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

    // 使用回数の消費(フェーズ11-6 で全面改訂): 旧 planUsesConsumption(参加技能の自動スキャン)と
    // _consumeUses は廃止。全ての消費は用途の消費先設定(consumeTargets)からのみ発生し、
    // 解決・確認・適用は usage-consumption.mjs が担う(ctx.consumeUses には適用可能な平プランが入る)

    static async _execute({ card, cardCheckValue, suit, ctx, fromDeck = false, trumpUsed = false, suitMismatch = false, suitChangedFrom = null, cardOverride = null }) {
        const actor = game.actors.get(ctx.actorId);
        if (!actor) {
            ui.notifications.error("判定するキャストが見つかりません。");
            TnxCheckFlow.cancel();
            return false;
        }

        // 重圧(BS): 該当能力値を使う上方判定を完全にブロックする。
        // 判定に転送された(切り札リマップ後の) suit から能力値を拾う。カード実体は読まない。
        // ブロック時はカードを出さず判定状態も維持し、別カードを選び直せるようにする。
        if (!suitMismatch && ctx.type !== "controlCheck") {
            const block = getCheckBlock(TnxCheckFlow._gatherConditions(actor), {
                upward: true, ability: SUIT_TO_ABILITY[suit],
            });
            if (block.blocked) {
                ui.notifications.warn(`「${block.by}」により、その能力値を使う判定はできません。別のスートのカードを使ってください。`);
                return false;
            }
        }

        // ダイアログを閉じて判定状態をクリア（カード選択後に即時）
        TnxCheckFlow._context   = null;
        TnxCheckFlow._trumpMode = false;
        TnxCheckFlow._closeDialog();

        // 手札からカードをプレイ（山札から判定の場合は既に捨て札にある）
        if (!fromDeck) {
            await TnxActionHandler.playCard(card.id);
            // 手札を使用した直後に上限まで自動補充
            await TnxActionHandler.autoReplenishHand();
        }

        game.tnx.hud?.render(false);

        // 用途起動による使用回数の消費（用途の消費先設定＝consumeTargets 由来・11-6）。
        // 起動時の消費ダイアログで確定した平プランを判定実行時に適用する（キャンセル時は未到達＝非消費）
        if (ctx.consumeUses?.length) {
            await applyConsumptionPlan(ctx.consumeUses);
        }

        // 能力値コンテキストを先に構築（報酬点プレビュー計算と本計算で共用）
        const abilitiesCtx = suitMismatch ? null : TnxCheckFlow._buildAbilitiesCtx(actor);
        // 判定バフ(check 時・同一効果の重複適用不可)を算出。内訳(sources)はチャットの内訳表示に使う
        const checkInfo  = suitMismatch ? { total: 0, sources: [] } : TnxCheckFlow._computeCheckBonus(actor, ctx, SUIT_TO_ABILITY[suit]);
        let checkBonus = checkInfo.total;
        // 用途の判定ボーナス(達成値へ加算する式・2026-07-10)。①用途自身の修正値(専用欄・親アイテム名で
        // 帰属)②供給元つきの追加行、の順に評価。式は @item.self=用途の親アイテム・@item.<識別キー>・
        // アクター @system.*・@card(判定に使用したカードの値=カードプレイ後のため参照可・2026-07-11)を
        // 参照可。内訳に「判定ボーナス（供給元名）」として載せる。判定確定前のため @diff/@achievement は 0
        if (!suitMismatch) {
            const parentItem = ctx.sourceItemId ? actor.items.get(ctx.sourceItemId) : null;
            const cardNumeric = cardCheckValue === "FIXED_21" ? 11
                : (Number.isFinite(cardCheckValue) ? cardCheckValue : 0);
            const partial = { cardValue: cardNumeric };
            const self = await evaluateSelfBonus(ctx.checkBonusSelf, actor, partial, null, parentItem);
            if (self) {
                checkBonus += self.value;
                checkInfo.sources.push({ name: `判定ボーナス（${self.name}）`, value: self.value });
            }
            if (ctx.checkBonuses?.length) {
                const { total, sources } = await evaluateBonusRows(ctx.checkBonuses, actor, partial, null, null, parentItem);
                checkBonus += total;
                for (const s of sources) checkInfo.sources.push({ name: `判定ボーナス（${s.name}）`, value: s.value });
            }
        }

        // 報酬点の使用を決定（スート不一致・制御判定・ファンブル確定はスキップ）
        let bountyUsed = 0;
        if (!suitMismatch && ctx.type !== "controlCheck" && cardCheckValue !== "FUMBLE") {
            // 報酬点使用不可(口座凍結/信用失墜)の一元ゲート(2026-07-16): 消費時点のアクター状態で
            // 判定するため、ここ(ダイアログ直前)の一点で全経路(用途経由・情報収集・再判定)を塞ぐ。
            // 0 ならダイアログ自体を出さない(_promptBountyUsage の早期 return)
            const bountyAvailable = hasBountyBlock(TnxCheckFlow._gatherConditions(actor))
                ? 0 : (ctx.bountyAvailable ?? 0);
            // 報酬点 0 時のベース達成値を先計算してダイアログに表示
            const baseResult       = calcSkillCheck({ cardCheckValue, suit, abilitiesCtx, bountyUsed: 0, targetValue: ctx.targetValue, checkBonus });
            const baseAchievement  = typeof baseResult.achievement === "number" ? baseResult.achievement : null;
            bountyUsed = await TnxCheckFlow._promptBountyUsage(bountyAvailable, { baseAchievement });
        }

        // 判定結果の計算
        let result;
        if (suitMismatch) {
            // スート不一致 → 判定不成立。不成立ゆえに達成値 0 の失敗（カードはプレイされる。
            // 差分値は成功時のみ算出される規約のため null）
            result = {
                fumble:      false,
                achievement: 0,
                cardValue:   0,
                abilityVal:  0,
                bountyUsed:  0,
                targetValue: ctx.targetValue,
                diff:        null,
                success:     false,
            };
        } else {
            if (ctx.type === "controlCheck") {
                result = calcControlCheck({ cardCheckValue, suit, abilitiesCtx, checkBonus, manualMod: ctx.manualMod ?? 0 });
            } else {
                result = calcSkillCheck({ cardCheckValue, suit, abilitiesCtx, bountyUsed, targetValue: ctx.targetValue, checkBonus, manualMod: ctx.manualMod ?? 0 });
            }
        }

        // 代用判定(2026-07-09): 指定と別の技能で判定した事実を結果に載せ、
        // 結果カードと要求カードの両方に明示する(可否・修正の裁定は卓)
        if (ctx.substitution) result.substitution = ctx.substitution;

        // スート変更(2026-07-12): 元スートを結果に載せ、内訳に「スート変更（元→後）」を明示する
        if (suitChangedFrom !== null) result.suitChangedFrom = suitChangedFrom;

        // カード数字の上書き(2026-07-13): 元→後を内訳に明示する
        if (cardOverride) result.cardOverride = cardOverride;

        // 再判定コンテキスト(2026-07-11): 元の構成から再実行するためのスナップショット(常時保存)。
        // 継続処理を持つ判定(リアクション/NPC取得/治療/移動/controlNegate)は状態機械のリセットが
        // 必要なため当面対象外(申し送り)
        const recheckCtx = TnxCheckFlow._buildRecheckContext(ctx);

        // チャットに結果を投稿。攻撃(ctx.attack)は通常の結果カードの代わりに攻撃カードを出す
        // (成否保留・リアクション導線つき・12-2。attack-flow は本フローを import するため動的 import)。
        // 移動(ctx.movement)も通常カードの代わりに移動結果カードを出す(達成値÷10 段階・12)。
        // 再判定(ctx.recheckMessageId)は新カードを出さず、元カードの達成値を置き換える(2026-07-14 確定)。
        if (ctx.recheckMessageId) {
            await TnxCheckFlow._applyRecheckReplacement({ ctx, card, suit, result, cardCheckValue, fromDeck, trumpUsed, suitMismatch, checkSources: checkInfo.sources });
        } else if (ctx.attack) {
            const { postAttackCard } = await import("./attack-flow.mjs");
            await postAttackCard({ payload: ctx.attack, result, suit, cardCheckValue, card, fromDeck, trumpUsed, suitMismatch, recheckCtx });
        } else if (ctx.movement) {
            const { postMovementCard } = await import("./vehicle-move.mjs");
            await postMovementCard({ payload: ctx.movement, result, suit, card, fromDeck, trumpUsed, suitMismatch, recheckCtx });
        } else if (!ctx.reaction) {
            // リアクションは通常の結果カードを出さない(2026-07-15 ユーザー確定)。書き換わった
            // リアクションカードが結果カードそのもの。再判定/修正の導線もリアクションカードへ載せる
            // (recheckCtx は下の completeReactionFromCheck がリアクションカードに保存する)。
            await TnxCheckFlow._postResultChat({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources: checkInfo.sources, recheckCtx });
        }

        // controlNegate(BS の無効/降格)の完了継続: 判定は上の通常経路そのもので行われ、
        // ここでは結果の適用のみ行う(2026-07-08 ユーザー裁定)。帰結テキストを result に載せ、
        // 下の emitCheckResult 経由で要求カードをライブ書き換えする(別の結果カードは出さない)
        // 継続処理の初回適用。再判定(ctx.recheckMessageId)では _applyRecheckReplacement 内の
        // _rerunContinuation が種別ごとに再実行するため、ここでは二重実行しないようゲートする(2026-07-15)。
        if (!ctx.recheckMessageId && ctx.controlNegate) {
            const { resolveControlNegateFromCheck } = await import("./condition-resolution.mjs");
            const negate = await resolveControlNegateFromCheck(ctx.controlNegate, result);
            if (negate) result.negateOutcome = negate;
        }

        // RL 要求フロー: GM に結果を送信(再判定でも要求カードは追随させるためゲートしない)
        if (ctx.requestMessageId) {
            TnxSocketHandler.emitCheckResult(ctx.requestMessageId, ctx.actorId, result);
        }

        // NPC取得(11-6): 取得判定の完了継続(heads/sourceName 転記・トークン配置)。
        // npc-acquisition は本フロー(TnxCheckFlow.open)を import するため動的 import で循環を避ける
        if (!ctx.recheckMessageId && ctx.npcAcquire) {
            const { completeAcquisitionFromCheck } = await import("./npc-acquisition.mjs");
            await completeAcquisitionFromCheck(ctx.npcAcquire, result);
        }

        // リアクション判定の完了継続(12-2): 攻撃カード上で対決を解決し、リアクションカードを結果カード化。
        // recheckCtx をリアクションカードに保存し、再判定/修正の導線をそこに載せる(2026-07-15)。
        if (!ctx.recheckMessageId && ctx.reaction) {
            const { completeReactionFromCheck } = await import("./attack-flow.mjs");
            await completeReactionFromCheck(ctx.reaction, result, { suitMismatch, recheckCtx });
        }

        // カバーの完了継続(2026-07-16): 成功なら攻撃カードの対象にカバーの印を付ける(ダメージカードを
        // 出すとき付け替えられる)。目標値「なし」運用ではスート一致(=不成立でない)で成功(success は null)。
        if (!ctx.recheckMessageId && ctx.covering) {
            const { completeCoveringFromCheck } = await import("./attack-flow.mjs");
            const coverer = game.actors.get(ctx.actorId);
            await completeCoveringFromCheck(ctx.covering, result, { suitMismatch, coverer });
        }

        // 治療判定の完了継続(12): 成功で負傷＋紐づき戦闘不能＋非BS効果を除去する
        if (!ctx.recheckMessageId && ctx.treatment) {
            const { resolveTreatmentFromCheck } = await import("./treatment-flow.mjs");
            await resolveTreatmentFromCheck(ctx.treatment, result);
        }

        // 回復判定の完了継続(2026-07-13): 成功で選択済みの状態(BS/戦闘不能/負傷)を除去する
        if (!ctx.recheckMessageId && ctx.recovery) {
            const { resolveRecoveryFromCheck } = await import("./recovery-flow.mjs");
            await resolveRecoveryFromCheck(ctx.recovery, result);
        }

        return true;
    }

    static async _postResultChat({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch = false, checkSources = [], recheckCtx = null }) {
        const actor = game.actors.get(ctx.actorId);
        const content = await TnxCheckFlow._renderResultContent({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources });

        await ChatMessage.create({
            content,
            speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
            flags: {
                "tokyo-nova-axleration": {
                    checkResult: { actorId: ctx.actorId, result },
                    // 用途の適用効果(あれば)。カードに「効果を適用」ボタンを出す(2026-07-10)
                    ...(ctx.usageEffects ? { usageEffects: ctx.usageEffects } : {}),
                    // 再判定スナップショット(あれば・常時保存)。導線は数字クリック/付与/GMメニュー(2026-07-14)
                    ...(recheckCtx ? { checkRecheck: recheckCtx } : {}),
                },
            },
        });
    }

    /** 結果カードの本文を構築する(新規投稿と再判定の置き換え着地で共用・2026-07-14 抽出)。 */
    static async _renderResultContent({ ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch = false, checkSources = [], isRecheck = false }) {
        const actor = game.actors.get(ctx.actorId);
        const SUIT_SYMBOL   = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
        const TYPE_LABEL    = { skillCheck: "技能判定", controlCheck: "制御判定", abilityCheck: "能力値判定" };
        const ABILITY_LABEL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };

        const isControlCheck = ctx.type === "controlCheck";
        return foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/check-result.hbs",
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
                checkSources,
                hasCheckBonus: (result.checkBonus ?? 0) !== 0,
                // 代用判定(2026-07-09): 指定技能と手動修正を結果カードに明示する
                substitution: result.substitution ?? null,
                manualModDisplay: result.manualMod
                    ? (result.manualMod > 0 ? `+${result.manualMod}` : String(result.manualMod))
                    : "",
                isControlCheck,
                // スート変更(2026-07-12): 元→後を内訳に明示する
                suitChangedDisplay: result.suitChangedFrom
                    ? `${SUIT_SYMBOL[result.suitChangedFrom] ?? result.suitChangedFrom} → ${SUIT_SYMBOL[suit] ?? suit}`
                    : null,
                // カード数字の上書き(2026-07-13): 元→後(A/J/Q/K 表記)を内訳に明示する
                cardOverrideDisplay: result.cardOverride
                    ? `${CARD_NUM_LABEL(result.cardOverride.from)} → ${CARD_NUM_LABEL(result.cardOverride.to)}`
                    : null,
                isFixed21:    result.fixedAt21 === true,
                hasTargetValue: ctx.targetValue !== null,
                // 差分値の表示規約(Check_Rules 2026-07-08): 目標値があれば判定の種類を問わず必ず表示
                diffDisplay:  Number.isFinite(result.diff) ? (result.diff >= 0 ? `+${result.diff}` : `${result.diff}`) : null,
                showSuccess:  !isControlCheck ? (ctx.targetValue !== null && !result.fumble) : !result.fumble,
                fromDeck,
                trumpUsed,
                suitMismatch,
                isRecheck, // 再判定で置き換えたカードには「再判定」タグを出す(2026-07-14 置き換え着地)
            }
        );
    }

    /**
     * 再判定の置き換え着地(2026-07-14 ユーザー確定)。新カードを投稿せず、元の結果カード/攻撃カードの
     * 達成値を再判定の結果で置き換える。内訳も新しい判定の構成のみに差し替える(元判定に働いた
     * 一回性の増強はルール上失われるため=事後修正 checkMods もリセット)。
     * - 攻撃: リアクションのやり直しはしない=解決済みなら保存済みの相手値で成否・差分を再解決
     *   (resolveAttackRecheckState)。ダメージ算出後は startRecheck 側でタイミング不可として弾く。
     * - 一度だけ: checkRecheck.rechecked=true(再判定系は「1度だけ」の能力)。以後の導線は閉じる。
     * - 非作者は GM へソケット委譲(applyMessagePatch・content 込み)。
     */
    static async _applyRecheckReplacement({ ctx, card, suit, result, cardCheckValue = null, fromDeck, trumpUsed, suitMismatch = false, checkSources = [] }) {
        const SCOPE = "tokyo-nova-axleration";
        const message = game.messages.get(ctx.recheckMessageId);
        if (!message) { ui.notifications.warn("再判定する元のカードが見つかりません。"); return; }

        // 継続判定(治療/回復/controlNegate=B)の「失敗→成功のみ適用」ゲート用に旧成否を控える
        const oldSuccess = message.getFlag(SCOPE, "checkResult")?.result?.success === true;

        const patch = {
            [`flags.${SCOPE}.checkRecheck.rechecked`]: true,
            [`flags.${SCOPE}.-=checkMods`]: null,
            [`flags.${SCOPE}.checkResult`]: { actorId: ctx.actorId, result },
        };

        if (ctx.attack) {
            // 命中判定は全対象で共有(複数対象一括・2026-07-15)。再ロールした達成値で対象リスト全体を
            // 再解決し(リアクションのやり直しはしない)、上位状態も導き直す。
            const prev = message.getFlag(SCOPE, "attackCheck") ?? {};
            const { buildAttackCardContent, rebuildRecheckedTargets } = await import("./attack-flow.mjs");
            const newTargets = await rebuildRecheckedTargets(prev.targets ?? [], {
                achievement: result.achievement, fumble: result.fumble === true, suitMismatch, suit,
            });
            const overall = result.fumble ? "fumble"
                : (suitMismatch ? "miss" : ((prev.targets?.length) ? "active" : "open"));
            patch.content = await buildAttackCardContent({
                payload: ctx.attack, result, suit, card, fromDeck, trumpUsed, suitMismatch, isRecheck: true,
            });
            patch[`flags.${SCOPE}.attackCheck.achievement`] = result.achievement;
            patch[`flags.${SCOPE}.attackCheck.cardValue`] =
                cardCheckValue === "FIXED_21" ? 11 : (Number.isFinite(cardCheckValue) ? cardCheckValue : 0);
            patch[`flags.${SCOPE}.attackCheck.suit`] = suit;
            patch[`flags.${SCOPE}.attackCheck.state`] = overall;
            patch[`flags.${SCOPE}.attackCheck.targets`] = newTargets;
        } else if (ctx.movement) {
            // 操縦移動は通常結果カードでなく移動カード。達成値÷10 段階を新達成値で描き直す(表示のみ=A)
            const { buildMovementCardContent } = await import("./vehicle-move.mjs");
            patch.content = await buildMovementCardContent({
                payload: ctx.movement, result, suit, card, fromDeck, trumpUsed, suitMismatch, isRecheck: true,
            });
        } else if (ctx.reaction) {
            // リアクションは元カードがリアクションカード(結果カード化済み)。本文は attackReaction フラグから
            // renderReactionCard が描くため上書きしない。下の _rerunContinuation が対決を再解決し表示を更新する。
        } else {
            patch.content = await TnxCheckFlow._renderResultContent({
                ctx, card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources, isRecheck: true,
            });
        }

        // フラグ・本文の更新(非作者・非GM は GM へ委譲=applyMessagePatch)
        await TnxSocketHandler.applyMessagePatch(message, patch);
        // 攻撃の再判定: 未解決の個別リアクションカードを新しい攻撃達成値へ追従(全体失敗なら削除)。
        // 攻撃カードの author=攻撃者か GM の場合のみ(従来どおり。リアクションカードの更新権限がある)
        if (ctx.attack && (game.user.isGM || message.isAuthor)) {
            const { refreshReactionCardsAfterRecheck } = await import("./attack-flow.mjs");
            await refreshReactionCardsAfterRecheck(message, {
                achievement: result.achievement, suit,
                wholeFail: result.fumble === true || suitMismatch === true,
            });
        }

        // 継続処理の再実行(2026-07-15・リアクション対決再解決/治療等の失敗→成功のみ適用/NPC・移動は表示のみ)。
        // 各ハンドラが所有権に応じて GM 委譲するため、再判定者クライアントでそのまま呼ぶ。
        await TnxCheckFlow._rerunContinuation(ctx, result, { oldSuccess });
    }

    /**
     * 完了継続(判定完了後の後処理)のレジストリ(2026-07-16 一本化)。**継続文脈のキーと再実行
     * ポリシーの正本**——スナップショット保存(_buildRecheckContext)・再判定への引き継ぎ
     * (startRecheck)・再実行(_rerunContinuation)はこの表から導出する。従来は種別リストが
     * 3箇所に複製されており、種別追加時の漏れ(カバーが再判定に引き継がれない)が起きていた。
     * 初回実行は _execute 内の分岐のまま(呼び出しシグネチャ・result への反映・実行順が種別ごとに
     * 固有のため)。**新しい継続種別は、この表と _execute の両方に追加する。**
     * rerun: 再判定/事後修正の着地からの再実行(2026-07-15 ユーザー確定・全種対応)。
     * - reaction: 対決の再解決(副作用なし=解決済みでも再解決)
     * - treatment/recovery/controlNegate: 失敗→成功の遷移でのみ副作用を適用(冪等な除去)
     *   = rerunOnSuccessOnly。成功→失敗は表示のみ(手動復元)
     * - covering: 成立なら印を付け直す(付与済み/ダメージ算出後は completeCoveringFromCheck の
     *   内部ガードが弾く)
     * - npcAcquire/movement: 表示のみ(rerun なし。移動カードの再描画は _applyRecheckReplacement)
     */
    static CONTINUATIONS = Object.freeze({
        reaction: {
            async rerun(cc, result) {
                const { completeReactionFromCheck } = await import("./attack-flow.mjs");
                await completeReactionFromCheck(cc, result, { allowResolved: true });
            },
        },
        treatment: {
            rerunOnSuccessOnly: true,
            async rerun(cc, result) {
                const { resolveTreatmentFromCheck } = await import("./treatment-flow.mjs");
                await resolveTreatmentFromCheck(cc, result);
            },
        },
        recovery: {
            rerunOnSuccessOnly: true,
            async rerun(cc, result) {
                const { resolveRecoveryFromCheck } = await import("./recovery-flow.mjs");
                await resolveRecoveryFromCheck(cc, result);
            },
        },
        controlNegate: {
            rerunOnSuccessOnly: true,
            async rerun(cc, result) {
                const { resolveControlNegateFromCheck } = await import("./condition-resolution.mjs");
                await resolveControlNegateFromCheck(cc, result);
            },
        },
        covering: {
            async rerun(cc, result, { actorId } = {}) {
                const { completeCoveringFromCheck } = await import("./attack-flow.mjs");
                await completeCoveringFromCheck(cc, result, { coverer: game.actors.get(actorId) ?? null });
            },
        },
        npcAcquire: {},
        movement: {},
    });

    /**
     * 再判定(カードを出し直して判定値を再決定・2026-07-11 ユーザー確定)用のコンテキストを、
     * 結果カードのフラグに保存できる形で組み立てる。**スナップショットは常時保存**し、
     * プレイヤーの直接入口(数字クリック)だけを用途の「再判定可能」(allowRecheck)でゲートする——
     * 事後付与(grantRecheck=達成値クリック)や GM メニューが判定後に働くための前提。
     * 継続処理を持つ判定の再判定(2026-07-15 ユーザー確定・全種対応)。継続文脈を rc に載せ、
     * 再判定/修正の着地で `_rerunContinuation` が種別ごとに再実行する(ポリシーは CONTINUATIONS)。
     * よって除外はしない(スナップショットは常時保存)。
     * @param {object} ctx 判定コンテキスト
     * @returns {object|null}
     */
    static _buildRecheckContext(ctx) {
        const cont = {};
        for (const k of Object.keys(TnxCheckFlow.CONTINUATIONS)) {
            if (ctx[k]) cont[k] = ctx[k];
        }
        return {
            allowRecheck:    ctx.allowRecheck === true, // true=結果カードに「再判定」ボタンを出す
            allowSuitChange: ctx.allowSuitChange === true, // スート変更可能(用途の設定・再判定でも維持)
            type:            ctx.type,
            actorId:         ctx.actorId,
            skillIds:        ctx.skillIds ?? [],
            skillLabel:      ctx.skillLabel ?? "",
            validSuits:      ctx.validSuits ?? [],
            targetValue:     ctx.targetValue ?? null,
            // 報酬点は「使えるか」だけ保存し、量は再判定時点の所持から取り直す(元判定の消費を反映)
            bountyAllowed:   (ctx.bountyAvailable ?? 0) > 0,
            checkBonuses:    ctx.checkBonuses ?? [],
            checkBonusSelf:  ctx.checkBonusSelf ?? "",
            sourceItemId:    ctx.sourceItemId ?? "",
            substitution:    ctx.substitution ?? null,
            manualMod:       ctx.manualMod ?? 0,
            requestMessageId: ctx.requestMessageId ?? null,
            ...(ctx.attack ? { attack: ctx.attack } : {}),
            ...(ctx.usageEffects ? { usageEffects: ctx.usageEffects } : {}),
            ...cont, // 継続文脈(reaction/treatment/recovery/controlNegate/npcAcquire/movement)
        };
    }

    /**
     * 継続処理を再判定/修正の結果で再実行する(2026-07-15)。種別と再実行ポリシーは
     * CONTINUATIONS レジストリが正本(2026-07-16 一本化)。継続は1判定に1種のため、
     * 最初に見つかったキーだけを扱う(従来の分岐と同じ)。
     * @param {object} cc 継続キーを持つオブジェクト(ctx か checkRecheck スナップショット)
     * @param {object} result 新しい判定結果(success/achievement/fumble)
     * @param {{oldSuccess?:boolean}} [opts] 旧成否(rerunOnSuccessOnly の遷移ゲート)
     */
    static async _rerunContinuation(cc, result, { oldSuccess = false } = {}) {
        if (!cc) return;
        const key = Object.keys(TnxCheckFlow.CONTINUATIONS).find(k => cc[k]);
        if (!key) return;
        const def = TnxCheckFlow.CONTINUATIONS[key];
        if (!def.rerun) return; // npcAcquire / movement: 表示のみ(再実行なし)
        // 失敗→成功の遷移でのみ副作用を適用(冪等な除去ハンドラを再呼び)。成功→失敗は表示のみ(手動復元)
        if (def.rerunOnSuccessOnly && !(result.success === true && oldSuccess !== true)) return;
        await def.rerun(cc[key], result, { oldSuccess, actorId: cc.actorId });
    }

    /**
     * 再判定を不可にする理由を返す(なければ null)。導線3種(数字クリック/付与クリック/GMメニュー)と
     * startRecheck 本体が共用する。
     * - 一度だけ(2026-07-14 ユーザー確定): 再判定系は「1度だけ」の能力=置き換え済みカードは不可。
     * - ダメージ算出後(2026-07-14 ユーザー確定): 再判定系のタイミングは「判定の成功/失敗時」であり、
     *   ダメージ算出後はタイミングが合わないため不可(巻き戻し禁止ではなくタイミング不一致が理由)。
     * @param {ChatMessage} message
     * @returns {string|null} 警告文(可能なら null)
     */
    static recheckBlockReason(message) {
        const SCOPE = "tokyo-nova-axleration";
        const rc = message.getFlag(SCOPE, "checkRecheck");
        if (!rc) return "このカードは再判定できません。";
        if (rc.rechecked === true) return "この判定は再判定済みです（再判定は一度だけ）。";
        if (message.getFlag(SCOPE, "attackCheck")?.damageRolled === true) {
            return "ダメージ算出後はタイミングが合わないため再判定できません。";
        }
        return null;
    }

    /**
     * 再判定を開始する(数字クリック/再判定付与の達成値クリック/GMメニューから)。
     * 保存済みコンテキストで判定フローを開き直し(カードを出し直して判定値を再決定)、
     * 完了時に元カードの達成値を置き換える(recheckMessageId・2026-07-14 確定)。
     * 使用回数は元判定で消費済みのため再消費しない。
     * @param {ChatMessage} message 再判定する結果カード
     * @param {object} [opts]
     * @param {Item|null} [opts.mergeSkill] 組み合わせに追加する技能(再判定付与の起動技能)
     * @param {Array} [opts.consumeUses] 付与用途の消費プラン(判定実行時に適用)
     */
    static async startRecheck(message, { mergeSkill = null, consumeUses = [] } = {}) {
        const rc = message.getFlag("tokyo-nova-axleration", "checkRecheck");
        if (!rc) return;
        const blocked = TnxCheckFlow.recheckBlockReason(message);
        if (blocked) { ui.notifications.warn(blocked); return; }
        const actor = game.actors.get(rc.actorId);
        if (!actor) { ui.notifications.warn("再判定するアクターが見つかりません。"); return; }
        if (!(game.user.isGM || actor.isOwner)) {
            ui.notifications.warn(`「${actor.name}」の再判定は所有者（または RL）が行います。`);
            return;
        }

        // 再判定付与: 起動技能を組み合わせる(スート積を再計算・skillIds に加えることで
        // その技能の判定バフ(check.*)も判定時に自然に効く)
        let skillIds   = rc.skillIds;
        let skillLabel = rc.skillLabel;
        let validSuits = rc.validSuits;
        if (mergeSkill) {
            if (!skillIds.includes(mergeSkill.id)) {
                skillIds   = [...skillIds, mergeSkill.id];
                skillLabel = skillLabel ? `${skillLabel}+${mergeSkill.name}` : mergeSkill.name;
            }
            validSuits = (validSuits ?? []).filter(s => readFlag(mergeSkill.system, `suits.${s}`));
            if (!validSuits.length) {
                ui.notifications.warn(`「${mergeSkill.name}」と元の判定に共通スートがないため、組み合わせて再判定できません。`);
                return;
            }
        }

        const bounty = rc.bountyAllowed
            ? (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0)
            : 0;
        await TnxCheckFlow.open({
            type:            rc.type,
            actorId:         rc.actorId,
            skillIds,
            skillLabel,
            validSuits,
            targetValue:     rc.targetValue,
            bountyAvailable: bounty,
            consumeUses,     // 元判定の消費は済み。付与用途の消費プランのみ(通常の再判定は空)
            requestMessageId: rc.requestMessageId,
            checkBonuses:    rc.checkBonuses,
            checkBonusSelf:  rc.checkBonusSelf,
            sourceItemId:    rc.sourceItemId,
            substitution:    rc.substitution,
            manualMod:       rc.manualMod,
            ...(rc.attack ? { attack: rc.attack } : {}),
            ...(rc.usageEffects ? { usageEffects: rc.usageEffects } : {}),
            // 継続文脈を再判定の実行 ctx へ引き継ぐ(_applyRecheckReplacement が種別ごとに再実行する・
            // 2026-07-15)。種別は CONTINUATIONS レジストリから導出(2026-07-16 一本化)
            ...Object.fromEntries(Object.keys(TnxCheckFlow.CONTINUATIONS)
                .filter(k => rc[k]).map(k => [k, rc[k]])),
            allowRecheck:    rc.allowRecheck === true, // 元と同じゲート(付与再判定で権利は増やさない)
            allowSuitChange: rc.allowSuitChange === true,
            isRecheck:       true,
            recheckMessageId: message.id, // 置き換え着地(2026-07-14): 完了時に元カードの達成値を置き換える
        });
    }

    // ─── 達成値クリック待ちアクション(2026-07-11) ─────────────────────────────
    // 用途の使用で「クリック待ち」モードに入り、チャットカードのクリックで発動する
    // 事後系メカニクスの共通機構。kind で動作とクリック先を分岐する:
    //   - "recheck"(再判定を付与): 結果カードの達成値クリック=その判定に起動技能を組み合わせた再判定。
    //     宣言用途からの付与は判定でない=参加技能が無いため組み合わせずに再判定する(merge=false・2026-07-13)
    //   - "modify"(判定を修正): 結果カードの達成値クリック=その判定に事後ボーナス/ペナルティを適用
    //   - "modifyDamage"(ダメージを修正): ダメージカードの攻撃側合計クリック=そのダメージに修正を適用
    //     (発動処理は damage-flow.handleDamageModifyClick。状態は peekAchievementAction で覗く)
    //   - "suitChange"(スートを変更): 次の自分の判定で使用不可スートを出したとき=使用可能スートへ変更
    //     (発動処理は _trySuitChange。クリックでなく判定のカードプレイが発動点)
    // 排他(同時に1つ)・同じ用途の再使用でキャンセル。発動条件(失敗時のみ等)は自動強制しない(卓裁定)。

    /** @type {{kind:"recheck"|"modify"|"modifyDamage"|"suitChange"|"covering", actorId:string, skillItemId:string, skillName:string, usageId:string, consumeUses:Array, merge:boolean}|null} */
    static _clickState = null;

    static get isGrantPending() { return TnxCheckFlow._clickState !== null; }

    /** クリック待ち状態を kind 指定で覗く(発動側の判定用・damage-flow のダメージクリックが使用)。 */
    static peekAchievementAction(kind) {
        return TnxCheckFlow._clickState?.kind === kind ? TnxCheckFlow._clickState : null;
    }

    /**
     * クリック待ちモードを開始する。
     * @param {"recheck"|"modify"|"modifyDamage"|"suitChange"} kind
     * @param {Actor} actor 用途の使用者
     * @param {Item} skill 用途の親技能
     * @param {{usageId?:string, consumeUses?:Array, merge?:boolean}} [opts]
     *   merge: 再判定の付与で起動技能を組み合わせるか(check 用途=true。宣言用途は判定でない=
     *   参加技能が無いため false で素の再判定権のみ付与・2026-07-13 ユーザー確定)
     */
    static startAchievementAction(kind, actor, skill, { usageId = "", consumeUses = [], merge = true } = {}) {
        const MSG = {
            recheck: {
                cancel: "再判定の付与をキャンセルしました。",
                start:  merge
                    ? `結果カードの達成値をクリックすると、その判定に「${skill.name}」を組み合わせて再判定します（「${skill.name}」をもう一度使用するとキャンセル）。`
                    : `結果カードの達成値をクリックすると、その判定を再判定します（「${skill.name}」をもう一度使用するとキャンセル）。`,
            },
            modify: {
                cancel: "判定の修正をキャンセルしました。",
                start:  `結果カードの達成値をクリックすると、その判定に「${skill.name}」の修正を適用します（「${skill.name}」をもう一度使用するとキャンセル）。`,
            },
            modifyDamage: {
                cancel: "ダメージの修正をキャンセルしました。",
                start:  `ダメージ・チャットカードのダメージ（攻撃側合計）をクリックすると、そのダメージに「${skill.name}」の修正を適用します（「${skill.name}」をもう一度使用するとキャンセル）。`,
            },
            suitChange: {
                cancel: "スートの変更をキャンセルしました。",
                start:  `次に自分が行う判定で使用できないスートのカードを出したとき、使用可能なスートに変更できます（「${skill.name}」をもう一度使用するとキャンセル）。`,
            },
            covering: {
                cancel: "カバーをキャンセルしました。",
                start:  `ダメージ・チャットカードのカバーする対象をクリックすると、「${skill.name}」でカバーの判定を行います（「${skill.name}」をもう一度使用するとキャンセル）。`,
            },
        }[kind];
        if (TnxCheckFlow._clickState?.skillItemId === skill.id && TnxCheckFlow._clickState?.kind === kind) {
            TnxCheckFlow.cancelAchievementAction();
            ui.notifications.info(MSG.cancel);
            return;
        }
        TnxCheckFlow._clickState = {
            kind, actorId: actor.id, skillItemId: skill.id, skillName: skill.name, usageId, consumeUses, merge,
        };
        document.body.classList.add("tnx-recheck-grant-pending");
        ui.notifications.info(MSG.start);
    }

    static cancelAchievementAction() {
        TnxCheckFlow._clickState = null;
        document.body.classList.remove("tnx-recheck-grant-pending");
    }

    /**
     * 達成値クリックの処理。クリック待ちモード中は kind に応じて再判定/修正を発動する。
     * モード外は「再判定可能」(allowRecheck)のプレイヤー入口(2026-07-14 確定)=素の再判定を起動する
     * (対象外・権利のないクリックは静かに無視=装飾も出ていない)。
     */
    static async _onGrantAchievementClick(message) {
        const state = TnxCheckFlow._clickState;
        if (!state) {
            const rc = message.getFlag("tokyo-nova-axleration", "checkRecheck");
            if (rc?.allowRecheck !== true) return;
            if (TnxCheckFlow.recheckBlockReason(message)) return;
            const actor = game.actors.get(rc.actorId);
            if (!(game.user.isGM || actor?.isOwner)) return;
            await TnxCheckFlow.startRecheck(message);
            return;
        }
        if (state.kind === "modifyDamage") return; // ダメージクリック待ちは達成値クリックでは発動しない(damage-flow 側)
        if (state.kind === "covering") return;     // カバー待ちの発動点はダメージカードの対象クリック(damage-flow 側)
        if (state.kind === "suitChange") return;   // スート変更待ちの発動点は判定のカードプレイ(_trySuitChange)
        if (state.kind === "recheck") {
            // 不可(再判定済み/ダメージ算出後)はモードを維持したまま警告する(別のカードを選び直せる)
            const blocked = TnxCheckFlow.recheckBlockReason(message);
            if (blocked) { ui.notifications.warn(blocked); return; }
        }
        const actor = game.actors.get(state.actorId);
        const skill = actor?.items.get(state.skillItemId);
        if (!skill) { TnxCheckFlow.cancelAchievementAction(); return; }
        TnxCheckFlow.cancelAchievementAction();
        if (state.kind === "recheck") {
            // 宣言用途からの付与(merge=false)は組み合わせずに元の構成のまま再判定する
            await TnxCheckFlow.startRecheck(message, { mergeSkill: state.merge === false ? null : skill, consumeUses: state.consumeUses });
        } else {
            await TnxCheckFlow._applyCheckModify(message, { actor, skill, usageId: state.usageId, consumeUses: state.consumeUses });
        }
    }

    /**
     * 判定の事後修正(modifyCheck)を適用する。値=用途の「この用途の判定修正値」(checkBonusSelf・式)を
     * 使用者のデータで評価(空・評価不能なら手入力)。フラグの達成値を更新し、目標値つき判定は
     * 成否・差分値を再計算、攻撃カードは解決済みなら対決を再解決する(ダメージカード算出後は不可)。
     * 修正の内訳はフラグ checkMods に積み、カードにライブ描画する。
     * 事後修正された判定を再判定すると修正はリセットされる(再判定はスナップショット=元の構成から
     * 再実行するため・2026-07-11 ユーザー確定)。
     * manual: GMメニュー「達成値を修正(手動)」からの裁定ツール経路({label, mod} 確定済み・
     * 消費なし・ダメージ算出後も制限しない=2026-07-14)。
     */
    static async _applyCheckModify(message, { actor, skill, usageId, consumeUses, manual = null } = {}) {
        const SCOPE = "tokyo-nova-axleration";
        const rc = message.getFlag(SCOPE, "checkRecheck");
        const attackF = message.getFlag(SCOPE, "attackCheck");
        const checkF = message.getFlag(SCOPE, "checkResult");
        if (!checkF && !attackF) return;

        // ダメージ算出後の攻撃は修正不可(算出済みダメージの巻き戻しは整合を壊す)。
        // 手動修正(GMメニュー・manual)は卓の最終裁定ツールのため制限しない(2026-07-14)
        if (attackF?.damageRolled && !manual) {
            ui.notifications.warn("ダメージカードを出した後の攻撃判定は修正できません。");
            return;
        }

        // A の 21固定=バフもデバフも無視する完全固定(2026-07-15 ユーザー確定)。engine 段階でも報酬点・
        // 能力値・判定バフ/ボーナス・状況修正は無視済みだが、通常経路の事後修正(用途「判定を修正」)も弾く。
        // GM 手動(manual)は管理者権限の最終裁定として通す。
        if (checkF?.result?.fixedAt21 === true && !manual) {
            ui.notifications.warn("21固定（Aの完全固定）の判定は事後修正できません。");
            return;
        }

        const prevAch = Number(attackF?.achievement ?? checkF?.result?.achievement) || 0;
        let mod, label, overrideTo;
        if (manual) {
            // 手動修正(GMメニュー「達成値を修正」): 差分/上書きは呼び出し側で確定済み
            ({ mod, label, overrideTo } = manual);
        } else {
            // 修正値: 用途の判定修正値(式・@item.self=親技能)を評価。空/評価不能/0 は手入力
            // (手入力は「上書き」チェック可=入力値をそのまま新しい達成値にする・2026-07-14)
            const usage = (skill.system.actions ?? []).find(a => a._id === usageId) ?? null;
            mod = null;
            label = skill.name;
            const self = await evaluateSelfBonus(usage?.checkBonusSelf ?? "", actor, null, null, skill);
            if (self) mod = self.value;
            if (mod === null) {
                const { AmountInputDialog } = await import("./tnx-dialog.mjs");
                const input = await AmountInputDialog.prompt({
                    title: `判定の修正: ${skill.name}`,
                    label: "達成値への修正値（ペナルティは負の値）",
                    initialValue: 0, min: -99, max: 99, okLabel: "適用",
                    allowOverride: true, overrideLabel: "上書き（入力値をそのまま新しい達成値にする）",
                });
                if (!input || !Number.isFinite(input.value)) return;
                if (input.override) { overrideTo = input.value; mod = input.value - prevAch; }
                else mod = input.value;
                if (mod === 0 && overrideTo === undefined) return;
            }
        }

        // 消費(用途の consumeTargets)は適用の確定時
        if (consumeUses?.length) await applyConsumptionPlan(consumeUses);

        // 達成値の更新と帰結の再計算(上書きは差分に正規化済み=既存の合算機構にそのまま乗る)。
        // 事後修正でも達成値は 0 未満にならない(下限クランプ・2026-07-15 ユーザー確定)
        const newAch = Math.max(0, prevAch + mod);
        const mods = foundry.utils.deepClone(message.getFlag(SCOPE, "checkMods") ?? { rows: [] });
        mods.rows.push({ label, value: mod, ...(overrideTo !== undefined ? { overrideTo } : {}) });
        mods.achievement = newAch;

        const patch = {};
        patch[`flags.${SCOPE}.checkMods`] = mods;
        let newSuccess = checkF?.result?.success === true; // 継続再実行の遷移判定用(目標値つきは下で更新)
        if (checkF) {
            patch[`flags.${SCOPE}.checkResult.result.achievement`] = newAch;
            // 目標値つきは成否・差分値を再計算(差分値は成功時のみ=Check_Rules)
            const tv = rc?.targetValue ?? null;
            if (tv !== null && !attackF) {
                const success = newAch >= tv;
                newSuccess = success;
                const diff = success ? newAch - tv : null;
                patch[`flags.${SCOPE}.checkResult.result.diff`] = diff;
                mods.success = success;
                mods.diff = diff;
                mods.targetValue = tv;
            }
        }
        if (attackF) {
            patch[`flags.${SCOPE}.attackCheck.achievement`] = newAch;
            // 解決済みなら保存済みの相手値に対して再解決(pending は以後の解決が新しい値を使う)
            if (attackF.state === "hit" || attackF.state === "miss") {
                const { resolveNoReaction, resolveOpposed } = await import("./attack-flow-logic.mjs");
                const r = attackF.resolution === "none"
                    ? resolveNoReaction(newAch, attackF.targetValue)
                    : resolveOpposed(newAch, attackF.reactionAchievement ?? 0);
                patch[`flags.${SCOPE}.attackCheck.state`] = r.hit ? "hit" : "miss";
                patch[`flags.${SCOPE}.attackCheck.diff`] = r.diff;
            }
        }

        // フラグ更新(非作者・非GM は GM へ委譲=他者の判定へのペナルティ等・applyMessagePatch)
        await TnxSocketHandler.applyMessagePatch(message, patch);

        // 判定要求由来なら要求カードの結果表示を追随させる
        if (rc?.requestMessageId && checkF) {
            const result = foundry.utils.deepClone(checkF.result);
            result.achievement = newAch;
            if (mods.diff !== undefined) result.diff = mods.diff;
            TnxSocketHandler.emitCheckResult(rc.requestMessageId, rc.actorId, result);
        }

        // 継続処理の再実行(再判定と同型・2026-07-15): rc に載る継続文脈を新達成値で再実行。
        // リアクション=対決再解決/治療・回復・controlNegate=失敗→成功のみ適用/NPC・移動=表示のみ。
        await TnxCheckFlow._rerunContinuation(rc, { achievement: newAch, success: newSuccess, fumble: false },
            { oldSuccess: checkF?.result?.success === true });
    }

    /**
     * GMメニュー「達成値を修正(手動)」(2026-07-14 ユーザー確定): 加減算(既定)か上書き(チェック)で
     * 達成値を修正し、事後修正(手動修正)行として適用する。処理が壊れた時の卓の最終裁定ツールの
     * ため制限しない(ダメージ算出後も可)。
     */
    static async manualEditAchievement(message) {
        const SCOPE = "tokyo-nova-axleration";
        const attackF = message.getFlag(SCOPE, "attackCheck");
        const checkF = message.getFlag(SCOPE, "checkResult");
        if (!checkF && !attackF) return;
        const current = Number(attackF?.achievement ?? checkF?.result?.achievement) || 0;
        const { AmountInputDialog } = await import("./tnx-dialog.mjs");
        const input = await AmountInputDialog.prompt({
            title: `達成値を修正（現在 ${current}）`,
            label: "達成値への修正値（ペナルティは負の値）",
            initialValue: 0, min: -99, max: 99, okLabel: "適用",
            allowOverride: true, overrideLabel: "上書き（入力値をそのまま新しい達成値にする）",
        });
        if (!input || !Number.isFinite(input.value)) return;
        const manual = input.override
            ? { label: "手動修正", mod: input.value - current, overrideTo: input.value }
            : { label: "手動修正", mod: input.value };
        if (manual.mod === 0 && manual.overrideTo === undefined) return;
        await TnxCheckFlow._applyCheckModify(message, { manual });
    }

    static _closeDialog() {
        for (const app of foundry.applications.instances.values()) {
            if (app.id === "tnx-check-dialog") {
                app.close({ animate: false });
                break;
            }
        }
    }

    static _refreshDialog() {
        for (const app of foundry.applications.instances.values()) {
            if (app.id === "tnx-check-dialog") {
                app.render(false);
                break;
            }
        }
    }
}


/**
 * 結果カード/攻撃カードの再判定装飾を描画する(renderChatMessageHTML・tnx.mjs から登録)。
 * checkRecheck フラグ(スナップショット=常時保存)を持つカードにのみ効く。
 * - 達成値クリック: 常時バインド。クリック待ちモード中は付与/修正の発動、モード外は
 *   「再判定可能」(allowRecheck)のプレイヤー入口(素の再判定・2026-07-14 確定=カード上のボタンは廃止)。
 * - 再判定可能な数字には常設の装飾(tnx-recheck-ready)を出す(所有者/RL のみ・一度だけ消費で消える)。
 * 押下時の権限判定は startRecheck 側(所有者/RL)。
 */
export function renderRecheckButton(message, html) {
    const rc = message.getFlag("tokyo-nova-axleration", "checkRecheck");
    if (!rc) return;
    const host = html.querySelector(".tnx-check-result") ?? html.querySelector(".tnx-chat-card") ?? html;

    // 「再判定可能」の直接入口を装飾でも示せるか(表示ゲート。クリック側にも同じ検査がある)
    const actor = game.actors.get(rc.actorId);
    const canDirect = rc.allowRecheck === true
        && !TnxCheckFlow.recheckBlockReason(message)
        && (game.user.isGM || actor?.isOwner === true);

    // 達成値クリック(再判定可能/再判定付与/判定を修正): 達成値行の数値をクリック可能に
    for (const row of host.querySelectorAll(".cr-calc-row, .cr-total-row")) {
        const label = row.querySelector(".cr-calc-label");
        const num = row.querySelector(".cr-total-num");
        if (!label || !num || label.textContent.trim() !== "達成値") continue;
        if (canDirect) {
            num.classList.add("tnx-recheck-ready");
            num.title = "クリックで再判定";
        }
        if (num.classList.contains("tnx-recheck-target")) continue; // 二重バインド防止
        num.classList.add("tnx-recheck-target");
        num.addEventListener("click", () => TnxCheckFlow._onGrantAchievementClick(message));
    }

    // 事後修正の内訳(判定を修正・フラグ checkMods からライブ描画)
    const mods = message.getFlag("tokyo-nova-axleration", "checkMods");
    if (mods?.rows?.length) {
        const esc = foundry.utils.escapeHTML;
        let area = host.querySelector(".tnx-checkmod-area");
        if (area) area.remove(); // フラグ更新でのライブ再描画に備え作り直す
        area = document.createElement("div");
        area.className = "tnx-checkmod-area";
        const line = (label, val, cls = "") => {
            const div = document.createElement("div");
            div.className = `cr-calc-row ${cls}`.trim();
            div.innerHTML = `<span class="cr-calc-label">${label}</span><span class="${cls ? "cr-total-num" : "cr-calc-val"}">${val}</span>`;
            area.appendChild(div);
        };
        for (const r of mods.rows) {
            const v = Number(r.value) || 0;
            // 上書き(2026-07-14)は「→N」表記(内部では差分に正規化して合算している)
            line(`事後修正（${esc(r.label)}）`, r.overrideTo !== undefined ? `→${r.overrideTo}` : (v >= 0 ? `+${v}` : String(v)));
        }
        line("修正後の達成値", String(mods.achievement), "cr-total-row");
        if (mods.targetValue !== undefined && mods.success !== undefined) {
            const diffText = Number.isFinite(mods.diff) ? `（差分値 +${mods.diff}）` : "";
            line("修正後の成否", mods.success ? `成功${diffText}` : "失敗");
        }
        host.appendChild(area);
    }

    // 全幅の「再判定」ボタンは廃止(2026-07-14): 導線は数字クリック(allowRecheck)・
    // 再判定の付与(クリック待ち)・GM の右クリックメニューに集約した
}
