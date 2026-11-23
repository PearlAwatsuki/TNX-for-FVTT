import { describe, expect, it, vi } from "vitest";
import { mustUnprepareForDroneAppearance, normalizeGhostOutfitPreparation } from "../../scripts/session/vehicle-state.mjs";
const item = (id, type, system = {}) => ({ id, uuid: `Actor.owner.Item.${id}`, type, system: { isPrepared: true, isCarrying: true, ...system } });
describe("登場中のヴィークル準備", () => {
    it("搭載分類は準備先を付け替えても維持し、本人の非搭載武器は解除する", () => {
        for (const parentItemId of ["drone", "other", ""]) {
            expect(mustUnprepareForDroneAppearance(item("gun", "weapon", { minorCategory: "mounted", parentItemId }))).toBe(false);
        }
        expect(mustUnprepareForDroneAppearance(item("gun", "weapon", { minorCategory: "ranged", parentItemId: "drone" }))).toBe(true);
    });
    it("不適格アウトフィットを一括で準備解除する", async () => {
        const drone = item("drone", "vehicle", { minorCategory: "drone" });
        const mounted = item("mounted", "weapon", { minorCategory: "mounted", parentItemId: drone.id });
        const weapon = item("weapon", "weapon", { minorCategory: "melee" });
        const armor = item("armor", "armor", { minorCategory: "armor" });
        const actor = { items: [drone, mounted, weapon, armor], updateEmbeddedDocuments: vi.fn(async () => []) };
        const invalid = await normalizeGhostOutfitPreparation(actor, drone);
        expect(invalid.map(i => i.id)).toEqual(["weapon", "armor"]);
        expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
            { _id: "weapon", "system.isPrepared": false }, { _id: "armor", "system.isPrepared": false },
        ], { tnxVehicleTransition: true });
    });
    it("ドローンなしでは従来どおり防具だけを解除する", async () => {
        const weapon = item("weapon", "weapon");
        const armor = item("armor", "armor");
        const actor = { items: [weapon, armor], updateEmbeddedDocuments: vi.fn(async () => []) };
        expect((await normalizeGhostOutfitPreparation(actor, null)).map(i => i.id)).toEqual(["armor"]);
    });
});
