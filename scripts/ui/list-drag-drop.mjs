import { SYSTEM_ID } from "../constants.mjs";
import { updateUsageActions } from "../core/usage-derivation.mjs";

const bindings = new WeakMap();
const rowSelector = ".tnx-item-list__row[data-usage-id], .tnx-item-list__row[data-effect-id]";

/** Move before/after a row, or append when dropped in the empty list area. */
function insertAtDrop(rows, entry, targetId, after, idOf) {
    const index = rows.findIndex(row => idOf(row) === targetId);
    rows.splice(index < 0 ? rows.length : index + Number(after), 0, entry);
    return rows;
}

function effectCopy(effect, destination) {
    const data = effect.toObject();
    delete data._id;
    data.origin = destination.uuid;
    // A manual copy must not remain synchronized with the original supplier.
    const flags = data.flags?.[SYSTEM_ID];
    if (flags) {
        delete flags.transferredFrom;
        delete flags.transferredSourceName;
    }
    return data;
}

export async function dropListEntry(sheet, data, event) {
    const destination = sheet.document;
    if (!sheet.isEditable || !destination.isOwner) return;
    const row = event.target.closest(rowSelector);
    const bounds = row?.getBoundingClientRect();
    const after = bounds ? event.clientY > bounds.top + bounds.height / 2 : false;

    if (data.type === "TnxUsage") {
        if (destination.documentName !== "Item" || !Array.isArray(destination.system.actions)) return;
        const source = await fromUuid(data.uuid);
        if (!source || source.isOwner === false) return;
        const original = source.system.actions?.find(a => a._id === data.usageId);
        if (!original) return;
        const targetId = row?.dataset.usageId;
        if (source.uuid === destination.uuid) {
            if (targetId === data.usageId) return;
            return updateUsageActions(destination, actions => {
                const index = actions.findIndex(a => a._id === data.usageId);
                if (index < 0) return null;
                const [entry] = actions.splice(index, 1);
                return insertAtDrop(actions, entry, targetId, after, a => a._id);
            });
        }
        const entry = foundry.utils.deepClone(original);
        entry._id = foundry.utils.randomID();
        // Explicit references to the parent become references to the new parent.
        const remapParent = value => {
            if (!value || typeof value !== "object") return;
            if (value.itemId === source.id) value.itemId = destination.id;
            for (const child of Object.values(value)) remapParent(child);
        };
        remapParent(entry);
        const copied = new Map();
        for (const ref of [...(entry.effects ?? []), ...(entry.damageEffects ?? [])]) {
            if (ref.itemId && ref.itemId !== destination.id) continue;
            const effect = source.effects.get(ref.effectId);
            if (!effect) continue;
            if (!copied.has(effect.id)) {
                const [created] = await destination.createEmbeddedDocuments("ActiveEffect", [effectCopy(effect, destination)]);
                copied.set(effect.id, created.id);
            }
            ref.effectId = copied.get(effect.id);
        }
        return updateUsageActions(destination, actions => insertAtDrop(actions, entry, targetId, after, a => a._id));
    }

    if (data.type !== "ActiveEffect") return;
    const effect = await fromUuid(data.uuid);
    if (!effect || effect.documentName !== "ActiveEffect") return;
    const targetUuid = row?.dataset.effectUuid;
    const rows = [...sheet.element.querySelectorAll(".tnx-item-list__row[data-effect-uuid]")];
    const order = [...new Set(rows.map(el => el.dataset.effectUuid))];
    const isLocal = order.includes(effect.uuid)
        && (data.tnxSourceUuid === destination.uuid || effect.parent?.uuid === destination.uuid);
    let uuid = effect.uuid;
    if (isLocal) {
        if (uuid === targetUuid) return;
        order.splice(order.indexOf(uuid), 1);
    } else {
        const [created] = await destination.createEmbeddedDocuments("ActiveEffect", [effectCopy(effect, destination)]);
        uuid = created.uuid;
    }
    insertAtDrop(order, uuid, targetUuid, after, id => id);
    return destination.setFlag(SYSTEM_ID, "effectOrder", order);
}

/** Rebind per render; capture supported drops before the core sheet drop handler. */
export function bindListDragDrop(sheet) {
    const root = sheet.element;
    bindings.get(root)?.abort();
    const controller = new AbortController();
    bindings.set(root, controller);
    const options = { capture: true, signal: controller.signal };
    for (const row of root.querySelectorAll(rowSelector)) row.draggable = !!sheet.isEditable;
    root.addEventListener("dragstart", event => {
        const row = event.target.closest(rowSelector);
        if (!row) return;
        event.stopImmediatePropagation();
        if (!sheet.isEditable || !sheet.document.isOwner) return event.preventDefault();
        const data = row.dataset.usageId
            ? { type: "TnxUsage", uuid: sheet.document.uuid, usageId: row.dataset.usageId }
            : { type: "ActiveEffect", uuid: row.dataset.effectUuid, tnxSourceUuid: sheet.document.uuid };
        event.dataTransfer.setData("text/plain", JSON.stringify(data));
        event.dataTransfer.effectAllowed = "copyMove";
    }, options);
    root.addEventListener("dragover", event => {
        if (sheet.isEditable) event.preventDefault();
    }, options);
    root.addEventListener("drop", event => {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch { return; }
        if (!["TnxUsage", "ActiveEffect"].includes(data?.type)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void dropListEntry(sheet, data, event).catch(error => {
            console.error("TNX | リストのドロップに失敗しました", error);
            ui.notifications.error("ドロップに失敗しました。コンソールを確認してください。");
        });
    }, options);
}
