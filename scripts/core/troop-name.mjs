/**
 * @fileoverview トループの名前固定(フェーズ11-4・正本 Troops.md「種別と名前の規則」)。
 *
 * トループの名前はスタイル名・ワークス名・分身元から導く固定名で、手で編集させない。
 * 導出材料が変わったら追随させる。
 */

import { computeTroopFixedName, findDepartmentSkillName } from "../data/helpers.mjs";

// ─── トループの名前固定(フェーズ11-4・正本 Troops.md「種別と名前の規則」) ─────────
// トループ=「(スタイル名)・トループ（(トループレベル)レベル）」／ワークス設定時=
// 「(組織名)（(スタイル名)(トループレベル)レベル）」／分身=「(分身元キャラ)の分身」で固定する
// (自由入力はエニグマのみ＝個体識別が必要なのはエニグマだけ・2026-07-03 確定)。
// 導出は純粋関数 computeTroopFixedName(data/helpers.mjs・テスト済)。
// 導出名と異なるときだけ update するため、update の連鎖は名前一致で収束する。

/** アクターから導出材料(スタイル名・ワークス名・分身元=所有者名)を集めて固定名を返す。 */
function deriveTroopFixedName(actor) {
    if (actor?.type !== "troop") return null;
    const styleName = actor.items.find(i => i.type === "style")?.name ?? null;
    const orgName   = actor.items.find(i => i.type === "organization")?.name ?? null;
    // 部署技能を取得している場合、ワークス名はその技能名で上書き(2026-07-03 確定。
    // 例: 千早グループ（クグツ2レベル）→ 後方処理課第二班（クグツ2レベル）)
    const worksName = findDepartmentSkillName(actor.items) ?? orgName;
    // 分身元=所有者アクターのライブ解決名(2026-07-07 確定・旧 sourceName テキスト入力は廃止)
    let sourceName = null;
    const ownerUuid = actor.system.ownerActorRef?.uuid ?? "";
    if (ownerUuid) {
        try { sourceName = fromUuidSync(ownerUuid)?.name ?? null; } catch { sourceName = null; }
    }
    return computeTroopFixedName(actor.system, styleName, worksName, sourceName);
}

async function syncTroopName(actor) {
    const fixed = deriveTroopFixedName(actor);
    if (fixed && actor.name !== fixed) await actor.update({ name: fixed });
}



// 名前の導出材料になる型: スタイル・組織・スタイル技能(部署技能の可能性)
const TROOP_NAME_SOURCE_TYPES = new Set(["style", "organization", "styleSkill"]);

/** 名前の追随に関わるフックを登録する(init から呼ぶ)。 */
export function registerTroopNameSync() {
    Hooks.on("updateActor", (actor, diff, options, userId) => {
        if (actor.type !== "troop" || userId !== game.user.id) return;
        if (diff.name !== undefined
            || diff.system?.troopMode !== undefined
            || diff.system?.ownerActorRef !== undefined
            || diff.system?.troopLevel !== undefined
            || diff.system?.hasWorks !== undefined) {
            syncTroopName(actor);
        }
    });

    // 分身名は所有者(分身元)の名前から導出するため、所有者側の改名にも追従させる
    Hooks.on("updateActor", (actor, diff, options, userId) => {
        if (userId !== game.user.id || diff.name === undefined) return;
        if (!["cast", "guest"].includes(actor.type)) return;
        for (const troop of game.actors) {
            if (troop.type === "troop" && troop.system.troopMode === "bunshin"
                && (troop.system.ownerActorRef?.uuid ?? "") === actor.uuid) {
                syncTroopName(troop);
            }
        }
    });

    Hooks.on("createItem", (item, options, userId) => {
        if (userId !== game.user.id) return;
        if (item.parent?.type === "troop" && TROOP_NAME_SOURCE_TYPES.has(item.type)) {
            syncTroopName(item.parent);
        }
    });

    Hooks.on("deleteItem", (item, options, userId) => {
        if (userId !== game.user.id) return;
        if (item.parent?.type === "troop" && TROOP_NAME_SOURCE_TYPES.has(item.type)) {
            syncTroopName(item.parent);
        }
    });

    Hooks.on("updateItem", (item, diff, options, userId) => {
        if (userId !== game.user.id) return;
        if (item.parent?.type !== "troop" || !TROOP_NAME_SOURCE_TYPES.has(item.type)) return;
        const nameChanged = diff.name !== undefined;
        const deptChanged = item.type === "styleSkill" && diff.system?.special?.works !== undefined;
        if (nameChanged || deptChanged) syncTroopName(item.parent);
    });
}
