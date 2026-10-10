import { describe, expect, it, vi } from "vitest";
import { buildAEMigrationInventory } from "../../scripts/core/ae-migration-inventory.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
function item(uuid) {
    const source = { _id: "s", type: "generalSkill", system: { identificationKey: "melee", actions: [{ checkBonusSelf: "@item.self.system.levelTotal" }] } };
    return { ...source, uuid, documentName: "Item", effects: [], toObject: () => structuredClone(source), update: vi.fn() };
}
describe("移行対象の読取専用棚卸し", () => {
    it("付与データのない過去カードも再判定・攻撃の式を診断し、算出済み結果を保持する", async () => {
        const held = item("Actor.a.Item.s");
        const actor = { id: "a", uuid: "Actor.a", documentName: "Actor", effects: [], items: [held] };
        const attack = { attackerUuid: actor.uuid, sourceItemId: "s", damageBonusSelf: "@diff + @life.total",
            damageBonuses: [{ formula: "@item.self.system.levelTotal", stackable: true }], achievement: 15 };
        const recheck = { actorId: "a", sourceItemId: "s", checkBonusSelf: "@item.self.system.levelTotal",
            checkBonuses: [{ formula: "@life.total" }], attack };
        const flags = { checkRecheck: recheck, attackCheck: attack, checkResult: { result: { achievement: 15 } } };
        const before = structuredClone(flags);
        const report = await buildAEMigrationInventory({ actors: [actor], messages: [{ uuid: "ChatMessage.m", flags: { [SYSTEM_ID]: flags } }] });
        const snapshots = report.plans.filter(p => p.kind === "chat-formulas");
        expect(snapshots).toHaveLength(3);
        expect(snapshots.every(p => p.readOnly && p.changed && !p.issues.length)).toBe(true);
        expect(snapshots[0].data.checkBonusSelf).toBe("@skill.melee.level");
        expect(snapshots[0].changes[0].path).toBe("checkBonusSelf");
        expect(snapshots[1].data.damageBonusSelf).toBe("@diff + @abilities.life.value");
        expect(snapshots[1].data.damageBonuses[0]).toEqual({ formula: "@skill.melee.level", stackable: true });
        expect(snapshots[1].data.achievement).toBe(15);
        expect(flags).toEqual(before);
    });
    it("再判定内の付与コピーも診断し、不明な保持元の式は原文を保持する", async () => {
        const effect = { changes: [{ key: "check.all", value: "@card" }] };
        const snapshot = { actorId: "missing", sourceItemId: "s", checkBonusSelf: "@life.total + @item.self.system.levelTotal",
            usageEffects: { effects: [{ data: effect }] } };
        const report = await buildAEMigrationInventory({ messages: [{ uuid: "ChatMessage.m", flags: { [SYSTEM_ID]: { checkRecheck: snapshot } } }] });
        expect(report.plans.map(p => p.kind)).toEqual(["chat-formulas", "chat-payload"]);
        expect(report.plans[0].data.checkBonusSelf).toBe(snapshot.checkBonusSelf);
        expect(report.plans[0].issues).toHaveLength(1);
        expect(report.plans[1].path).toContain("checkRecheck.usageEffects.effects.0.data");
        expect(report.plans[1].data.changes[0]).toEqual({ key: "system.check.all", value: "@card" });
    });
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
