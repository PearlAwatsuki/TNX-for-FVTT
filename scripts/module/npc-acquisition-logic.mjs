/**
 * @fileoverview NPC取得の純ロジック(Foundry 非依存・テスト対象。フェーズ11-6)。
 * フロー本体(npc-acquisition.mjs)は判定フロー等の Foundry 依存 import を持つため、
 * 対象解決・帰結の規則だけをここに分離する。正本: Troops.md「NPC取得」。
 */

// 旧 findOwnedTroops(所有者逆引きによる対象解決)は 2026-07-07 のユーザー裁定で廃止——
// 呼び出す対象は用途側の取得アクター参照(acquireActorRef)で明示設定する。
// 所有者参照(ownerActorRef)は経験点計上・分身名導出・使用回数共有の紐づけとして存続する。

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
