import { describe, expect, it } from "vitest";
import { inspectAEMigrationReferences } from "../../scripts/core/ae-migration-references.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

describe("AE移行時の参照診断", () => {
    it("用途の通常・ダメージ付与参照と転送元の移設を報告し、同一性は保持する", () => {
        const uuid = "Actor.a.Item.s.ActiveEffect.e";
        const source = { kind: "effect", uuid, ownerUuid: "Actor.a.Item.s", destination: "Actor.a.Item.w", original: { _id: "e" } };
        const copy = { kind: "effect", uuid: "Actor.a.Item.w.ActiveEffect.c", original: { _id: "c", origin: uuid,
            flags: { [SYSTEM_ID]: { transferredFrom: uuid, effectId: uuid } } } };
        const item = { id: "s", uuid: source.ownerUuid, documentName: "Item", effects: [{ id: "e", uuid }],
            system: { actions: [{ effects: [{ itemId: "", effectId: "e" }], damageEffects: [{ itemId: "s", effectId: "e" }] }] } };
        const before = structuredClone([source, copy, item]);
        const refs = inspectAEMigrationReferences([source, copy], [{ document: item, items: [item], readOnly: false }]);
        expect(refs.filter(r => r.relocation)).toHaveLength(4);
        expect(refs[0]).toMatchObject({ kind: "usage-effect", resolution: "resolved", required: true,
            relocation: { ownerUuid: "Actor.a.Item.w", effectId: "e" } });
        expect(refs.at(-1)).toMatchObject({ kind: "identity", value: uuid, relocation: null });
        expect([source, copy, item]).toEqual(before);
    });
    it("不明な用途・転送参照と、削除済みの歴史的な付与元を区別する", () => {
        const item = { id: "s", uuid: "Item.s", documentName: "Item", effects: [],
            system: { actions: [{ effects: [{ itemId: "other", effectId: "missing" }] }] } };
        const plan = { kind: "effect", uuid: "Item.s.ActiveEffect.e", original: { origin: "Item.s",
            flags: { [SYSTEM_ID]: { transferredFrom: "Item.old.ActiveEffect.e", grantedFrom: "Item.old.ActiveEffect.g" } } } };
        const refs = inspectAEMigrationReferences([plan], [{ document: item, items: [], readOnly: true }]);
        expect(refs[0]).toMatchObject({ resolution: "unresolved", required: true, readOnly: true });
        expect(refs[1]).toMatchObject({ kind: "origin", resolution: "resolved" });
        expect(refs[2]).toMatchObject({ kind: "transferredFrom", resolution: "unresolved", required: true });
        expect(refs[3]).toMatchObject({ kind: "grantedFrom", resolution: "unresolved", required: false });
    });
});
