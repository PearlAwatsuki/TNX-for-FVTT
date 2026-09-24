/** 派生計算の外側で準備解除を保存する。転送同期と同じActorキューを使う。 */
import { planInvalidOutfitPreparation } from "../rules/outfit-preparation.mjs";
import { runSerial } from "./serial-queue.mjs";

export async function reconcileOutfitPreparation(actor) {
    return runSerial(actor.uuid, async () => {
        const invalid = planInvalidOutfitPreparation(actor);
        if (!invalid.length) return [];
        await actor.updateEmbeddedDocuments("Item", invalid.map(({ id }) => ({ _id: id, "system.isPrepared": false })), { tnxPreparationReconcile: true });
        return invalid;
    });
}

export function registerOutfitPreparationHooks() {
    const pending = new Set();
    const schedule = (document, options, userId) => {
        if (game.user.id !== userId || options?.tnxPreparationReconcile || options?.tnxAEMigration) return;
        const owner = document.documentName === "ActiveEffect" ? document.parent : document;
        const actor = owner?.documentName === "Actor" ? owner : owner?.actor;
        if (!actor || pending.has(actor.uuid)) return;
        pending.add(actor.uuid);
        // 作成・更新と転送コピーの同期が終わってから、最新の実効属性を読む。
        setTimeout(() => {
            pending.delete(actor.uuid);
            void reconcileOutfitPreparation(actor).catch(error => {
                console.error("TNX | 準備条件の再検証に失敗しました", error);
                ui.notifications?.error("準備条件の変更を保存できませんでした。アウトフィットの準備状態を確認してください。");
            });
        }, 0);
    };
    Hooks.on("createActiveEffect", schedule);
    Hooks.on("deleteActiveEffect", schedule);
    Hooks.on("updateActiveEffect", (effect, _changed, options, userId) => schedule(effect, options, userId));
    Hooks.on("updateItem", (item, changed, options, userId) => {
        const keys = ["isPrepared", "parentItemId", "parentSlotKind", "part", "partOptional", "partRelation", "majorCategory", "minorCategory", "additionalCategories", "slots"];
        if (keys.some(key => Object.hasOwn(changed.system ?? {}, key) || Object.hasOwn(changed, `system.${key}`))) schedule(item, options, userId);
    });
}
