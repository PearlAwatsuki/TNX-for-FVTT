/**
 * @fileoverview 攻撃フローの純ロジック(Foundry 非依存・テスト対象。フェーズ12-2)。
 * 正本: Damage_Rules.md(命中判定・目標値)・Combat_Flow.md(対決の比べ合い)・
 * Check_Rules.md「差分値」(達成値≥目標値で成功・差分値=達成値−目標値)。
 */

/**
 * ダメージカードの数字(N◎VA カード数字: 絵札=10・A=11)。
 * 命中判定で出したカードの判定値から導く。A の 21固定は達成値側の選択であり、
 * ダメージカードとしての A は 11(Damage_Rules)。ファンブル等は null(命中しないため未使用)。
 * @param {number|"FIXED_21"|"FUMBLE"} cardCheckValue
 * @returns {number|null}
 */
export function novaDamageCardValue(cardCheckValue) {
    if (typeof cardCheckValue === "number") return cardCheckValue;
    if (cardCheckValue === "FIXED_21") return 11;
    return null;
}

/**
 * リアクションなしの命中確定: 目標値=対象の制御値(出したスートに対応)。
 * @param {number} achievement 攻撃の達成値
 * @param {number} control     対象の対応制御値(実効値)
 * @returns {{hit: boolean, diff: number, targetValue: number}}
 */
export function resolveNoReaction(achievement, control) {
    const targetValue = Number(control) || 0;
    const diff = (Number(achievement) || 0) - targetValue;
    return { hit: diff >= 0, diff, targetValue };
}

/**
 * 対決の命中確定: 相手のリアクション判定の達成値を目標値として扱う(Check_Rules 確定)。
 * 攻撃達成値≥リアクション達成値で命中(達成値≥目標値の一般規約との合成)。
 * 未満は攻撃側敗北=その時点で攻撃終了(Combat_Flow)。
 * @param {number} attackAchievement
 * @param {number} reactionAchievement リアクション不成立(ファンブル/スート不一致)は 0 を渡す
 * @returns {{hit: boolean, diff: number, targetValue: number}}
 */
export function resolveOpposed(attackAchievement, reactionAchievement) {
    const targetValue = Number(reactionAchievement) || 0;
    const diff = (Number(attackAchievement) || 0) - targetValue;
    return { hit: diff >= 0, diff, targetValue };
}

/**
 * 攻撃系統ごとのリアクション導線(2026-07-08 確定)。
 * パリー/ドッジは物理攻撃のリアクション。精神・社会は「リアクション」「リアクションしない」の2択。
 * @param {"physical"|"mental"|"social"} category
 * @returns {string[]} モード配列("dodge"|"parry"|"reaction"|"none")
 */
export function attackReactionModes(category) {
    return category === "physical" ? ["dodge", "parry", "none"] : ["reaction", "none"];
}
