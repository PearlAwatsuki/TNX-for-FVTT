import { vehicleOutfit, crewVehicle, requestVehicleOperation } from "./vehicle-state.mjs";
import { isDrone } from "../rules/vehicle.mjs";
import { isOutfitUnusable } from "../data/item/helpers.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { TargetSelectionDialog } from "../ui/tnx-dialog.mjs";

export async function promptVehicleBoarding(vehicle, droppedActor = null) {
    if (!vehicle.isOwner) return;
    const item = vehicleOutfit(vehicle);
    if (!item || isOutfitUnusable(item.system)) return ui.notifications.warn("利用できるヴィークル本体を設定してください。");
    const drone = isDrone(item);
    const candidates = game.actors.filter(actor =>
        ["cast", "guest", "troop", "extra"].includes(actor.type) && actor.isOwner && !crewVehicle(actor)
        && actor.getFlag(SYSTEM_ID, "appearing") === true
        && !actor.system.isGhost
        && (drone ? actor.uuid === item.actor?.uuid : true));
    try {
        let actor = droppedActor;
        if (!actor) {
            if (!candidates.length) return ui.notifications.info("搭乗できるキャラクターがいません。");
            const uuid = await TargetSelectionDialog.prompt({
                title: "ヴィークルに搭乗", label: "キャラクター",
                options: candidates.map(a => ({ value: a.uuid, label: !game.user.isGM && a.getFlag(SYSTEM_ID, "appearingHidden") ? "？？？" : a.name })),
                selectLabel: "次へ", width: 420,
            });
            if (!uuid) return;
            actor = candidates.find(a => a.uuid === uuid);
        }
        if (!actor || !candidates.some(a => a.uuid === actor.uuid)) return ui.notifications.warn("このキャラクターは搭乗できません。権限・現在の搭乗状態を確認してください。");
        const roles = [];
        if (actor.uuid === item.actor?.uuid) roles.push({ value: "driver", label: "操縦者" });
        if (item.system.isPrepared) roles.push({ value: "passenger", label: "同乗者" });
        if (!roles.length) return ui.notifications.warn("同乗するにはヴィークルを準備してください。");
        const role = await TargetSelectionDialog.prompt({
            title: "搭乗時の役割", label: "役割", options: roles,
            selectLabel: "搭乗する", width: 420,
        });
        if (!roles.some(r => r.value === role)) return;
        await requestVehicleOperation("board", { vehicleUuid: vehicle.uuid, actorUuid: actor.uuid, role });
        if (vehicle.sheet?.rendered) vehicle.sheet.render(false);
    } catch (error) { ui.notifications.warn(error.message); }
}
