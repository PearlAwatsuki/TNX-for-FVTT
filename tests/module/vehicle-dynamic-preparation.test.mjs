import { describe, expect, it, vi } from "vitest";
import { canRemainPreparedWithDrone, normalizeGhostOutfitPreparation } from "../../scripts/session/vehicle-state.mjs";
const item = (id, type, system = {}) => ({ id, uuid: `Actor.owner.Item.${id}`, type, system: { isPrepared: true, isCarrying: true, ...system } });
describe("登場中のヴィークル準備", () => {
    it("ドローン本体・その搭載兵器・全身義体だけを維持する", () => {
        const drone = item("drone", "vehicle", { minorCategory: "drone" });
        expect(canRemainPreparedWithDrone(drone, drone)).toBe(true);
        expect(canRemainPreparedWithDrone(item("gun", "weapon", { minorCategory: "mounted", parentItemId: drone.id }), drone)).toBe(true);
        expect(canRemainPreparedWithDrone(item("body", "cyborg", { minorCategory: "fullCyborg" }), drone)).toBe(true);
        expect(canRemainPreparedWithDrone(item("other", "weapon", { minorCategory: "mounted", parentItemId: "other" }), drone)).toBe(false);
        expect(canRemainPreparedWithDrone(item("armor", "armor", { minorCategory: "armor" }), drone)).toBe(false);
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
