import { SOCKET_CHANNEL } from "../constants.mjs";
import { crewVehicle, vehicleToken, disembarkPositions, requestVehicleOperation } from "./vehicle-state.mjs";
import { isAppearing, displayActorName, applyManualExit, syncTokensForActor } from "./appearance-state.mjs";
import { VehicleExitDialog } from "../ui/tnx-dialog.mjs";

const pending = new Map();
const showing = new Set();

/** チーム退場対象は確認済みなので除外し、車両削除前の降車位置を記録する。 */
export function collectVehicleExitPassengers(targetIds) {
    const exiting = new Set(targetIds);
    const passengers = new Map();
    for (const id of exiting) {
        const driver = game.actors.get(id);
        const relation = crewVehicle(driver);
        if (relation?.member.role !== "driver") continue;
        const token = vehicleToken(relation.vehicle);
        for (const member of relation.vehicle.system.crew) {
            const actor = fromUuidSync(member.actorUuid);
            if (member.role !== "passenger" || !actor || !isAppearing(actor) || exiting.has(actor.id)) continue;
            passengers.set(actor.uuid, { actorUuid: actor.uuid, driverUuid: driver.uuid, vehicleUuid: relation.vehicle.uuid,
                sceneId: game.scenes.active?.id,
                position: token ? { sceneId: token.parent.id, x: token.x, y: token.y, elevation: token.elevation } : null });
        }
    }
    return [...passengers.values()];
}

/** 接続中の所有者に尋ね、所有者不在のNPC等はRLが回答する。 */
export async function confirmVehicleExitPassengers(passengers) {
    for (const [id, request] of pending) {
        if (request.sceneId !== game.scenes.active?.id) pending.delete(id);
    }
    for (const passenger of passengers) {
        const actor = fromUuidSync(passenger.actorUuid);
        if (!actor || !isAppearing(actor)) continue;
        if ([...pending.values()].some(p => p.actorUuid === actor.uuid)) continue;
        const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? game.user;
        const requestId = foundry.utils.randomID();
        const request = { ...passenger, requestId, userId: owner.id, gmId: game.user.id };
        pending.set(requestId, request);
        if (owner.id === game.user.id) await answerLocally(request);
        else game.socket.emit(SOCKET_CHANNEL, { type: "vehicleExitQuestion", ...request });
    }
}

async function answerLocally(request) {
    if (showing.has(request.requestId)) return;
    const actor = fromUuidSync(request.actorUuid);
    if (!actor || !isAppearing(actor) || (!game.user.isGM && !actor.isOwner)) return;
    showing.add(request.requestId);
    try {
        const exit = await VehicleExitDialog.prompt({ passengerName: displayActorName(actor), driverName: displayActorName(fromUuidSync(request.driverUuid)) });
        const result = { type: "vehicleExitAnswer", requestId: request.requestId, userId: game.user.id, exit };
        if (request.gmId === game.user.id) await applyAnswer(result);
        else game.socket.emit(SOCKET_CHANNEL, result);
    } finally { showing.delete(request.requestId); }
}

async function applyAnswer(message) {
    const request = pending.get(message.requestId);
    if (!request || message.userId !== request.userId || typeof message.exit !== "boolean") return;
    pending.delete(message.requestId);
    const actor = fromUuidSync(request.actorUuid);
    const relation = crewVehicle(actor);
    if (!actor || !isAppearing(actor) || relation?.vehicle.uuid !== request.vehicleUuid || game.scenes.active?.id !== request.sceneId) return;
    if (relation.vehicle.system.crew.some(c => c.role === "driver" && isAppearing(fromUuidSync(c.actorUuid)))) return;
    if (message.exit) await applyManualExit(actor.id);
    else {
        if (request.position) disembarkPositions.set(actor.uuid, request.position);
        await requestVehicleOperation("leave", { actorUuid: actor.uuid });
        await syncTokensForActor(actor);
    }
}

export async function handleVehicleExitMessage(message) {
    if (message.type === "vehicleExitQuestion") {
        if (message.userId !== game.user.id || message.gmId !== game.users.activeGM?.id) return;
        await answerLocally(message);
    } else if (message.type === "vehicleExitAnswer" && game.user.id === game.users.activeGM?.id) {
        await applyAnswer(message);
    }
}
