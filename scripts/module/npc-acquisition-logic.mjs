/**
 * @fileoverview NPC取得の純ロジック(Foundry 非依存・テスト対象。フェーズ11-6)。
 * フロー本体(npc-acquisition.mjs)は判定フロー等の Foundry 依存 import を持つため、
 * 対象解決・帰結の規則だけをここに分離する。正本: Troops.md「NPC取得」。
 */

/**
 * 所有者逆引き。使用者を所有者(ownerActorRef)として記録し、種別がモードと一致する
 * トループ級アクターを抽出する(所有者未設定=敵対トループ等は対象外)。
 * @param {Array<{type:string, system:object}>} actors 検索対象(ワールドアクター)
 * @param {string} ownerUuid 使用者(呼び出し元)の UUID
 * @param {string} mode "troop" | "enigma" | "bunshin"
 * @returns {Array<object>}
 */
export function findOwnedTroops(actors, ownerUuid, mode) {
    return (actors ?? []).filter(a =>
        a.type === "troop"
        && a.system?.troopMode === mode
        && (a.system?.ownerActorRef?.uuid ?? "") === ownerUuid
    );
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
