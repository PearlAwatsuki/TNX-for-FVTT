import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";
import { isVehicleBody, isDrone, validateCrew } from "../rules/vehicle.mjs";
import { isOutfitUnusable } from "../data/item/helpers.mjs";

// ドキュメント更新を直列化し、搭乗交代と登場時の重複生成を防ぐ。
let operations = Promise.resolve();
const pending = new Map();
const tokenQueues = new Map();
export const selectedCrew = new Map();
// 降車更新のフックが本人コマを再配置するときに引き継ぐ位置。
export const disembarkPositions = new Map();
const lookup = uuid => {
    try { return uuid ? globalThis.fromUuidSync?.(uuid) ?? null : null; } catch { return null; }
};
const appearing = actor => actor?.getFlag?.(SYSTEM_ID, "appearing") === true;

export function vehicleOutfit(vehicle) { return lookup(vehicle?.system?.outfitUuid); }
export function vehicles() { return (globalThis.game?.actors?.contents ?? []).filter(a => a.type === "vehicle"); }
export function vehicleForItem(item) { return vehicles().find(v => v.system.outfitUuid === item?.uuid) ?? null; }
export function crewVehicle(actor) {
    for (const vehicle of vehicles()) {
        const member = vehicle.system.crew.find(c => c.actorUuid === actor?.uuid);
        if (member) return { vehicle, member };
    }
    return null;
}
export function vehicleToken(vehicle) {
    return globalThis.canvas?.scene?.tokens?.find(t => t.actorId === vehicle?.id) ?? null;
}
export function activeVehicle(actor) {
    const relation = crewVehicle(actor);
    const item = vehicleOutfit(relation?.vehicle);
    if (!item || !item.system.isPrepared || isOutfitUnusable(item.system)) return null;
    return { ...relation, item };
}
export function preparedVehicle(actor, refId = "") {
    const relation = activeVehicle(actor);
    if (relation?.member.role === "driver" && (!refId || relation.item.id === refId || relation.item.uuid === refId)) return relation.item;
    return actor?.items?.find(i => isVehicleBody(i) && i.system.isPrepared && !isOutfitUnusable(i.system)
        && (!refId || i.id === refId || i.uuid === refId)) ?? null;
}

/** 防御参照は同乗先を一度だけ加える。所持していても他者が操縦中の車両は適用しない。 */
export function vehicleDefenceItems(actor) {
    const relation = activeVehicle(actor);
    const own = [...(actor?.items ?? [])].filter(i => {
        if (!isVehicleBody(i)) return true;
        if (isOutfitUnusable(i.system)) return false;
        const v = vehicleForItem(i);
        return !v || !v.system.crew.length || v.system.crew.some(c => c.actorUuid === actor.uuid);
    });
    if (relation && !own.some(i => i.uuid === relation.item.uuid)) own.push(relation.item);
    return own;
}

export function ghostCanInteract(actor) {
    if (!actor?.system?.isGhost) return true;
    const r = activeVehicle(actor);
    return !!(r && r.member.operationMode === "remote" && vehicleToken(r.vehicle));
}

/** 保存された対象経路は後の交代で付け替えない。 */
export function crewTarget(vehicle, member) {
    const actor = lookup(member.actorUuid);
    const token = vehicleToken(vehicle);
    if (!actor || !appearing(actor) || !token) return null;
    if (member.operationMode === "remote" && (!actor.system?.isGhost || !activeVehicle(actor))) return null;
    if (actor.system?.isGhost && member.operationMode !== "remote") return null;
    const name = !game.user.isGM && actor.getFlag(SYSTEM_ID, "appearingHidden") ? "？？？" : actor.name;
    return {
        uuid: actor.uuid, name: `${name}（${vehicle.name}）`,
        vehicleRoute: { vehicleUuid: vehicle.uuid, tokenUuid: token.uuid, outfitUuid: vehicle.system.outfitUuid,
            mode: member.operationMode, driverUuid: vehicle.system.crew.find(c => c.role === "driver")?.actorUuid ?? "" },
    };
}

export function toggleCrewTarget(vehicle, member) {
    const target = crewTarget(vehicle, member);
    if (!target) return ui.notifications.warn("この乗員は現在ターゲットにできません。");
    const key = `${vehicle.uuid}:${member.actorUuid}`;
    if (selectedCrew.has(key)) selectedCrew.delete(key);
    else selectedCrew.set(key, target);
    vehicleToken(vehicle)?.object?.setTarget([...selectedCrew.values()].some(ref => ref.vehicleRoute.vehicleUuid === vehicle.uuid), { releaseOthers: false });
    if (vehicle.sheet?.rendered) vehicle.sheet.render(false);
}

/** UI操作はGMに集約。応答を待ってから次の操作へ進む。 */
export async function requestVehicleOperation(action, data = {}) {
    if (game.user.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id)) return queueOperation(action, data, game.user);
    if (!game.users.activeGM) throw new Error("ヴィークルの変更には接続中のRLが必要です。");
    const requestId = foundry.utils.randomID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("ヴィークル操作の応答を確認できません。状態を確認して再試行してください。")); }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        game.socket.emit(SOCKET_CHANNEL, { type: "vehicleOperation", action, data, requestId, userId: game.user.id });
    });
}

export async function handleVehicleMessage(message) {
    if (message.type === "vehicleResult") {
        if (message.userId !== game.user.id) return;
        const p = pending.get(message.requestId);
        if (!p) return;
        clearTimeout(p.timer); pending.delete(message.requestId);
        if (message.error) p.reject(new Error(message.error)); else p.resolve(message.result);
        return;
    }
    if (game.users.activeGM?.id !== game.user.id) return;
    const user = game.users.get(message.userId);
    if (!user?.active) return;
    try {
        const result = await queueOperation(message.action, message.data, user);
        game.socket.emit(SOCKET_CHANNEL, { type: "vehicleResult", requestId: message.requestId, userId: user.id, result });
    } catch (error) {
        game.socket.emit(SOCKET_CHANNEL, { type: "vehicleResult", requestId: message.requestId, userId: user.id, error: error.message });
    }
}

function queueOperation(action, data, user) {
    const next = operations.then(() => operate(action, data, user));
    operations = next.catch(() => {});
    return next;
}
function owns(doc, user) { return !!doc && (user.isGM || doc.testUserPermission(user, "OWNER")); }

/** CONFIG のモデル登録だけでは、サーバーが配る有効な文書型は更新されない。 */
export function vehicleRegistrationError() {
    if (!globalThis.Actor?.TYPES?.includes("vehicle")) {
        return "ヴィークルのActor型がFoundryに読み込まれていません。Foundry本体（サーバー）を終了して再起動し、ワールドを開き直してください。ブラウザの再読み込みだけでは反映されません。";
    }
    return null;
}

async function ensureVehicle(item) {
    let vehicle = vehicleForItem(item);
    if (vehicle) return vehicle;
    if (!isVehicleBody(item)) throw new Error("ヴィークル本体を指定してください。");
    const registrationError = vehicleRegistrationError();
    if (registrationError) throw new Error(registrationError);
    const tokenConfig = item.actor?.prototypeToken?.toObject?.() ?? {};
    vehicle = await Actor.create({ name: item.name, img: item.img, type: "vehicle",
        system: { outfitUuid: item.uuid }, ownership: item.actor?.ownership ?? { default: 0 },
        prototypeToken: { actorLink: true, texture: { src: item.img }, name: item.name,
            ...(tokenConfig.sight ? { sight: tokenConfig.sight } : {}),
            ...(tokenConfig.detectionModes ? { detectionModes: tokenConfig.detectionModes } : {}),
        },
    });
    // Foundry は検証失敗や preCreate の中止時、例外ではなく undefined を返すことがある。
    if (!vehicle) throw new Error("ヴィークルアクターを作成できませんでした。Foundryの通知とコンソールを確認してください。搭乗状態は変更していません。");
    return vehicle;
}

async function operate(action, data, user) {
    const actor = lookup(data.actorUuid);
    let vehicle = lookup(data.vehicleUuid);
    const item = data.itemUuid ? lookup(data.itemUuid) : vehicleOutfit(vehicle);
    if (action === "create") {
        if (!owns(item?.actor, user)) throw new Error("このアウトフィットを操作する権限がありません。");
        return (await ensureVehicle(item)).uuid;
    }
    if (action === "link") {
        if (!owns(vehicle, user) || !owns(item?.actor, user) || !isVehicleBody(item)) throw new Error("所有するヴィークル本体を指定してください。");
        if (vehicle.system.crew.length) throw new Error("乗員がいる間は参照先を変更できません。");
        const existing = vehicleForItem(item);
        if (existing && existing.uuid !== vehicle.uuid) throw new Error("このアウトフィットには既に車両アクターがあります。");
        await vehicle.update({ "system.outfitUuid": item.uuid });
        return vehicle.uuid;
    }
    if (!owns(actor, user)) throw new Error("乗員を操作する権限がありません。");
    if (action === "combat") {
        if (!crewVehicle(actor)) throw new Error("搭乗中の乗員を指定してください。");
        if (!game.combat) throw new Error("先に戦闘を作成してください。");
        if (game.combat.combatants.some(c => c.actor?.uuid === actor.uuid)) return actor.uuid;
        const token = game.scenes.active?.tokens.find(t => t.actor?.uuid === actor.uuid);
        await game.combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id,
            ...(token ? { tokenId: token.id, sceneId: token.parent.id } : {}) }]);
        return actor.uuid;
    }
    if (action === "appear") {
        const candidates = [...actor.items].filter(i => isVehicleBody(i) && i.system.isPrepared);
        if (candidates.length > 1) throw new Error("準備中のヴィークルを一台にしてください。");
        const source = candidates[0];
        if (!source || (actor.system.isGhost && !isDrone(source))) return null;
        if (isOutfitUnusable(source.system)) throw new Error("準備中のヴィークルは故障または破壊されています。");
        vehicle = await ensureVehicle(source);
        await board(vehicle, actor, "driver", user);
        return vehicle.uuid;
    }
    if (action === "exit") {
        if (appearing(actor)) throw new Error("登場中の乗員は降車操作を使用してください。");
        const relation = crewVehicle(actor);
        if (!relation) return null;
        // 退場は準備解除ではない。次の登場時の準備済み車両との連携を維持する。
        const scene = game.scenes?.active;
        if (scene && (relation.member.role === "driver" || !relation.vehicle.system.crew.some(c => c.actorUuid !== actor.uuid && appearing(lookup(c.actorUuid))))) {
            const tokens = scene.tokens.filter(t => t.actorId === relation.vehicle.id);
            if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id), { tnxAppearanceSync: true });
        }
        await relation.vehicle.update({ "system.crew": relation.vehicle.system.crew.filter(c => c.actorUuid !== actor.uuid) });
        disembarkPositions.delete(actor.uuid);
        return relation.vehicle.uuid;
    }
    if (action === "leave") {
        const relation = crewVehicle(actor);
        if (!relation) return null;
        if (data.vehicleUuid && relation.vehicle.uuid !== data.vehicleUuid) throw new Error("搭乗先が変わっています。現在の車両を確認してください。");
        await leave(relation.vehicle, actor);
        return relation.vehicle.uuid;
    }
    if (action === "board") {
        if (!appearing(actor)) throw new Error("未登場のキャラクターは搭乗できません。先にシーンへ登場してください。");
        if (!vehicle || vehicle.type !== "vehicle" || !owns(vehicle, user)) throw new Error("この車両に搭乗する権限がありません。RLに乗員登録を依頼してください。");
        await board(vehicle, actor, data.role === "driver" ? "driver" : "passenger", user);
        return vehicle.uuid;
    }
    throw new Error("不明なヴィークル操作です。");
}

async function board(vehicle, actor, role, user) {
    if (!["cast", "guest", "troop", "extra"].includes(actor.type)) throw new Error("キャラクターを指定してください。");
    const item = vehicleOutfit(vehicle);
    if (!isVehicleBody(item) || isOutfitUnusable(item.system)) throw new Error("利用できるヴィークル本体がありません。");
    const remote = isDrone(item);
    if (remote && role !== "driver") throw new Error("ドローンには遠隔操縦者を指定してください。");
    if (!remote && actor.system.isGhost) throw new Error("ゴーストは通常車両に物理搭乗できません。");
    if (remote && actor.system.isGhost === undefined) throw new Error("このキャラクターはゴースト登場に対応していません。");
    const previous = crewVehicle(actor);
    if (previous && previous.vehicle.uuid !== vehicle.uuid) throw new Error("現在の車両から降車してから搭乗してください。");
    const driver = vehicle.system.crew.find(c => c.role === "driver" && c.actorUuid !== actor.uuid);
    if (role === "driver" && driver && !owns(lookup(driver.actorUuid), user)) throw new Error("操縦交代には旧操縦者の操作権限が必要です。RLに依頼してください。");
    // 所有者以外の操縦では部位・効果の転送規則が未確定。正本の付け替えを黙って行わない。
    if (role === "driver" && item.actor?.uuid !== actor.uuid) throw new Error("他者所有車の操縦は未対応です。操縦者のアウトフィットを紐づけてください。");
    const crew = vehicle.system.crew.filter(c => c.actorUuid !== actor.uuid && !(role === "driver" && c.role === "driver"))
        .map(c => ({ ...c }));
    if (role === "driver" && driver && !remote) crew.push({ ...driver, role: "passenger" });
    crew.push({ actorUuid: actor.uuid, tokenUuid: actor.token?.uuid ?? actor.getActiveTokens?.()[0]?.document.uuid ?? "",
        role, operationMode: remote ? "remote" : "onboard" });
    const error = validateCrew(crew, item.system.passenger);
    if (error) throw new Error(error);
    const oldPrepared = item.system.isPrepared;
    const oldGhost = actor.system.isGhost;
    if (role === "driver" && !item.system.isPrepared) {
        if (!item.system.isCarrying) throw new Error("携帯中のヴィークルを指定してください。");
        if ([...actor.items].some(i => isVehicleBody(i) && i.uuid !== item.uuid && i.system.isPrepared)) throw new Error("別のヴィークルが準備されています。");
        await item.update({ "system.isPrepared": true });
    }
    if (role !== "driver" && !item.system.isPrepared) throw new Error("準備済みのヴィークルに同乗してください。");
    const oldCrew = vehicle.system.crew.map(c => ({ ...c }));
    try {
        await vehicle.update({ "system.crew": crew });
        if (remote && !actor.system.isGhost) await actor.update({ "system.isGhost": true });
    } catch (error) {
        await vehicle.update({ "system.crew": oldCrew });
        if (item.system.isPrepared !== oldPrepared) await item.update({ "system.isPrepared": oldPrepared });
        if (actor.system.isGhost !== oldGhost) await actor.update({ "system.isGhost": oldGhost });
        throw error;
    }
}

async function leave(vehicle, actor) {
    const member = vehicle.system.crew.find(c => c.actorUuid === actor.uuid);
    if (!member) return;
    const position = vehicleToken(vehicle);
    const item = vehicleOutfit(vehicle);
    const before = vehicle.system.crew.map(c => ({ ...c }));
    if (member.operationMode !== "remote" && position && appearing(actor)) disembarkPositions.set(actor.uuid, {
        sceneId: position.parent.id, x: position.x, y: position.y, elevation: position.elevation,
    });
    try {
        await vehicle.update({ "system.crew": before.filter(c => c.actorUuid !== actor.uuid) });
        if (member.role === "driver" && item?.system.isPrepared) await item.update({ "system.isPrepared": false });
    } catch (error) {
        disembarkPositions.delete(actor.uuid);
        await vehicle.update({ "system.crew": before });
        throw error;
    }
}

/** 登場成立前の準備。未登場の乗員を一緒に登場させない。 */
export async function prepareVehicleAppearance(actor) {
    if (actor.type === "vehicle") return;
    const relation = activeVehicle(actor);
    if (relation?.member.role === "passenger") return relation.vehicle.uuid;
    if (![...(actor.items ?? [])].some(i => isVehicleBody(i) && i.system.isPrepared)) return null;
    return requestVehicleOperation("appear", { actorUuid: actor.uuid });
}

/** 登場中の車両を一台だけ配置する。本人の登場記帳はActorで保持する。 */
export async function syncVehicleTokens(actor, scene) {
    const relation = crewVehicle(actor);
    if (!relation || !appearing(actor)) return false;
    const vehicle = relation.vehicle;
    const key = `${scene.id}:${vehicle.id}`;
    const previous = tokenQueues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => placeVehicleToken(vehicle, actor, scene));
    tokenQueues.set(key, operation);
    try { await operation; } finally { if (tokenQueues.get(key) === operation) tokenQueues.delete(key); }
    return true;
}

async function placeVehicleToken(vehicle, actor, scene) {
    let token = scene.tokens.find(t => t.actorId === vehicle.id);
    if (!token) {
        const driverAppearing = () => vehicle.system.crew.some(c => c.role === "driver" && appearing(lookup(c.actorUuid)));
        // 同乗者の同期だけでは、退場した操縦者の車両を再配置しない。
        if (!driverAppearing()) return;
        const own = scene.tokens.find(t => t.actor?.uuid === actor.uuid);
        const rect = scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene.width, height: scene.height };
        const proto = await vehicle.getTokenDocument({ x: own?.x ?? rect.x + rect.width / 2, y: own?.y ?? rect.y + rect.height / 2 });
        if (!driverAppearing()) return;
        [token] = await scene.createEmbeddedDocuments("Token", [proto.toObject()], { tnxAppearanceSync: true });
        if (!token) throw new Error("ヴィークルのコマを配置できませんでした。本人のコマは保持します。");
        if (!driverAppearing()) await scene.deleteEmbeddedDocuments("Token", [token.id], { tnxAppearanceSync: true });
    }
}

export function registerVehicleHooks() {
    Hooks.on("preUpdateToken", (token, changes, options) => {
        if (options.tnxVehicleMove || !["x", "y"].some(k => k in changes)) return;
        const boarding = crewVehicle(token.actor);
        if (boarding?.member.operationMode !== "onboard") return;
        ui.notifications.warn("搭乗中はヴィークルのコマを移動してください。");
        return false;
    });
    Hooks.on("preCreateActor", (actor, data) => {
        if (data.type !== "vehicle") return;
        const source = data.system?.outfitUuid;
        actor.updateSource({ "prototypeToken.actorLink": true, "system.crew": [],
            ...(source && vehicles().some(v => v.system.outfitUuid === source) ? { "system.outfitUuid": "" } : {}) });
    });
    Hooks.on("canvasReady", () => selectedCrew.clear());
    Hooks.on("targetToken", (_user, token, targeted) => {
        if (_user.id !== game.user.id || targeted) return;
        for (const [key, ref] of selectedCrew) if (ref.vehicleRoute.tokenUuid === token.document.uuid) selectedCrew.delete(key);
    });
    Hooks.on("preCreateCombatant", (_doc, data) => {
        if (game.actors.get(data.actorId)?.type !== "vehicle") return;
        ui.notifications.warn("ヴィークルには独立した手番がありません。乗員を戦闘に追加してください。");
        return false;
    });
    const refresh = () => {
        for (const v of vehicles()) v.sheet?.render(false);
        for (const app of foundry.applications.instances.values()) if (app.actor || app.id === "tnx-hud") app.render(false);
        for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshState: true });
    };
    Hooks.on("updateItem", (item) => {
        refresh();
        if (game.users.activeGM?.id !== game.user.id || !isVehicleBody(item)) return;
        const vehicle = vehicleForItem(item);
        const driver = vehicle?.system.crew.find(c => c.role === "driver");
        if (!item.system.isPrepared && driver) {
            queueOperation("leave", { actorUuid: driver.actorUuid }, game.user).catch(e => ui.notifications.warn(e.message));
        } else if (item.system.isPrepared && appearing(item.actor) && !driver && !isOutfitUnusable(item.system)) {
            queueOperation("appear", { actorUuid: item.actor.uuid }, game.user).catch(e => ui.notifications.warn(e.message));
        }
    });
    Hooks.on("deleteItem", refresh);
    Hooks.on("updateActor", (actor, changes) => {
        if (actor.type === "vehicle" || changes.system?.isGhost !== undefined || changes.flags?.[SYSTEM_ID]) refresh();
    });
}
