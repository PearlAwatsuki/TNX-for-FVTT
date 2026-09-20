import { describe, expect, it, vi } from "vitest";
import { buildAEMigrationInventory } from "../../scripts/core/ae-migration-inventory.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
function item(uuid) {
    const source = { _id: "s", type: "generalSkill", system: { identificationKey: "melee", actions: [{ checkBonusSelf: "@item.self.system.levelTotal" }] } };
    return { ...source, uuid, documentName: "Item", effects: [], toObject: () => structuredClone(source), update: vi.fn() };
}
describe("移行対象の読取専用棚卸し", () => {
    it("ワールド・非リンクToken・プリセット・過去カードを調査し、重複走査も更新もしない", async () => {
        const held = item("Actor.a.Item.s");
        const actor = { uuid: "Actor.a", documentName: "Actor", effects: [], items: [held] };
        const synthetic = { uuid: "Scene.s.Token.t.Actor.a", documentName: "Actor", effects: [], items: [item("Scene.s.Token.t.Actor.a.Item.s")] };
        const effect = { _id: "e", changes: [{ key: "check.all", value: "@card" }] };
        const world = { actors: [actor], items: [item("Item.w")], scenes: [{ tokens: [{ actorLink: true, actor }, { actorLink: false, actor: synthetic }, { actorLink: false, actor: synthetic }] }],
            journal: [{ uuid: "JournalEntry.j", flags: { [SYSTEM_ID]: { effectGrants: [{ effect }] } } }],
            messages: [{ uuid: "ChatMessage.m", flags: { [SYSTEM_ID]: { usageEffects: { sourceActorUuid: actor.uuid, effects: [{ data: effect }] } } } }] };
        const report = await buildAEMigrationInventory(world);
        expect(report.plans.map(p => p.kind)).toEqual(["item-formulas", "item-formulas", "item-formulas", "preset", "chat-payload"]);
        expect(report.summary).toMatchObject({ inspected: 5, changed: 5, unresolved: 0, readOnly: 1 });
        expect(held.update).not.toHaveBeenCalled();
        expect(effect.changes[0].key).toBe("check.all");
    });
    it("ロック済みパックは読取専用で報告し、調査失敗を隠さない", async () => {
        const pack = { collection: "world.skills", documentName: "Item", locked: true, metadata: { packageType: "world" },
            getIndex: vi.fn(async () => [{ _id: "s" }]), getDocument: vi.fn(async () => item("Compendium.world.skills.Item.s")), configure: vi.fn() };
        const broken = { ...pack, collection: "world.broken", getIndex: async () => { throw new Error("offline"); } };
        const report = await buildAEMigrationInventory({ packs: [pack, broken] }, { includePacks: true });
        expect(report.plans[0].readOnly).toBe(true);
        expect(report.plans[1].kind).toBe("pack-error");
        expect(report.summary.unresolved).toBe(1);
        expect(pack.configure).not.toHaveBeenCalled();
    });
});
