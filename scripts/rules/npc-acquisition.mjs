/**
 * @fileoverview NPC取得の純ロジック(Foundry 非依存・テスト対象。フェーズ11-6)。
 * フロー本体(npc-acquisition.mjs)は判定フロー等の Foundry 依存 import を持つため、
 * 対象解決・帰結の規則だけをここに分離する。正本: Troops.md「NPC取得」。
 */

// 旧 findOwnedTroops(所有者逆引きによる対象解決)は 2026-07-07 のユーザー裁定で廃止——
// 呼び出す対象は用途側の取得アクター参照(acquireActorRef)で明示設定する。
// 所有者参照(ownerActorRef)は経験点計上・分身名導出・使用回数共有の紐づけとして存続する。

/**
 * 分身再同期用の能力値修正の焼き込みを導く(2026-07-07 確定=数値は本体と完全一致させる)。
 * troop は成長欄を持たない(能力値=スタイル基本値+トループレベル+修正)ため、本体の成長分を
 * 修正値欄へ畳み込む: 修正値=本体の修正値+成長 / 制御修正値=本体の制御修正値+制御成長。
 * 呼び出し側で troopLevel=0 とあわせて適用すると、スタイル・アウトフィットが同一なら
 * 実効値が本体と一致する。
 * @param {object} ownerSystem 本体(分身元)アクターの system
 * @returns {Record<string, number>} update 用のドットパスマップ
 */
export function buildBunshinAbilityMods(ownerSystem) {
    const out = {};
    for (const key of ["reason", "passion", "life", "mundane"]) {
        const a = ownerSystem?.[key] ?? {};
        out[`system.${key}.mod`]        = (Number(a.mod) || 0) + (Number(a.growth) || 0);
        out[`system.${key}.controlMod`] = (Number(a.controlMod) || 0) + (Number(a.controlGrowth) || 0);
    }
    return out;
}

/**
 * 判定結果から取得の帰結を導く。
 * - トループ/エニグマ: 達成値がそのまま人数/エニグマポイント(0 以下・非数は不成立)。
 * - 分身: 目標値10(達成値10以上で成功=通常判定の成功規約。success は判定側で算出済み)。
 * - ファンブルは全モードで不成立。
 * @param {string} mode "troop" | "enigma" | "bunshin"
 * @param {{achievement:number|null, fumble?:boolean, success?:boolean|null}} result 判定結果
 * @returns {{acquired:boolean, heads?:number, reason?:string}}
 */
export function computeAcquisitionOutcome(mode, result) {
    if (result?.fumble) return { acquired: false, reason: "fumble" };
    if (mode === "bunshin") {
        return result?.success === true
            ? { acquired: true }
            : { acquired: false, reason: "failed" };
    }
    const achievement = Number(result?.achievement);
    if (!Number.isFinite(achievement) || achievement <= 0) {
        return { acquired: false, reason: "zero" };
    }
    return { acquired: true, heads: achievement };
}
