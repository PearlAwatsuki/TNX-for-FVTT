/**
 * @fileoverview TnxJudgmentEngine - 判定計算ロジックの集約
 *
 * UI（ダイアログ・チャット）から切り離した純粋な計算層。
 * Foundry ドキュメントに依存しない（actor.system を受け取るだけ）。
 *
 * 判定ルール正本: llm-wiki/01_Wiki/Game_Rules/Judgment_Rules.md
 */

/** スート → 能力値キー対応表 */
export const SUIT_TO_ABILITY = Object.freeze({
    spade:   "reason",
    club:    "passion",
    heart:   "life",
    diamond: "mundane",
});

/** 全スート一覧 */
export const ALL_SUITS = Object.freeze(["spade", "club", "heart", "diamond"]);

/**
 * カードの基本判定値を算出する。
 *
 * @param {object} opts
 * @param {number}  opts.numericValue  Card.value（Foundry の数値: A=1, 2〜10, J=11, Q=12, K=13）
 * @param {boolean} opts.isJoker       Joker かどうか
 * @param {boolean} opts.fixedAt21     A を「達成値21固定」として扱うか
 * @param {number}  [opts.declaredValue]  Joker/切り札使用時にプレイヤーが宣言した値
 * @returns {number|"FUMBLE"|"FIXED_21"}
 *   FUMBLE    = ファンブル（山札判定での絵札）
 *   FIXED_21  = A の21固定選択（達成値を21に固定。能力値・報酬点を無視）
 *   number    = 通常の判定値
 */
export function getCardJudgmentValue({ numericValue, isJoker, fixedAt21 = false, declaredValue = null, isFromDeck = false }) {
    if (isJoker || declaredValue !== null) {
        return declaredValue ?? 0;
    }

    const isFaceCard = numericValue >= 11 && numericValue <= 13;
    const isAce      = numericValue === 1;

    if (isFaceCard) {
        if (isFromDeck) return "FUMBLE";
        return 10;
    }

    if (isAce) {
        if (fixedAt21) return "FIXED_21";
        return 11;
    }

    return numericValue;
}

/**
 * スートから能力値実効値を取得する。
 *
 * @param {string} suit           "spade"|"club"|"heart"|"diamond"
 * @param {object} abilitiesCtx   tnx-cast-sheet.mjs _prepareAbilities() が生成した abilities オブジェクト
 *                                （各能力値に totalValue / totalControl を持つ）
 * @returns {{ abilityKey: string, totalValue: number, totalControl: number }}
 */
export function getAbilityBySuit(suit, abilitiesCtx) {
    const abilityKey = SUIT_TO_ABILITY[suit];
    const ability    = abilitiesCtx?.[abilityKey] ?? { totalValue: 0, totalControl: 0 };
    return {
        abilityKey,
        totalValue:   ability.totalValue   ?? 0,
        totalControl: ability.totalControl ?? 0,
    };
}

/**
 * 技能判定の達成値を算出する。
 *
 * 達成値 = cardValue + 能力値実効値 + 使用報酬点
 * A の21固定選択時は 21 で完全固定（能力値・報酬点を無視）。
 *
 * @param {object} opts
 * @param {number|"FUMBLE"|"FIXED_21"} opts.cardJudgmentValue  getCardJudgmentValue() の返り値
 * @param {string}  opts.suit           使用したカードのスート
 * @param {object}  opts.abilitiesCtx   シートコンテキストの abilities
 * @param {number}  [opts.bountyUsed]   使用報酬点（デフォルト0）
 * @param {number}  [opts.targetValue]  目標値（成否判定に使用）
 * @returns {JudgmentCheckResult}
 */
export function calcSkillCheck({ cardJudgmentValue, suit, abilitiesCtx, bountyUsed = 0, targetValue = null, checkBonus = 0 }) {
    if (cardJudgmentValue === "FUMBLE") {
        return { fumble: true, success: false, achievement: null, diff: null };
    }

    const { abilityKey, totalValue } = getAbilityBySuit(suit, abilitiesCtx);

    if (cardJudgmentValue === "FIXED_21") {
        const achievement = 21;
        const diff        = targetValue !== null ? achievement - targetValue : null;
        return {
            fumble:      false,
            fixedAt21:   true,
            abilityKey,
            abilityVal:  totalValue,
            bountyUsed:  0,
            cardValue:   "A(21固定)",
            achievement,
            targetValue,
            diff,
            success:     targetValue !== null ? achievement >= targetValue : null,
        };
    }

    const achievement = cardJudgmentValue + totalValue + bountyUsed + checkBonus;
    const diff        = targetValue !== null ? achievement - targetValue : null;
    return {
        fumble:      false,
        fixedAt21:   false,
        abilityKey,
        abilityVal:  totalValue,
        bountyUsed,
        checkBonus,
        cardValue:   cardJudgmentValue,
        achievement,
        targetValue,
        diff,
        success:     targetValue !== null ? achievement >= targetValue : null,
    };
}

/**
 * 制御判定の成否を判定する（下方判定）。
 *
 * カード値 ≤ 制御値実効値 → 成功。A は11として扱う（21固定なし）。
 *
 * @param {object} opts
 * @param {number|"FUMBLE"} opts.cardJudgmentValue  getCardJudgmentValue() の返り値（fixedAt21 は渡さない）
 * @param {string}  opts.suit         使用したカードのスート
 * @param {object}  opts.abilitiesCtx シートコンテキストの abilities
 * @returns {ControlCheckResult}
 */
export function calcControlCheck({ cardJudgmentValue, suit, abilitiesCtx }) {
    if (cardJudgmentValue === "FUMBLE") {
        return { fumble: true, success: false, cardValue: null, controlVal: null };
    }

    const { abilityKey, totalControl } = getAbilityBySuit(suit, abilitiesCtx);
    const cardValue = cardJudgmentValue === "FIXED_21" ? 11 : cardJudgmentValue;

    return {
        fumble:     false,
        abilityKey,
        controlVal: totalControl,
        cardValue,
        success:    cardValue <= totalControl,
    };
}

/**
 * 複数技能の使用可能スートの積集合を返す。
 *
 * @param {Array<{suits: {spade, club, heart, diamond}}>} skillSystems
 *   各技能の system オブジェクト（suits フィールドを持つ）
 * @returns {string[]}  使用可能スートの配列（空 = 組み合わせ不可）
 */
export function getComboSuits(skillSystems) {
    if (!skillSystems.length) return [...ALL_SUITS];
    return ALL_SUITS.filter(suit => skillSystems.every(s => s.suits?.[suit] === true));
}

/**
 * @typedef {object} JudgmentCheckResult
 * @property {boolean}      fumble
 * @property {boolean}      fixedAt21
 * @property {string}       abilityKey
 * @property {number}       abilityVal
 * @property {number}       bountyUsed
 * @property {number|string} cardValue
 * @property {number|null}  achievement
 * @property {number|null}  targetValue
 * @property {number|null}  diff
 * @property {boolean|null} success
 *
 * @typedef {object} ControlCheckResult
 * @property {boolean}      fumble
 * @property {string}       abilityKey
 * @property {number}       controlVal
 * @property {number|null}  cardValue
 * @property {boolean}      success
 */
