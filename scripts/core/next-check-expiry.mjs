/** 判定確定後の一回性AE削除。パッシブや再付与された実体は触らない。 */
import { resolveNextCheckEntry } from "../rules/next-check-expiry.mjs";
import { runSerial } from "./serial-queue.mjs";
import { SYSTEM_ID } from "../constants.mjs";

/** 命中していればダメージ算出を待つ。全対象回避・ファンブル等はダメージへ進まない終端。 */
export function attackResolutionComplete(attack) {
    return !!attack && attack.isAttack !== false && (attack.damageRolled === true
        || ["fumble", "miss", "failed"].includes(attack.state)
        || (!!attack.targets?.length && attack.targets.every(target => target.state === "miss")));
}

export async function expireResolvedAttackEffects(message) {
    const attack = message?.flags?.[SYSTEM_ID]?.attackCheck;
    if (!attackResolutionComplete(attack) || !attack.nextCheckExpiry?.entries?.length) return;
    const actor = await fromUuid(attack.attackerUuid);
    if (actor?.isOwner) await expireNextCheckEffects(actor, attack.nextCheckExpiry);
}

/** リアクションによる終端と、ダメージ算出保存後の中断からの再開をactiveGMが処理する。 */
export function registerNextCheckExpiryHooks() {
    const recover = message => {
        if (game.users?.activeGM?.id !== game.user?.id) return;
        return expireResolvedAttackEffects(message).catch(error => {
            console.error("TNX | 判定1回持続の失効処理に失敗", error);
            ui.notifications.error("判定1回持続の効果を解除できませんでした。");
        });
    };
    Hooks.on("updateChatMessage", recover);
    Hooks.once("ready", async () => {
        for (const message of game.messages ?? []) await recover(message);
    });
}

export async function expireNextCheckEffects(actor, snapshot) {
    if (!actor || !snapshot?.entries?.length || snapshot.actorUuid !== actor.uuid) return;
    await runSerial(actor.uuid, async () => {
        const groups = new Map();
        for (const entry of snapshot.entries) {
            const current = resolveNextCheckEntry(actor, entry);
            if (!current) continue;
            const ids = groups.get(current.owner) ?? new Set();
            ids.add(current.effect.id);
            groups.set(current.owner, ids);
        }
        for (const [owner, ids] of groups) await owner.deleteEmbeddedDocuments("ActiveEffect", [...ids]);
    });
}
