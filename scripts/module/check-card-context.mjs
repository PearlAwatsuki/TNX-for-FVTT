/**
 * @fileoverview 判定結果チャットカードの基底コンテキスト(2026-07-19 ユーザー指示で基底化)。
 *
 * 判定結果を表示する全チャットカード(結果カード・対決判定カード・リアクション結果カード・
 * 移動カード)は、**基底(ヘッダー/カード行/標準計算行)に情報を足す形式**で実装する——各カードが
 * 別々に設計されるとカード値・能力値・報酬点・判定ボーナス等の内訳が落ちる(攻撃カード/オープン
 * リアクションの内訳オミットをユーザー指摘・2026-07-19)。
 *
 * - テンプレート部品: templates/chat/parts/check-card-row.hbs(ヘッダー+カード行)・
 *   check-calc-rows.hbs(標準計算行=総計を含まない)。
 * - 本モジュールは部品が要求するコンテキストを一箇所で組み立てる(表示の再実装は表示ずれの温床)。
 */

const SUIT_SYMBOL = Object.freeze({ spade: "♠", club: "♣", heart: "♥", diamond: "♦" });
const ABILITY_LABEL = Object.freeze({ reason: "理性", passion: "感情", life: "生命", mundane: "外界" });

/** カードの生の数字→表記(A/J/Q/K・その他は数字)。 */
export const CARD_NUM_LABEL = (n) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" }[n] ?? String(n));

/** スート→シンボル(基底カード行と同じ表)。 */
export function suitSymbolOf(suit) {
    return SUIT_SYMBOL[suit] ?? "";
}

/**
 * 判定結果カードの基底コンテキストを組み立てる。
 * @param {object} p
 * @param {string} p.skillLabel ヘッダーの技能ラベル
 * @param {string} p.typeLabel ヘッダーの種別タグ(技能判定/物理攻撃/リアクション/移動…)
 * @param {object|null} p.card プレイしたカード(name を読む)
 * @param {string} p.suit 使用スート
 * @param {object} p.result 判定結果(TnxCheckEngine)
 * @param {boolean} [p.fromDeck] 山札判定
 * @param {boolean} [p.trumpUsed] 切り札使用
 * @param {boolean} [p.suitMismatch] スート不一致(判定不成立)
 * @param {Array} [p.checkSources] 判定ボーナスの供給元内訳
 * @param {boolean} [p.isRecheck] 再判定の置き換え
 * @returns {object} check-card-row / check-calc-rows が要求するコンテキスト
 */
export function buildCheckCardContext({
    skillLabel, typeLabel, card, suit, result,
    fromDeck = false, trumpUsed = false, suitMismatch = false,
    checkSources = [], isRecheck = false,
} = {}) {
    return {
        skillLabel,
        typeLabel,
        cardName:   card?.name ?? "",
        suit,
        suitSymbol: suitSymbolOf(suit),
        abilityLabel: ABILITY_LABEL[result?.abilityKey] ?? "",
        result,
        checkSources,
        hasCheckBonus: (result?.checkBonus ?? 0) !== 0,
        // 代用判定(2026-07-09): 指定技能と手動修正を内訳に明示
        substitution: result?.substitution ?? null,
        manualModDisplay: result?.manualMod
            ? (result.manualMod > 0 ? `+${result.manualMod}` : String(result.manualMod))
            : "",
        // スート変更(2026-07-12): 元→後を内訳に明示
        suitChangedDisplay: result?.suitChangedFrom
            ? `${suitSymbolOf(result.suitChangedFrom) || result.suitChangedFrom} → ${suitSymbolOf(suit) || suit}`
            : null,
        // カード数字の上書き(2026-07-13): 元→後(A/J/Q/K 表記)を内訳に明示
        cardOverrideDisplay: result?.cardOverride
            ? `${CARD_NUM_LABEL(result.cardOverride.from)} → ${CARD_NUM_LABEL(result.cardOverride.to)}`
            : null,
        isFixed21: result?.fixedAt21 === true,
        fromDeck, trumpUsed, suitMismatch, isRecheck,
    };
}
