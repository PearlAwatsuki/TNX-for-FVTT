import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("../../scripts/session/appearance-state.mjs", () => ({
    isAppearing: actor => !!actor?.appearing, displayActorName: actor => actor?.name ?? "",
    applyManualExit: vi.fn(), syncTokensForActor: vi.fn(),
}));
vi.mock("../../scripts/session/vehicle-state.mjs", () => ({
    crewVehicle: vi.fn(), vehicleToken: vi.fn(), disembarkPositions: new Map(), requestVehicleOperation: vi.fn(),
}));
vi.mock("../../scripts/ui/tnx-dialog.mjs", () => ({ VehicleExitDialog: { prompt: vi.fn() } }));
import { collectVehicleExitPassengers, confirmVehicleExitPassengers, handleVehicleExitMessage } from "../../scripts/session/vehicle-exit.mjs";
import { crewVehicle, vehicleToken, disembarkPositions, requestVehicleOperation } from "../../scripts/session/vehicle-state.mjs";
import { applyManualExit, syncTokensForActor } from "../../scripts/session/appearance-state.mjs";
import { VehicleExitDialog } from "../../scripts/ui/tnx-dialog.mjs";

describe("操縦者退場時の同乗者確認", () => {
    let driver, passenger, vehicle, scene, users, sequence = 0;
    beforeEach(() => {
        vi.clearAllMocks(); disembarkPositions.clear();
        driver = { id: "d", uuid: "Actor.d", name: "操縦者", appearing: true };
        passenger = { id: "p", uuid: "Actor.p", name: "同乗者", appearing: true, isOwner: true, testUserPermission: () => true };
        vehicle = { uuid: "Actor.v", system: { crew: [{ actorUuid: driver.uuid, role: "driver" }, { actorUuid: passenger.uuid, role: "passenger" }] } };
        scene = { id: `s${++sequence}` };
        const gm = { id: "gm", isGM: true, active: true };
        users = [gm]; users.activeGM = gm;
        vi.stubGlobal("game", { user: gm, users, actors: { get: id => id === "d" ? driver : passenger }, scenes: { active: scene }, socket: { emit: vi.fn() } });
        vi.stubGlobal("fromUuidSync", uuid => uuid === driver.uuid ? driver : uuid === passenger.uuid ? passenger : vehicle);
        foundry.utils.randomID = () => `r${++sequence}`;
        crewVehicle.mockImplementation(actor => actor ? { vehicle, member: vehicle.system.crew.find(c => c.actorUuid === actor.uuid) } : null);
        vehicleToken.mockReturnValue({ parent: scene, x: 400, y: 200, elevation: 3 });
    });
    afterEach(() => vi.unstubAllGlobals());
    function depart() {
        const requests = collectVehicleExitPassengers([driver.id]);
        driver.appearing = false;
        vehicle.system.crew.shift();
        return requests;
    }
    it("チーム側ですでに退場する同乗者は確認対象にしない", () => {
        expect(collectVehicleExitPassengers([driver.id, passenger.id])).toEqual([]);
    });
    it("同時退場を選ぶと本人の通常退場経路を使う", async () => {
        VehicleExitDialog.prompt.mockResolvedValue(true);
        await confirmVehicleExitPassengers(depart());
        expect(VehicleExitDialog.prompt).toHaveBeenCalledWith({ driverName: "操縦者", passengerName: "同乗者" });
        expect(applyManualExit).toHaveBeenCalledWith(passenger.id);
        expect(requestVehicleOperation).not.toHaveBeenCalled();
    });
    it("シーンに残る場合は車両が消える前の位置から降車する", async () => {
        VehicleExitDialog.prompt.mockResolvedValue(false);
        await confirmVehicleExitPassengers(depart());
        expect(disembarkPositions.get(passenger.uuid)).toEqual({ sceneId: scene.id, x: 400, y: 200, elevation: 3 });
        expect(requestVehicleOperation).toHaveBeenCalledWith("leave", { actorUuid: passenger.uuid });
        expect(syncTokensForActor).toHaveBeenCalledWith(passenger);
        expect(applyManualExit).not.toHaveBeenCalled();
    });
    it("接続中の同乗者所有者へ送り、別ユーザーの回答は受理しない", async () => {
        users.push({ id: "pl", isGM: false, active: true });
        await confirmVehicleExitPassengers(depart());
        expect(VehicleExitDialog.prompt).not.toHaveBeenCalled();
        const message = game.socket.emit.mock.calls[0][1];
        expect(message.userId).toBe("pl");
        await handleVehicleExitMessage({ type: "vehicleExitAnswer", requestId: message.requestId, userId: "other", exit: true });
        expect(applyManualExit).not.toHaveBeenCalled();
        await handleVehicleExitMessage({ type: "vehicleExitAnswer", requestId: message.requestId, userId: "pl", exit: true });
        expect(applyManualExit).toHaveBeenCalledOnce();
    });
    it("確認中にシーンが変わった場合は古い回答を適用しない", async () => {
        VehicleExitDialog.prompt.mockImplementation(async () => { game.scenes.active = { id: "next" }; return true; });
        await confirmVehicleExitPassengers(depart());
        expect(applyManualExit).not.toHaveBeenCalled();
    });
});
