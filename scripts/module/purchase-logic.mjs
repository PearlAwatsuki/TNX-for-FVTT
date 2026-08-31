/**
 * @fileoverview 購入判定の純ロジック(16-3・Foundry 非依存)。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Purchase_and_Modification.md「購入判定」
 * - アウトフィットの購入値を目標値として〈信用〉判定(実装上は購入用途)を行う。
 * - カードなし特例(Check_Rules の信用特例): 達成値 = 外界(実効値) ＋ 消費報酬点。
 * - 購入値が外界点以下のアウトフィットはいつでも入手可能(常時入手)。
 * - 購入値「ー」(mode=none)・「解説参照」(mode=reference)は目標値が定義できず、
 *   購入判定という手続き自体が存在しない(判定ブロックとは別の整理・2026-08-31 設計確定)。
 */

/**
 * 購入経路の決定。
 * @param {{mode?: string, value?: number, total?: number}} buy 対象の購入値フィールド
 * @param {number} mundaneTotal 購入するアクターの外界実効値
 * @returns {{path: "unavailable"|"always"|"check", reason?: "none"|"reference", targetValue?: number}}
 */
export function decidePurchasePath(buy, mundaneTotal) {
    if (buy?.mode === "reference") return { path: "unavailable", reason: "reference" };
    if (buy?.mode !== "value") return { path: "unavailable", reason: "none" };
    const targetValue = Number(buy.total ?? buy.value) || 0;
    if (targetValue <= (Number(mundaneTotal) || 0)) return { path: "always", targetValue };
    return { path: "check", targetValue };
}

/**
 * カードなし特例の結果計算(達成値 = 外界 ＋ 消費報酬点・成否は目標値との比較)。
 * @param {{mundaneTotal: number, bountySpent: number, targetValue: number}} p
 * @returns {{achievement: number, success: boolean, diff: number}}
 */
export function computeNoCardPurchase({ mundaneTotal, bountySpent, targetValue }) {
    const achievement = (Number(mundaneTotal) || 0) + (Number(bountySpent) || 0);
    return { achievement, success: achievement >= targetValue, diff: achievement - targetValue };
}

/**
 * 結果カードの購入判定ブロック(check-result.hbs の purchase)。登場判定の
 * appearanceCardInfo と同型: 継続文脈が無ければ null=ブロック非表示。
 * @param {?{itemName?: string}} cc ctx.purchase(継続文脈)
 * @param {?{success?: boolean}} result 判定結果
 * @returns {?{itemName: string, granted: boolean}}
 */
export function purchaseCardInfo(cc, result) {
    if (!cc) return null;
    return { itemName: cc.itemName ?? "", granted: result?.success === true };
}

/** 購入不可の理由文言(ブラウザのボタン不能化と実行ガードで共用)。 */
export function purchaseUnavailableReason(reason) {
    return reason === "reference"
        ? "購入値が「解説参照」のため購入判定を行えません"
        : "購入値が設定されていないため購入できません";
}

/**
 * プレアクト購入(アクト未開始時のブラウザ購入)の可否。
 * 正本: Purchase_and_Modification.md(2026-08-31 ユーザー verbatim 2件)=
 * 「プレアクト購入はそのキャストの外界以下の購入値を持つアウトフィットを対象に行えます」
 * 「常備化経験点が「-」のアイテムはプレアクト購入できません」。
 * 成立条件＝①購入値が値を持つ ②常備化経験点が値を持つ ③購入値 ≤ 外界(実効値)。
 * ※「常備化経験点による取得は入手であっても購入ではない」は常備化と購入の概念の区別で
 *   あって、常備化経験点欄が購入条件に無関係という意味ではない(Code の誤読を同日是正)。
 * @param {{mode?: string, value?: number, total?: number}} buy
 * @param {{mode?: string}} preserveExp
 * @param {number} mundaneTotal そのキャストの外界実効値
 * @returns {{ok: true, targetValue: number}|{ok: false, reason: "none"|"reference"|"preserveNone"|"overMundane", targetValue?: number}}
 */
export function decidePreActPurchase(buy, preserveExp, mundaneTotal) {
    if (buy?.mode === "reference") return { ok: false, reason: "reference" };
    if (buy?.mode !== "value") return { ok: false, reason: "none" };
    if (preserveExp?.mode !== "value") return { ok: false, reason: "preserveNone" };
    const targetValue = Number(buy.total ?? buy.value) || 0;
    if (targetValue > (Number(mundaneTotal) || 0)) return { ok: false, reason: "overMundane", targetValue };
    return { ok: true, targetValue };
}

/** プレアクト購入不可の理由文言。 */
export function preActUnavailableReason(reason) {
    if (reason === "preserveNone") return "常備化経験点が「ー」のためプレアクト購入できません";
    if (reason === "overMundane") return "購入値が外界を超えるためプレアクト購入できません";
    return purchaseUnavailableReason(reason);
}
