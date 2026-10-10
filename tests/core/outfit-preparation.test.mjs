import { describe, it, expect, vi, afterEach } from "vitest";
import { reconcileOutfitPreparation, registerOutfitPreparationHooks } from "../../scripts/core/outfit-preparation.mjs";
describe("準備解除の保存", () => {
    it("同時要求でも最新状態を照合し、一度だけ保存する", async () => {
        const item = { id: "opt", type: "general", system: { isPrepared: true, isOption: true, parentItemId: "missing", part: [] } };
        const actor = { uuid: "Actor.a", items: [item], system: {}, updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
            for (const update of updates) actor.items.find(i => i.id === update._id).system.isPrepared = false;
        }) };
        await Promise.all([reconcileOutfitPreparation(actor), reconcileOutfitPreparation(actor)]);
        expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
        expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [{ _id: "opt", "system.isPrepared": false }], { tnxPreparationReconcile: true });
    });
});

describe("準備した武器の自動選択", () => {
    const weapon = (id, system = {}) => ({ id, type: "weapon", system: { isPrepared: true, part: [], ...system } });
    const makeActor = (items, attackItemId = "") => {
        const actor = { uuid: "Actor.weapons", items, system: { weaponRefs: { attackItemId } },
            updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
                for (const update of updates) items.find(i => i.id === update._id).system.isPrepared = false;
            }),
            update: vi.fn(async update => { actor.system.weaponRefs.attackItemId = update["system.weaponRefs.attackItemId"]; }),
        };
        for (const item of items) item.actor = actor;
        return actor;
    };
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it("最初に準備した武器を設定し、同時に準備した2つ目で上書きしない", async () => {
        const actor = makeActor([weapon("second"), weapon("first")]);
        await Promise.all([
            reconcileOutfitPreparation(actor, ["first"]),
            reconcileOutfitPreparation(actor, ["second"]),
        ]);
        expect(actor.update).toHaveBeenCalledTimes(1);
        expect(actor.update).toHaveBeenCalledWith({ "system.weaponRefs.attackItemId": "first" });
    });

    it("既存の選択とパリーの設定を変更しない", async () => {
        const actor = makeActor([weapon("new")], "selected");
        actor.system.weaponRefs.parryItemId = "parry";
        await reconcileOutfitPreparation(actor, ["new"]);
        expect(actor.update).not.toHaveBeenCalled();
        expect(actor.system.weaponRefs.parryItemId).toBe("parry");
    });

    it("準備操作がなければ、明示的に選んだ生身を維持する", async () => {
        const actor = makeActor([weapon("existing")]);
        await reconcileOutfitPreparation(actor);
        expect(actor.update).not.toHaveBeenCalled();
    });

    it("実効未準備・破壊・準備条件違反の武器を自動選択しない", async () => {
        const actor = makeActor([
            weapon("inactive", { isPreparedEffective: false }),
            weapon("broken", { isDestroyed: true }),
            weapon("invalid", { isOption: true, parentItemId: "missing" }),
        ]);
        await reconcileOutfitPreparation(actor, ["inactive", "broken", "invalid"]);
        expect(actor.update).not.toHaveBeenCalled();
        expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    });

    it("先行する再検証があっても準備イベントを取りこぼさず、発生順に選ぶ", async () => {
        vi.useFakeTimers();
        const callbacks = {};
        vi.stubGlobal("Hooks", { on: (name, callback) => { callbacks[name] = callback; } });
        vi.stubGlobal("game", { user: { id: "user" } });
        registerOutfitPreparationHooks();
        const actor = makeActor([weapon("second"), weapon("first")]);
        callbacks.updateItem(actor.items[0], { system: { part: [] } }, {}, "user");
        callbacks.updateItem(actor.items[1], { system: { isPrepared: true } }, {}, "user");
        callbacks.updateItem(actor.items[0], { "system.isPrepared": true }, {}, "user");
        await vi.runAllTimersAsync();
        expect(actor.system.weaponRefs.attackItemId).toBe("first");
    });
});
