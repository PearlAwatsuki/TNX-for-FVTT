/**
 * @fileoverview 住宅施設と住宅エリアの解決(住宅施設の実効値・シーンの舞台候補)。
 *
 * 住宅施設(residence)は基本値(登場判定目標値・電脳/アナログセキュリティ)を持ち、組み合わせた
 * 住宅エリア(housingArea)が修正値とセキュリティ・ランクを供給する(フェーズ6-4 の分担)。
 * 実効値＝住宅施設の実効値(AE 込み)＋住宅エリアの修正値。
 *
 * 14-8 で、シーンの「舞台」に住宅施設を選べるようになったため、シートに閉じていた解決を
 * ここへ切り出してシーン開始ダイアログと共用する(住宅施設は登場判定目標値とエリアを
 * そもそも持っているので、舞台にしたシーンはその2つをそのまま読み取って適用する)。
 */

/**
 * 住宅施設が参照する住宅エリア(修正値の集合)を解決する。
 * `housingArea` は辞典選択・ドロップのいずれも UUID を格納する(useHousingAreaDrop は入力 UI の
 * モード切替であって保存形式を区別しない)ため、必ず fromUuid で解決する。
 * @param {object} sys 住宅施設の system(派生済み)
 * @returns {Promise<?{area:string, buyRatingMod:number, preserveExpMod:number,
 *                     appearanceTargetMod:number, cyberSecurityMod:number,
 *                     analogSecurityMod:number, slotMod:number}>}
 */
export async function resolveHousingAreaMods(sys) {
    const ref = sys?.housingArea;
    if (!ref) return null;
    try {
        const areaItem = await fromUuid(ref);
        if (!areaItem || areaItem.type !== "housingArea") return null;
        const s = areaItem.system;
        return {
            area:                s.area                ?? "none",
            buyRatingMod:        s.buyRatingMod         ?? 0,
            preserveExpMod:      s.preserveExpMod       ?? 0,
            appearanceTargetMod: s.appearanceTargetMod  ?? 0,
            cyberSecurityMod:    s.cyberSecurityMod     ?? 0,
            analogSecurityMod:   s.analogSecurityMod    ?? 0,
            slotMod:             s.slotMod              ?? 0,
        };
    } catch { return null; }
}

/**
 * 住宅施設を舞台にしたときの登場判定パラメータ(14-8)。
 * 目標値は**実効値**(AE の着地先 `appearanceTargetTotal` を優先)＋住宅エリアの修正値、
 * エリアは住宅エリアのセキュリティ・ランク(`none` はシーンのエリア未設定と同じ空文字)。
 * @param {object} sys 住宅施設の system(派生済み)
 * @returns {Promise<{targetValue:number, area:string}>}
 */
export async function residenceStageParams(sys) {
    const mods = await resolveHousingAreaMods(sys);
    const base = sys?.appearanceTargetTotal ?? sys?.appearanceTarget ?? 0;
    const rank = mods?.area ?? "none";
    return {
        targetValue: Number(base) + Number(mods?.appearanceTargetMod ?? 0),
        area:        rank === "none" ? "" : rank,
    };
}

/**
 * シーン開始ダイアログの「舞台」候補＝対象キャラクターが**所持している住宅施設**
 * (2026-08-09 ユーザー確定)。所持していれば足りるので、購入判定での入手などで絞り込まない。
 * 並びは対象キャラクターの並び→所持順。
 * @param {Array<string>} actorIds 候補を出すキャラクター(stageCandidateActorIds の結果)
 * @returns {Promise<Array<{value:string, label:string, actorId:string, area:string,
 *                          targetValue:number}>>}
 *          value=`<actorId>:<itemId>`(選択値)・label=「キャスト名／住宅施設名」
 */
export async function listStageCandidates(actorIds) {
    const out = [];
    for (const actorId of (actorIds ?? [])) {
        const actor = game.actors.get(actorId);
        if (!actor) continue;
        for (const item of actor.items.filter(i => i.type === "residence")) {
            const params = await residenceStageParams(item.system);
            out.push({
                value: `${actor.id}:${item.id}`,
                label: `${actor.name}／${item.name}`,
                actorId: actor.id,
                area: params.area,
                targetValue: params.targetValue,
            });
        }
    }
    return out;
}
