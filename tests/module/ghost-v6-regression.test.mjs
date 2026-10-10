import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUsageTargetRefs } from "../../scripts/flow/target-resolution.mjs";
import { normalizeGhostOutfitPreparation, preparedDrone } from "../../scripts/session/vehicle-state.mjs";

afterEach(() => vi.unstubAllGlobals());

function ghostActor(items = []) {
    return {
        id: "ghost", uuid: "Actor.ghost", name: "ゴースト", type: "cast",
        system: { isGhost: true }, items,
        getFlag: () => true, getActiveTokens: () => [],
    };
}

describe("v6 ゴースト回帰", () => {
    it("HUD情報収集の明示例外は対象解決層でもドローンを要求しない", async () => {
        const actor = ghostActor();
        vi.stubGlobal("game", { user: { targets: new Set() }, actors: { contents: [] } });
        vi.stubGlobal("canvas", { scene: { tokens: [] } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        vi.stubGlobal("fromUuidSync", () => null);

        await expect(resolveUsageTargetRefs(actor, { target: "-" },
            { allowGhostWithoutDrone: true })).resolves.toEqual([]);
        expect(ui.notifications.warn).not.toHaveBeenCalled();
    });

    it("通常用途はドローンなしゴーストを対象解決層で引き続き止める", async () => {
        const actor = ghostActor();
        vi.stubGlobal("game", { user: { targets: new Set() }, actors: { contents: [] } });
        vi.stubGlobal("canvas", { scene: { tokens: [] } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });

        await expect(resolveUsageTargetRefs(actor, { target: "-" })).resolves.toBeNull();
        expect(ui.notifications.warn).toHaveBeenCalledWith(
            "ゴーストがシーンに干渉するには、ドローンで登場してください。"
        );
    });

    it("ゴースト登場時は防具だけを準備解除し、ドローン準備を維持する", async () => {
        const armor = { type: "armor", system: { isPrepared: true }, update: vi.fn(async p => { armor.system.isPrepared = p["system.isPrepared"]; }) };
        const drone = { type: "vehicle", system: { isCarrying: true, isPrepared: true, minorCategory: "drone" }, update: vi.fn() };
        const actor = ghostActor([armor, drone]);

        await normalizeGhostOutfitPreparation(actor);
        expect(armor.system.isPrepared).toBe(false);
        expect(drone.system.isPrepared).toBe(true);
        expect(preparedDrone(actor)).toBe(drone);
    });
});
