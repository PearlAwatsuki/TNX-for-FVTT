import { crewTarget, selectedCrew, vehicleOutfit, requestVehicleOperation } from "./vehicle-state.mjs";
import { isDrone } from "../rules/vehicle.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { promptVehicleBoarding } from "./vehicle-boarding.mjs";

let expanded = null;
let updatingTargets = false;
let boarding = false;
let suppressDropClickUntil = 0;
let departing = null;
let canvasDropRegistered = false;

/** initで登録する。PIXIはwindowのcaptureでドラッグを終了するため、それより先に受ける。 */
export function registerVehicleCanvasDrop() {
    if (canvasDropRegistered) return;
    window.addEventListener("pointerup", dropCanvasToken, { capture: true });
    canvasDropRegistered = true;
}

/** 乗員表示から盤面へのドロップだけを降車として扱う。外部UIへのドラッグでは変更しない。 */
function dropCrewOnCanvas(event) {
    if (!departing || event.target.tagName !== "CANVAS") return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { vehicleUuid, actorUuid } = departing;
    departing = null;
    suppressDropClickUntil = Date.now() + 300;
    void requestVehicleOperation("leave", { vehicleUuid, actorUuid })
        .then(() => refreshTokens()).catch(error => ui.notifications.warn(error.message));
}

/** 表示を開いた車両へ搭乗する。ドロップ後も権限・登場状態は共通処理で検証する。 */
async function boardDroppedActor(vehicle, actor) {
    if (boarding) return;
    if (!vehicle.isOwner) return ui.notifications.warn("この車両に搭乗させる権限がありません。");
    boarding = true;
    try { await promptVehicleBoarding(vehicle, actor); }
    finally { boarding = false; refreshTokens(); }
}

async function dropDocument(event, vehicle) {
    event.preventDefault(); event.stopPropagation();
    try {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const doc = data.uuid ? await fromUuid(data.uuid) : null;
        const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
        if (actor) await boardDroppedActor(vehicle, actor);
    } catch (error) { ui.notifications.warn(error.message); }
}

/** PIXIのコマ移動をDOMの展開領域で受ける。通常の移動更新は確定させない。 */
function dropCanvasToken(event) {
    if (!expanded || event.button !== 0) return;
    const rect = expanded.element.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const manager = canvas.tokens?._draggedToken?.mouseInteractionManager ?? canvas.currentMouseManager;
    const originals = (manager?.interactionData?.clones ?? []).map(clone => clone._original).filter(token => token?.actor);
    if (!originals.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    suppressDropClickUntil = Date.now() + 300;
    const vehicle = expanded.token.actor;
    expanded.element.classList.remove("tnx-drop-active");
    manager.interactionData.cancelled = true;
    manager.cancel();
    if (originals.length !== 1) return ui.notifications.warn("搭乗させるコマを一体ずつドロップしてください。");
    void boardDroppedActor(vehicle, originals[0].actor);
}

export function closeVehicleTargets() {
    departing = null;
    expanded?.controller.abort();
    expanded?.element.remove();
    expanded = null;
}

function positionTokens() {
    if (!expanded) return;
    const { token, element } = expanded;
    if (!token.isVisible || token.destroyed) return closeVehicleTargets();
    const bounds = token.getBounds();
    const viewport = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = viewport.left + bounds.x + bounds.width + 16;
    if (left + width > window.innerWidth - 12) left = viewport.left + bounds.x - width - 16;
    element.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
    element.style.top = `${Math.max(12, Math.min(viewport.top + bounds.y, window.innerHeight - height - 12))}px`;
}

function refreshTokens() {
    if (!expanded) return;
    if (departing) return; // ドラッグ元のDOMを途中で差し替えない。
    const { token, element } = expanded;
    if (!token.isVisible) return closeVehicleTargets();
    const vehicle = token.actor;
    const list = element.querySelector(".tnx-crew-tokens");
    list.replaceChildren();
    const valid = new Set();
    for (const member of vehicle.system.crew) {
        const actor = fromUuidSync(member.actorUuid);
        if (!actor || actor.getFlag(SYSTEM_ID, "appearing") !== true) continue;
        const ref = crewTarget(vehicle, member);
        const key = `${vehicle.uuid}:${member.actorUuid}`;
        if (ref) valid.add(key);
        const hidden = !game.user.isGM && actor.getFlag(SYSTEM_ID, "appearingHidden");
        const name = hidden ? "？？？" : actor.name;
        const role = member.operationMode === "remote" ? "遠隔操縦者" : member.role === "driver" ? "操縦者" : "同乗者";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tnx-crew-token";
        button.dataset.actorUuid = actor.uuid;
        button.disabled = !ref;
        button.setAttribute("aria-pressed", String(!!ref && selectedCrew.has(key)));
        button.setAttribute("aria-label", `${name}（${role}）をターゲット`);
        button.title = ref ? `${name}（${role}） — クリックで対象を切替` : `${name}（${role}） — 現在は対象にできません`;
        if (vehicle.isOwner && actor.isOwner) {
            button.draggable = true;
            button.title += member.operationMode === "remote" ? "／盤面へドラッグして遠隔操縦終了" : "／盤面へドラッグして降車";
            button.addEventListener("dragstart", event => {
                departing = { vehicleUuid: vehicle.uuid, actorUuid: actor.uuid };
                // Actor型のドラッグデータにしない。コアによる本人コマの複製を防ぐ。
                event.dataTransfer.setData("text/plain", JSON.stringify({ type: "tnxVehicleCrew", ...departing }));
                event.dataTransfer.effectAllowed = "move";
                suppressDropClickUntil = Date.now() + 300;
            });
            button.addEventListener("dragend", () => { departing = null; refreshTokens(); });
        }
        const img = document.createElement("img");
        const texture = actor.prototypeToken?.texture?.src;
        img.src = hidden ? "icons/svg/mystery-man.svg" : texture && !texture.includes("*") ? texture : actor.img;
        img.alt = "";
        const caption = document.createElement("span");
        caption.textContent = name;
        const badge = document.createElement("small");
        badge.textContent = role;
        const target = document.createElement("i");
        target.className = "fas fa-crosshairs";
        target.setAttribute("aria-hidden", "true");
        button.append(img, target, caption, badge);
        button.addEventListener("click", () => {
            const current = vehicle.system.crew.find(c => c.actorUuid === member.actorUuid);
            const currentRef = current && crewTarget(vehicle, current);
            if (!currentRef || !token.isVisible) return refreshTokens();
            if (selectedCrew.has(key)) selectedCrew.delete(key);
            else selectedCrew.set(key, currentRef);
            updatingTargets = true;
            try {
                token.setTarget([...selectedCrew.values()].some(r => r.vehicleRoute.tokenUuid === token.document.uuid), { releaseOthers: false });
            } finally { updatingTargets = false; }
            refreshTokens();
            if (vehicle.sheet?.rendered) vehicle.sheet.render(false);
            list.querySelector(`[data-actor-uuid="${CSS.escape(actor.uuid)}"]`)?.focus();
        });
        list.append(button);
    }
    let removed = false;
    for (const [key, ref] of selectedCrew) {
        if (ref.vehicleRoute.tokenUuid === token.document.uuid && !valid.has(key)) {
            selectedCrew.delete(key);
            removed = true;
        }
    }
    if (removed && ![...selectedCrew.values()].some(ref => ref.vehicleRoute.tokenUuid === token.document.uuid)) {
        updatingTargets = true;
        try { token.setTarget(false, { releaseOthers: false }); }
        finally { updatingTargets = false; }
    }
    if (!list.children.length) {
        const empty = document.createElement("p");
        empty.textContent = "搭乗者はいません。";
        list.append(empty);
    }
    positionTokens();
}

/** 車両の横に乗員コマを展開する。盤面Documentやシートは生成しない。 */
export function showVehicleTargets(token) {
    if (token?.actor?.type !== "vehicle" || !token.isVisible) return;
    closeVehicleTargets();
    const element = document.createElement("section");
    element.className = "tokyo-nova tnx-vehicle-occupants";
    element.setAttribute("aria-label", "搭乗者のトークン");
    const header = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = `${token.name ?? token.actor.name} ／ 乗員`;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tnx-icon-ctrl";
    close.title = "乗員表示を閉じる";
    close.setAttribute("aria-label", close.title);
    close.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
    close.addEventListener("click", closeVehicleTargets);
    header.append(title, close);
    const list = document.createElement("div");
    list.className = "tnx-crew-tokens";
    element.append(header, list);
    const controller = new AbortController();
    expanded = { token, element, controller };
    document.body.append(element);
    document.addEventListener("dragover", event => {
        if (departing && event.target.tagName === "CANVAS") {
            event.preventDefault(); event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        }
    }, { capture: true, signal: controller.signal });
    document.addEventListener("drop", dropCrewOnCanvas, { capture: true, signal: controller.signal });
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("dblclick", event => event.stopPropagation());
    element.addEventListener("click", event => {
        if (Date.now() < suppressDropClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true });
    element.addEventListener("dragover", event => {
        event.preventDefault(); event.stopPropagation();
        if (token.actor.isOwner) element.classList.add("tnx-drop-active");
    });
    element.addEventListener("dragleave", event => {
        if (!element.contains(event.relatedTarget)) element.classList.remove("tnx-drop-active");
    });
    element.addEventListener("drop", event => {
        element.classList.remove("tnx-drop-active");
        void dropDocument(event, token.actor);
    });
    document.addEventListener("pointermove", event => {
        const rect = element.getBoundingClientRect();
        const manager = canvas.tokens?._draggedToken?.mouseInteractionManager ?? canvas.currentMouseManager;
        const dragging = !!manager?.interactionData?.clones?.some(c => c._original?.actor);
        element.classList.toggle("tnx-drop-active", token.actor.isOwner && dragging
            && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    }, { capture: true, signal: controller.signal });
    document.addEventListener("pointerup", dropCanvasToken, { capture: true, signal: controller.signal });
    document.addEventListener("pointerdown", event => {
        // コマ／Actorをつかむ操作では閉じず、ドロップ先として残す。
        if (event.target.tagName === "CANVAS" || event.target.closest?.('[draggable="true"]')) return;
        if (!element.contains(event.target) && !event.target.closest?.('[data-tnx-crew-targets]')) closeVehicleTargets();
    }, { signal: controller.signal });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") { closeVehicleTargets(); event.stopPropagation(); }
    }, { signal: controller.signal });
    window.addEventListener("resize", positionTokens, { signal: controller.signal });
    refreshTokens();
}

export function registerVehicleTargetHUD() {
    Hooks.on("renderTokenHUD", (hud, html) => {
        const token = hud.object;
        if (token?.actor?.type !== "vehicle") return;
        const root = html instanceof HTMLElement ? html : html[0];
        root.querySelector('[data-tnx-crew-targets]')?.remove();
        const button = document.createElement("button");
        button.type = "button";
        button.className = "control-icon";
        button.dataset.tnxCrewTargets = "true";
        button.title = "乗員のトークンを展開";
        button.setAttribute("aria-label", button.title);
        button.innerHTML = '<i class="fas fa-users" aria-hidden="true"></i>';
        button.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (expanded?.token === token) closeVehicleTargets(); else showVehicleTargets(token);
        });
        (root.querySelector(".col.left") ?? root).append(button);
    });
    Hooks.on("targetToken", (user, token, targeted) => {
        if (user.id !== game.user.id || updatingTargets || token.actor?.type !== "vehicle") return;
        if (expanded?.token === token) { refreshTokens(); return; }
        if (!targeted || isDrone(vehicleOutfit(token.actor))) return;
        if ([...selectedCrew.values()].some(ref => ref.vehicleRoute.tokenUuid === token.document.uuid)) return;
        showVehicleTargets(token);
    });
    Hooks.on("canvasPan", positionTokens);
    Hooks.on("refreshToken", token => { if (expanded?.token === token) positionTokens(); });
    Hooks.on("updateActor", refreshTokens);
    Hooks.on("deleteActor", refreshTokens);
    Hooks.on("updateItem", refreshTokens);
    Hooks.on("deleteToken", token => { if (expanded?.token.document.uuid === token.uuid) closeVehicleTargets(); });
    Hooks.on("canvasTearDown", closeVehicleTargets);
}
