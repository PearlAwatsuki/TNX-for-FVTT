import { describe, it, expect, vi } from "vitest";
import { reconcileOutfitPreparation } from "../../scripts/core/outfit-preparation.mjs";
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
