import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("../../scripts/ui/tnx-dialog.mjs", () => ({ TargetSelectionDialog: { prompt: vi.fn() } }));
import { TargetSelectionDialog } from "../../scripts/ui/tnx-dialog.mjs";
import { resolveUsageTargetRefs, currentTargetActors } from "../../scripts/flow/target-resolution.mjs";
import { selectedCrew } from "../../scripts/session/vehicle-state.mjs";
import { buildDamageTargets } from "../../scripts/flow/damage-flow.mjs";
import { vehicleDamageCategory } from "../../scripts/rules/vehicle.mjs";

describe("乗員の攻撃対象とドローン経路", () => {
    let vehicle, driver, passenger, token, source, attacker, docs;
    const usage = { target: "single", confrontation: [] };
    beforeEach(() => {
        selectedCrew.clear();
        driver = { uuid: "Actor.driver", name: "操縦者", system: {}, getFlag: () => true };
        passenger = { uuid: "Actor.passenger", name: "同乗者", system: {}, getFlag: () => true };
        attacker = { uuid: "Actor.attacker", name: "攻撃者", system: {} };
        source = { type: "vehicle", system: { isPrepared: true, classifications: [{ minor: "groundVehicle" }] } };
        vehicle = { id: "v", uuid: "Actor.v", name: "車両", type: "vehicle", system: { outfitUuid: "Item.source", crew: [
            { actorUuid: driver.uuid, role: "driver", operationMode: "onboard" },
            { actorUuid: passenger.uuid, role: "passenger", operationMode: "onboard" },
        ] } };
        token = { actor: vehicle, isVisible: true, document: { uuid: "Scene.s.Token.v" } };
        docs = new Map([[vehicle.uuid, vehicle], [driver.uuid, driver], [passenger.uuid, passenger], ["Item.source", source]]);
        vi.stubGlobal("fromUuidSync", uuid => docs.get(uuid));
        vi.stubGlobal("game", { user: { isGM: true, targets: new Set([token]) }, actors: { contents: [vehicle, driver, passenger] } });
        vi.stubGlobal("canvas", { scene: { tokens: [{ actorId: "v", uuid: token.document.uuid }] } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        TargetSelectionDialog.prompt.mockReset();
    });
    afterEach(() => { selectedCrew.clear(); vi.unstubAllGlobals(); });

    it("通常車両は乗員を選び、その人を効果の対象にもする", async () => {
        TargetSelectionDialog.prompt.mockResolvedValue(passenger.uuid);
        const refs = await resolveUsageTargetRefs(attacker, usage);
        expect(refs).toHaveLength(1);
        expect(refs[0].uuid).toBe(passenger.uuid);
        expect(refs[0].vehicleRoute.driverUuid).toBe(driver.uuid);
        expect(currentTargetActors()).toEqual([passenger]);
        expect(currentTargetActors({ rawVehicles: true })).toEqual([vehicle]);
    });
    it("ドローンの直接ターゲットは操縦者に解決し、ダメージカードまで経路を保持", async () => {
        source.system.classifications[0].minor = "drone";
        vehicle.system.crew[0].operationMode = "remote";
        driver.system.isGhost = true;
        const refs = await resolveUsageTargetRefs(attacker, usage);
        expect(TargetSelectionDialog.prompt).not.toHaveBeenCalled();
        expect(refs[0].uuid).toBe(driver.uuid);
        const targets = buildDamageTargets(refs);
        expect(targets[0].vehicleRoute.mode).toBe("remote");
    });
    it("通常車両に乗員がいなければ通常攻撃は中止し、車両をダメージ対象にしない", async () => {
        vehicle.system.crew = [];
        expect(await resolveUsageTargetRefs(attacker, usage)).toBeNull();
    });
    it("通常の対象とドローンを同時に攻撃しても、精神適用はドローン側だけ", async () => {
        source.system.classifications[0].minor = "drone";
        vehicle.system.crew = [{ actorUuid: driver.uuid, role: "driver", operationMode: "remote" }];
        driver.system.isGhost = true;
        game.user.targets.add({ actor: passenger, isVisible: true });
        const refs = await resolveUsageTargetRefs(attacker, usage);
        const targets = buildDamageTargets(refs);
        expect(targets.map(t => [t.uuid, vehicleDamageCategory(t, "physical")])).toEqual([
            [driver.uuid, "mental"], [passenger.uuid, "physical"],
        ]);
        expect(currentTargetActors()).toEqual([driver, passenger]);
        expect(currentTargetActors({ rawVehicles: true })).toEqual([vehicle, passenger]);
        expect(TargetSelectionDialog.prompt).not.toHaveBeenCalled();
    });
    it("ドローンを失ったゴーストからは対象解決を開始できない", async () => {
        driver.system.isGhost = true;
        vehicle.system.crew = [];
        expect(await resolveUsageTargetRefs(driver, usage)).toBeNull();
        expect(TargetSelectionDialog.prompt).not.toHaveBeenCalled();
        expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("ドローン"));
    });
    it("ゴースト本人を直接選んでも攻撃対象にはならない", async () => {
        driver.system.isGhost = true;
        game.user.targets = new Set([{ actor: driver, isVisible: true }]);
        expect(await resolveUsageTargetRefs(attacker, usage)).toBeNull();
    });
});
