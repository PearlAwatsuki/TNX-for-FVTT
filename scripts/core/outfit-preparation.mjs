/** 派生計算の外側で準備解除を保存する。転送同期と同じActorキューを使う。 */
import { planInvalidOutfitPreparation } from "../rules/outfit-preparation.mjs";
import { runSerial } from "./serial-queue.mjs";
import { isOutfitUnusable } from "../data/item/helpers.mjs";

export async function reconcileOutfitPreparation(actor, preparedItemIds = []) {
    return runSerial(actor.uuid, async () => {
        const invalid = planInvalidOutfitPreparation(actor);
        if (invalid.length) {
            await actor.updateEmbeddedDocuments("Item", invalid.map(({ id }) => ({ _id: id, "system.isPrepared": false })), { tnxPreparationReconcile: true });
        }
        // 準備した順に最初の武器を設定する。既存の選択や、後から選んだ生身は維持する。
        if (!actor.system.weaponRefs?.attackItemId) {
            const items = Array.from(actor.items);
            const weapon = preparedItemIds.map(id => items.find(item => item.id === id)).find(item =>
                item?.type === "weapon"
                && (item.system.isPreparedEffective ?? item.system.isPrepared)
                && !invalid.some(entry => entry.id === item.id)
                && !isOutfitUnusable(item.system));
            if (weapon) await actor.update({ "system.weaponRefs.attackItemId": weapon.id });
        }
        return invalid;
    });
}

export function registerOutfitPreparationHooks() {
    const pending = new Map();
    const schedule = (document, options, userId, preparedItemId = null) => {
        if (game.user.id !== userId || options?.tnxPreparationReconcile || options?.tnxAEMigration) return;
        const owner = document.documentName === "ActiveEffect" ? document.parent : document;
        const actor = owner?.documentName === "Actor" ? owner : owner?.actor;
        if (!actor) return;
        const queued = pending.get(actor.uuid);
        if (queued) {
            if (preparedItemId) queued.push(preparedItemId);
            return;
        }
        const preparedItemIds = preparedItemId ? [preparedItemId] : [];
        pending.set(actor.uuid, preparedItemIds);
        // 作成・更新と転送コピーの同期が終わってから、最新の実効属性を読む。
        setTimeout(() => {
            pending.delete(actor.uuid);
            void reconcileOutfitPreparation(actor, preparedItemIds).catch(error => {
                console.error("TNX | 準備条件の再検証に失敗しました", error);
                ui.notifications?.error("準備条件の変更を保存できませんでした。アウトフィットの準備状態を確認してください。");
            });
        }, 0);
    };
    Hooks.on("createActiveEffect", schedule);
    Hooks.on("deleteActiveEffect", schedule);
    Hooks.on("updateActiveEffect", (effect, _changed, options, userId) => schedule(effect, options, userId));
    Hooks.on("createItem", (item, options, userId) => {
        if (item.system?.isPrepared) schedule(item, options, userId, item.id);
    });
    Hooks.on("updateItem", (item, changed, options, userId) => {
        const keys = ["isPrepared", "parentItemId", "parentSlotKind", "part", "partOptional", "partRelation", "partOrChoice", "majorCategory", "minorCategory", "additionalCategories", "slots"];
        if (keys.some(key => Object.hasOwn(changed.system ?? {}, key) || Object.hasOwn(changed, `system.${key}`))) {
            const preparing = (changed.system?.isPrepared ?? changed["system.isPrepared"]) === true;
            schedule(item, options, userId, preparing ? item.id : null);
        }
    });
}
