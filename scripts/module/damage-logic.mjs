/**
 * @fileoverview ダメージ算出の純ロジック(Foundry 非依存・テスト対象。フェーズ12-3)。
 * 正本: Damage_Rules.md「ダメージ算出の共通構造」「算出の適用順序」。
 *
 * 最終ダメージ = max(0, [ダメージカード + 攻撃力 + ダメージ修正] − 軽減)
 * チャート参照値 = min(最終ダメージ, 21)
 * - 攻撃力は物理のみ(精神・社会は攻撃力を持たない)。
 * - 軽減(防御力・受け値)は AE を介さず生ダメージに直接引く。21 の頭打ちはチャート参照値のみ。
 * - スタン/説得: 10 以上を全て 10 とみなす(チャート参照の直前・上限21の前)。
 * ※「段」「参照段」は公式に無い Code の造語のため撤廃(2026-07-08 ユーザー指示)。UI 使用禁止。
 */

/**
 * 種別ごとの防御力を集計する(戦闘タブの合算規約と同一・Foundry 非依存)。
 * 準備済み(または準備不要)の armor/cyborg の defence(mode=value)を S/P/I 別に合算する。
 * @param {Array<{type:string, system:object}>} items アクターのアイテム
 * @returns {{S:number, P:number, I:number}}
 */
export function aggregateDefence(items) {
    const out = { S: 0, P: 0, I: 0 };
    for (const i of (items ?? [])) {
        if (i.type !== "armor" && i.type !== "cyborg") continue;
        const s = i.system ?? {};
        if (!(s.isPrepared || s.noPrepareRequired)) continue;
        if (s.defence?.mode !== "value") continue;
        const d = s.defence;
        out.S += d.S_total ?? d.S_defence ?? 0;
        out.P += d.P_total ?? d.P_defence ?? 0;
        out.I += d.I_total ?? d.I_defence ?? 0;
    }
    return out;
}

/**
 * ダメージ種別に対応する防御力を返す(X=装甲無視は軽減なし=0・Damage_Rules)。
 * @param {{S:number,P:number,I:number}} defence
 * @param {string} damageType "S"|"P"|"I"|"X"|""
 * @returns {number}
 */
export function defenceForType(defence, damageType) {
    if (damageType === "S") return defence?.S ?? 0;
    if (damageType === "P") return defence?.P ?? 0;
    if (damageType === "I") return defence?.I ?? 0;
    return 0; // X(装甲無視)・未指定は対応防御力なし
}

/**
 * 最終ダメージとチャート参照値を算出する(Foundry 非依存)。
 * @param {object} p
 * @param {number} p.damageCard  ダメージカード(命中判定のカード数字)
 * @param {number} p.attackPower 攻撃力(物理のみ・精神/社会は0)
 * @param {number} p.modifier    ダメージ修正の合計(用途のダメージ修正・手動含む)
 * @param {number} p.mitigation  軽減の合計(防御力+受け値+報酬点等)
 * @param {boolean} [p.stun]     スタン/説得(10 以上→10)
 * @returns {{raw:number, final:number, stage:number}}
 *   raw=軽減前(カード+攻撃力+修正)、final=軽減後(下限0・スタン適用後)、stage=チャート参照値(min(final,21))
 */
export function computeDamage({ damageCard = 0, attackPower = 0, modifier = 0, mitigation = 0, stun = false }) {
    const raw = (Number(damageCard) || 0) + (Number(attackPower) || 0) + (Number(modifier) || 0);
    let final = Math.max(0, raw - (Number(mitigation) || 0));
    if (stun && final >= 10) final = 10;
    return { raw, final, stage: Math.min(final, 21) };
}
