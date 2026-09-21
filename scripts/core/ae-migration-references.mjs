/** 移行前の参照関係を診断する。参照の書換えや文書の削除は行わない。 */
import { SYSTEM_ID } from "../constants.mjs";

export function inspectAEMigrationReferences(plans, documents) {
    const effects = new Map(plans.filter(p => p.kind === "effect" && p.uuid).map(p => [p.uuid, p]));
    const knownDocuments = new Set(documents.map(entry => entry.document.uuid).filter(Boolean));
    const references = [];
    const inspect = reference => {
        const target = effects.get(reference.targetUuid);
        const relocation = target?.destination && target.destination !== target.ownerUuid
            ? { ownerUuid: target.destination, effectId: target.original._id } : null;
        references.push({ ...reference, resolution: target || knownDocuments.has(reference.targetUuid) ? "resolved" : "unresolved", relocation });
    };
    for (const { document, items, readOnly } of documents) {
        if (document.documentName !== "Item") continue;
        for (const [i, usage] of (document.system?.actions ?? []).entries()) {
            for (const list of ["effects", "damageEffects"]) {
                for (const [j, ref] of (usage[list] ?? []).entries()) {
                    if (!ref.effectId) continue;
                    const host = !ref.itemId || ref.itemId === (document.id ?? document._id)
                        ? document : [...items].find(item => (item.id ?? item._id) === ref.itemId);
                    const target = [...(host?.effects ?? [])].find(effect => (effect.id ?? effect._id) === ref.effectId);
                    inspect({ kind: "usage-effect", ownerUuid: document.uuid, path: `system.actions.${i}.${list}.${j}`,
                        value: structuredClone(ref), targetUuid: target?.uuid ?? null, readOnly, required: true });
                }
            }
        }
    }
    for (const plan of plans) {
        if (!["effect", "preset", "chat-payload"].includes(plan.kind)) continue;
        const source = plan.original;
        const prefix = plan.path ? `${plan.path}.` : "";
        for (const [key, value] of Object.entries({ origin: source.origin,
            transferredFrom: source.flags?.[SYSTEM_ID]?.transferredFrom,
            grantedFrom: source.flags?.[SYSTEM_ID]?.grantedFrom })) {
            if (typeof value !== "string" || !value) continue;
            // originにはItem UUIDも許される。過去の付与元が消えていても付与コピー自体は有効。
            inspect({ kind: key, ownerUuid: plan.uuid, path: `${prefix}${key === "origin" ? key : `flags.${SYSTEM_ID}.${key}`}`,
                value, targetUuid: value, readOnly: plan.readOnly, required: key === "transferredFrom" });
        }
        const identity = source.flags?.[SYSTEM_ID]?.effectId;
        if (identity) references.push({ kind: "identity", ownerUuid: plan.uuid,
            path: `${prefix}flags.${SYSTEM_ID}.effectId`, value: identity,
            readOnly: plan.readOnly, required: false, resolution: "identity", relocation: null });
        // effectIdは重複同一性。UUIDと同じ文字列でも移設先へ書き換えない。
    }
    return references;
}
