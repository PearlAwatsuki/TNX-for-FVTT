import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareAEMigration, executeAEMigration, restoreAEMigration, applyAEMigrationOperation, AE_MIGRATION_BACKUP_ID } from "../../scripts/core/ae-migration-execution.mjs";

const collection = values => {
    const map = new Map(values.map(v => [v.id, v]));
    map[Symbol.iterator] = map.values.bind(map);
    return map;
};
function fixture() {
    const documents = new Map();
    const calls = [];
    const make = (uuid, source, documentName, parent = null) => {
        const data = structuredClone(source);
        const doc = { uuid, id: source._id, documentName, parent, effects: collection([]),
            toObject: () => structuredClone(data),
            update: vi.fn(async (patch, options) => {
                calls.push({ kind: "update", uuid, options });
                for (const [path, value] of Object.entries(patch)) {
                    const keys = path.split(".");
                    let target = data;
                    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
                    target[keys.at(-1)] = structuredClone(value?.replacement ?? value);
                }
                return doc;
            }),
            delete: vi.fn(async options => {
                calls.push({ kind: "delete", uuid, options });
                documents.delete(uuid); parent?.effects.delete(doc.id);
            }),
            createEmbeddedDocuments: vi.fn(async (_type, sources, options) => {
                calls.push({ kind: "create", uuid, options });
                return sources.map(source => {
                    const effect = make(`${uuid}.ActiveEffect.${source._id}`, source, "ActiveEffect", doc);
                    doc.effects.set(effect.id, effect);
                    return effect;
                });
            }),
        };
        for (const key of ["type", "system", "flags", "origin"]) Object.defineProperty(doc, key, { get: () => data[key] });
        documents.set(uuid, doc);
        return doc;
    };
    const source = make("Actor.a.Item.s", { _id: "s", type: "generalSkill", system: { identificationKey: "skill", actions: [{ effects: [{ itemId: "", effectId: "e" }] }] } }, "Item");
    const target = make("Actor.a.Item.w", { _id: "w", type: "weapon", system: { identificationKey: "sword", slots: [{ kind: "normal" }] } }, "Item");
    const effect = make(`${source.uuid}.ActiveEffect.e`, { _id: "e", type: "base", transfer: true,
        system: { changes: [{ key: "item.sword.system.attack.value", value: "3" }] }, flags: {} }, "ActiveEffect", source);
    source.effects.set(effect.id, effect);
    const actor = make("Actor.a", { _id: "a", system: {} }, "Actor");
    actor.items = collection([source, target]);
    const world = { actors: [actor], journal: collection([]), world: { id: "test" },
        user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, settings: { get: () => 6, set: vi.fn() } };
    vi.stubGlobal("foundry", { data: { operators: { ForcedReplacement: { create: replacement => ({ replacement }) } } } });
    vi.stubGlobal("JournalEntry", { create: vi.fn(async data => {
        if (world.journal.has(data._id)) throw new Error("duplicate ID");
        calls.push({ kind: "backup" });
        const doc = make(`JournalEntry.${data._id}`, data, "JournalEntry");
        world.journal.set(doc.id, doc);
        return doc;
    }) });
    return { world, documents, calls, source, target, effect, resolve: async uuid => documents.get(uuid) ?? null };
}
afterEach(() => vi.unstubAllGlobals());

describe("AE移行の適用・復元", () => {
    it("バックアップ→移設先作成→用途参照更新→元削除の順に適用し、全て復元できる", async () => {
        const env = fixture();
        const before = env.effect.toObject();
        const plan = await prepareAEMigration(env.world, env);
        expect(plan.issues).toEqual([]);
        expect(plan.operations.map(op => op.kind)).toEqual(["create", "update", "delete"]);
        const result = await executeAEMigration(env.world, env);
        expect(result.status).toBe("complete");
        expect(env.calls[0].kind).toBe("backup");
        expect(env.target.effects.get("e").type).toBe("enchantment");
        expect(env.source.effects.size).toBe(0);
        expect(env.source.system.actions[0].effects[0]).toEqual({ itemId: "w", effectId: "e" });
        expect(env.calls.filter(c => !c.uuid?.startsWith("JournalEntry") && c.kind !== "backup").every(c => c.options.tnxAEMigration)).toBe(true);
        await executeAEMigration(env.world, env);
        expect(env.target.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
        await restoreAEMigration(env.world, env);
        expect(env.source.effects.get("e").toObject()).toEqual(before);
        expect(env.target.effects.size).toBe(0);
        expect(env.source.system.actions[0].effects[0].itemId).toBe("");
    });
    it("途中失敗後に再開しても移設先を二重作成しない", async () => {
        const env = fixture();
        env.source.update.mockRejectedValueOnce(new Error("offline"));
        await expect(executeAEMigration(env.world, env)).rejects.toThrow("offline");
        expect(env.source.effects.has("e")).toBe(true);
        expect(env.target.effects.has("e")).toBe(true);
        expect(env.world.journal.get(AE_MIGRATION_BACKUP_ID)).toBeTruthy();
        await executeAEMigration(env.world, env);
        expect(env.target.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
        expect(env.source.effects.has("e")).toBe(false);
    });
    it("進捗保存前の中断でもbefore/after照合で復元する", async () => {
        const env = fixture();
        env.source.update.mockRejectedValueOnce(new Error("offline"));
        await expect(executeAEMigration(env.world, env)).rejects.toThrow();
        await restoreAEMigration(env.world, env);
        expect(env.source.effects.has("e")).toBe(true);
        expect(env.target.effects.has("e")).toBe(false);
    });
    it("移行後の編集を復元で上書きしない", async () => {
        const env = fixture();
        await executeAEMigration(env.world, env);
        await env.target.effects.get("e").update({ name: "後から編集" });
        await expect(restoreAEMigration(env.world, env)).rejects.toThrow("変更されています");
        expect(env.target.effects.get("e").toObject().name).toBe("後から編集");
    });
    it("参照切れはデータ更新とバックアップ作成前に報告する", async () => {
        const env = fixture();
        await env.effect.update({ system: { changes: [{ key: "item.missing.system.attack", value: "1" }] } });
        env.calls.length = 0;
        const result = await executeAEMigration(env.world, env);
        expect(result.status).toBe("needs-resolution");
        expect(env.calls).toEqual([]);
    });
    it("型変更はsystemのForcedReplacementと共に更新し、同じIDで戻せる", async () => {
        const env = fixture();
        const before = env.effect.toObject();
        const after = { ...structuredClone(before), type: "enchantment" };
        const op = { kind: "update", uuid: env.effect.uuid, before, after, fields: ["type"] };
        await applyAEMigrationOperation(op, env);
        expect(env.effect.update.mock.calls[0][0]).toEqual({ type: "enchantment", system: { replacement: before.system } });
        await applyAEMigrationOperation(op, { ...env, reverse: true });
        expect(env.effect.toObject()).toEqual(before);
    });
    it("activeGM以外は開始しない", async () => {
        const env = fixture(); env.world.user.id = "other";
        await expect(executeAEMigration(env.world, env)).rejects.toThrow("activeGM");
        expect(env.calls).toEqual([]);
    });
    it("バックアップの保存失敗時は元データに触れない", async () => {
        const env = fixture();
        globalThis.JournalEntry.create.mockRejectedValueOnce(new Error("backup unavailable"));
        await expect(executeAEMigration(env.world, env)).rejects.toThrow("backup unavailable");
        expect(env.calls).toEqual([]);
        expect(env.source.effects.has("e")).toBe(true);
        expect(env.target.effects.size).toBe(0);
    });
    it("移設先の同ID衝突は上書きせず、実行前に止める", async () => {
        const env = fixture();
        env.target.effects.set("e", env.effect);
        const result = await executeAEMigration(env.world, env);
        expect(result.status).toBe("needs-resolution");
        expect(result.issues.some(issue => issue.reason.includes("同じAE ID"))).toBe(true);
        expect(env.calls).toEqual([]);
    });
});
