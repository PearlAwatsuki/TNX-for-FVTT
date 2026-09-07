/**
 * @fileoverview リアクション併存の純ロジック(Foundry 非依存・テスト対象・2026-07-18)。
 * 正本: Combat_Flow.md「リアクションの併存ルール」「移動・離脱の任意リアクション」
 * 「リアクション併存の裁定」。
 *
 * - 本人のリアクションと代理リアクションは併存し、特殊な効果がなければ**高い方が適用**される。
 * - 命中=対象の**全防御要素**(本人スキップ時の制御値＋各リアクションの独立対決[受動有利])を
 *   破った場合のみ。
 * - 受け値=成立したパリーの**最大1つのみ**。防御力は常に攻撃対象自身(ダメージ側)。
 * - 社会ダメージの報酬点軽減ゲート=**代理でも成立していれば開く**(消費は対象本人の報酬点)。
 * - オープンリアクション(対象なし対決)=キャラごとに任意でクリック・結果は最高達成値の1件のみ。
 */

import { resolveNoReaction, resolveOpposed } from "./attack-flow.mjs";
import { confrontationReactionTypes, confrontationSkillRows, confrontationHasCannot } from "./confrontation.mjs";

/**
 * リアクション要素。
 * @typedef {object} ReactionEntry
 * @property {string} mode リアクション手段(dodge/parry/mentalReaction/…/reaction/other)
 * @property {number} achievement リアクション判定の達成値
 * @property {boolean} established 判定の成立(ファンブル/スート不一致でなければ成立・勝敗不問)
 * @property {number} [parryGuard] パリー受け値(パリー時のみ)
 * @property {string} [reactorName] リアクター名
 * @property {boolean} [isSelf] 攻撃対象本人のリアクションか
 */

/** リアクションの実効達成値(不成立は 0 として対決する)。 */
const effAch = (r) => (r.established ? (Number(r.achievement) || 0) : 0);

/**
 * 対象1体の防御合成(2026-07-18 裁定)。
 * 防御要素: 本人スキップ時の制御値(達成値≥制御値で命中)＋各リアクション(受動有利=上回りで命中)。
 * 命中は**全要素を破った場合のみ**。表示上の適用リアクション=実効達成値が最高の1件。
 * @param {number} attackAchievement 攻撃(能動)側の達成値
 * @param {object} p
 * @param {number} [p.controlValue] 対象の対応制御値(本人スキップ時の防御要素)
 * @param {"reacted"|"skipped"|null} [p.selfDecision] 本人の決断(null=未決断)
 * @param {ReactionEntry[]} [p.reactions] 本人＋代理のリアクション
 * @returns {{state:"pending"|"hit"|"miss", resolution:string|null, reactionAchievement:number|null,
 *   diff:number|null, parryGuard:number, reactionEstablished:boolean}}
 */
export function resolveTargetDefense(attackAchievement, { controlValue = 0, selfDecision = null, reactions = [] } = {}) {
    const atk = Number(attackAchievement) || 0;
    const elements = [];
    if (selfDecision === "skipped") elements.push(resolveNoReaction(atk, controlValue));
    for (const r of reactions) elements.push(resolveOpposed(atk, effAch(r)));

    // 適用リアクション=実効達成値が最高の1件(高い方が適用・2026-07-18 ユーザー提供ルール)
    let effective = null;
    for (const r of reactions) {
        if (!effective || effAch(r) > effAch(effective)) effective = r;
    }

    // 受け値=成立したパリーの最大1つのみ(2026-07-18 裁定)
    const parryGuard = reactions
        .filter(r => r.mode === "parry" && r.established)
        .reduce((max, r) => Math.max(max, Number(r.parryGuard) || 0), 0);

    // 成立ゲート(社会軽減)=代理でも成立していれば開く(2026-07-18 裁定)
    const reactionEstablished = reactions.some(r => r.established === true);

    // 状態: いずれかの要素に止められたら miss(確定)。全要素を破っていても本人未決断なら pending
    let state;
    if (elements.some(e => !e.hit)) state = "miss";
    else if (!elements.length || selfDecision === null) state = "pending";
    else state = "hit";

    // 差分値=最も固い防御要素との差(全要素命中時のみ・min)
    const diff = state === "hit"
        ? elements.reduce((min, e) => Math.min(min, e.diff), Infinity)
        : null;

    return {
        state,
        resolution: effective ? effective.mode : (selfDecision === "skipped" ? "none" : null),
        reactionAchievement: effective ? effAch(effective) : null,
        diff: Number.isFinite(diff) ? diff : null,
        parryGuard,
        reactionEstablished,
    };
}

/**
 * オープンリアクション(対象なし対決)の解決(2026-07-18)。
 * 結果=最終的な目標値として表示するのは**成立したリアクションの最高達成値の1件のみ**。
 * 受動有利: 実行側達成値が最高値を上回れば判定成功・同値以下は失敗。
 * @param {number} execAchievement 実行(能動)側の達成値
 * @param {ReactionEntry[]} reactions
 * @returns {{failed: boolean, effective: ReactionEntry|null}}
 */
export function resolveOpenReactions(execAchievement, reactions = []) {
    let effective = null;
    for (const r of reactions) {
        if (r.established !== true) continue;
        if (!effective || (Number(r.achievement) || 0) > (Number(effective.achievement) || 0)) effective = r;
    }
    if (!effective) return { failed: false, effective: null };
    const { hit } = resolveOpposed(execAchievement, effective.achievement);
    return { failed: !hit, effective };
}

/**
 * 対決欄からリアクションボタン構成を導く(2026-07-18 ユーザー確定)。
 * - ドッジ/パリー行=それぞれ専用ボタン。
 * - それ以外のリアクション系行(精神/社会/移動妨害/離脱妨害)・技能名行=**「リアクション」1ボタンに統合**。
 *   資格タイプは該当行のタイプ∪汎用「リアクション」・候補には無印技能名行の列挙技能も加える。
 * - 「リアクション（その他）」=統合リアクションボタンが**無いときだけ**置く(「リアクション、
 *   リアクション」と並ぶ見た目の悪さを避ける裁定の一般形。ドッジ/パリーのみの物理攻撃と
 *   「不可」のみ[対決不可無視の入口]で出る)。
 * @param {Array<{value:string, name?:string}>} rows 対決欄
 * @returns {{cannot:boolean, dodge:boolean, parry:boolean,
 *   reaction: {types:string[], skillKeys:string[]}|null, other:boolean}}
 */
export function reactionButtonPlan(rows) {
    const types = confrontationReactionTypes(rows);
    const dodge = types.includes("dodge");
    const parry = types.includes("parry");
    const unifiedTypes = types.filter(t => t !== "dodge" && t !== "parry");
    const skillRows = confrontationSkillRows(rows);
    const reaction = (unifiedTypes.length || skillRows.length)
        ? {
            // 汎用「リアクション」タイプは常に資格に含める(行に汎用行があっても重複しない)
            types: [...new Set([...unifiedTypes, "reaction"])],
            skillKeys: skillRows.filter(r => !r.asterisk).map(r => r.key),
        }
        : null;
    return {
        cannot: confrontationHasCannot(rows),
        dodge, parry, reaction,
        other: !reaction,
    };
}
