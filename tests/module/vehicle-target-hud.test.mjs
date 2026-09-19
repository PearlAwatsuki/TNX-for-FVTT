import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
vi.mock("../../scripts/session/vehicle-boarding.mjs", () => ({ promptVehicleBoarding: vi.fn() }));
import { promptVehicleBoarding } from "../../scripts/session/vehicle-boarding.mjs";
vi.mock("../../scripts/session/vehicle-state.mjs", () => ({
    requestVehicleOperation: vi.fn(async () => {}),
    selectedCrew: new Map(), vehicleOutfit: () => null,
    crewTarget: (vehicle, member) => member.gone ? null : ({ uuid: member.actorUuid, name: member.actorUuid,
        vehicleRoute: { vehicleUuid: vehicle.uuid, tokenUuid: "Token.car" } }),
    dronePilot: () => null,
}));
import { selectedCrew, requestVehicleOperation } from "../../scripts/session/vehicle-state.mjs";
import { showVehicleTargets, closeVehicleTargets, registerVehicleTargetHUD, registerVehicleCanvasDrop } from "../../scripts/session/vehicle-target-hud.mjs";

describe("車両から乗員トークンを展開", () => {
    let token, dom, hooks;
    beforeEach(() => {
        selectedCrew.clear();
        vi.clearAllMocks();
        dom = new JSDOM('<body><canvas></canvas><div id="hud"><div class="col left"></div><div class="col right"></div></div></body>');
        for (const name of ["window", "document", "HTMLElement", "AbortController"]) vi.stubGlobal(name, dom.window[name]);
        vi.stubGlobal("CSS", { escape: value => value });
        vi.stubGlobal("canvas", {});
        vi.stubGlobal("game", { user: { id: "player", isGM: false } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        vi.stubGlobal("fromUuidSync", uuid => ({ uuid, name: uuid, img: "portrait.webp", prototypeToken: { texture: { src: "token.webp" } }, getFlag: (_scope, key) => key === "appearing" }));
        token = { name: "車両", isVisible: true, document: { uuid: "Token.car" }, setTarget: vi.fn(),
            getBounds: () => ({ x: 100, y: 100, width: 100, height: 100 }),
            actor: { type: "vehicle", uuid: "Actor.car", isOwner: false,
                system: { crew: [{ actorUuid: "Actor.a", role: "driver" }, { actorUuid: "Actor.b", role: "passenger" }] },
                sheet: { rendered: false, render: vi.fn() } } };
        hooks = {};
        vi.stubGlobal("Hooks", { on: (name, fn) => { hooks[name] = fn; } });
        registerVehicleTargetHUD();
    });
    afterEach(() => { closeVehicleTargets(); dom.window.close(); vi.unstubAllGlobals(); });
    const buttons = () => [...document.querySelectorAll(".tnx-crew-token")];
    it("シートもダイアログも開かず、トークン画像から複数選択と解除ができる", () => {
        showVehicleTargets(token);
        expect(buttons()).toHaveLength(2);
        expect(buttons()[0].querySelector("img").getAttribute("src")).toBe("token.webp");
        buttons()[0].click(); buttons()[1].click();
        expect(selectedCrew.size).toBe(2);
        expect(buttons().every(b => b.getAttribute("aria-pressed") === "true")).toBe(true);
        buttons()[0].click(); buttons()[1].click();
        expect(selectedCrew.size).toBe(0);
        expect(token.setTarget).toHaveBeenLastCalledWith(false, { releaseOthers: false });
        expect(token.actor.sheet.render).not.toHaveBeenCalled();
    });
    it("降車した乗員の表示と選択を除去する", () => {
        showVehicleTargets(token); buttons()[0].click();
        token.actor.system.crew.shift();
        hooks.updateActor(token.actor);
        expect(buttons()).toHaveLength(1);
        expect(selectedCrew.size).toBe(0);
    });
    it("秘匿された乗員の名前と画像は公開しない", () => {
        vi.stubGlobal("fromUuidSync", () => ({ uuid: "Actor.a", name: "秘密", img: "secret.webp", getFlag: () => true }));
        showVehicleTargets(token);
        expect(buttons()[0].textContent).toContain("？？？");
        expect(buttons()[0].querySelector("img").src).toContain("mystery-man.svg");
        expect(document.body.innerHTML).not.toContain("secret.webp");
    });
    it("HUDと敵車両のターゲット操作で展開でき、閉じても選択は維持する", () => {
        hooks.renderTokenHUD({ object: token }, document.querySelector("#hud"));
        expect(document.querySelector('.col.left [data-tnx-crew-targets]')).not.toBeNull();
        expect(document.querySelector('.col.right [data-tnx-crew-targets]')).toBeNull();
        document.querySelector('[data-tnx-crew-targets]').click();
        buttons()[0].click();
        document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
        expect(buttons()).toHaveLength(0);
        expect(selectedCrew.size).toBe(1);
        selectedCrew.clear();
        hooks.targetToken(game.user, token, true);
        expect(buttons()).toHaveLength(2);
        hooks.canvasTearDown();
        expect(buttons()).toHaveLength(0);
    });
    it("盤面コマのドロップでは移動を中止して共通の搭乗操作へ渡す", async () => {
        token.actor.isOwner = true;
        showVehicleTargets(token);
        document.querySelector("canvas").dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
        const panel = document.querySelector(".tnx-vehicle-occupants");
        expect(panel).not.toBeNull();
        panel.getBoundingClientRect = () => ({ left: 100, right: 400, top: 100, bottom: 400 });
        const passenger = { uuid: "Actor.new" };
        const manager = { interactionData: { clones: [{ _original: { actor: passenger } }] }, cancel: vi.fn() };
        canvas.currentMouseManager = manager;
        panel.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200 }));
        expect(manager.cancel).toHaveBeenCalledOnce();
        expect(manager.interactionData.cancelled).toBe(true);
        expect(promptVehicleBoarding).toHaveBeenCalledWith(token.actor, passenger);
        await Promise.resolve();
    });
    it("PIXIのwindow captureがドラッグを消す前に搭乗へ渡し、パネル外の移動は妨げない", async () => {
        token.actor.isOwner = true;
        showVehicleTargets(token);
        const panel = document.querySelector(".tnx-vehicle-occupants");
        panel.getBoundingClientRect = () => ({ left: 100, right: 400, top: 100, bottom: 400 });
        const passenger = { uuid: "Actor.new" };
        const manager = { interactionData: { clones: [{ _original: { actor: passenger } }] }, cancel: vi.fn() };
        // コマ固有のマネージャーを使う。盤面全体のマネージャーとは限らない。
        canvas.currentMouseManager = { interactionData: {} };
        canvas.tokens = { _draggedToken: { mouseInteractionManager: manager } };
        registerVehicleCanvasDrop();
        const pixiPointerUp = vi.fn(() => { manager.interactionData.clones = []; });
        window.addEventListener("pointerup", pixiPointerUp, { capture: true });
        panel.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200 }));
        expect(pixiPointerUp).not.toHaveBeenCalled();
        expect(promptVehicleBoarding).toHaveBeenCalledWith(token.actor, passenger);
        expect(manager.cancel).toHaveBeenCalledOnce();
        document.querySelector("canvas").dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
        expect(pixiPointerUp).toHaveBeenCalledOnce();
        await Promise.resolve();
    });
    it("Actor/Tokenドキュメントのドロップも同じ搭乗経路へ渡す", async () => {
        token.actor.isOwner = true;
        showVehicleTargets(token);
        const passenger = { uuid: "Actor.new" };
        vi.stubGlobal("fromUuid", vi.fn(async () => ({ documentName: "Token", actor: passenger })));
        vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { implementation: { getDragEventData: () => ({ uuid: "Scene.s.Token.p" }) } } } } });
        expect(document.querySelector(".tnx-crew-drop-hint")).toBeNull();
        // ヘッダーも含めパネル全体で受け付ける。
        document.querySelector(".tnx-vehicle-occupants header").dispatchEvent(new window.Event("drop", { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(promptVehicleBoarding).toHaveBeenCalledWith(token.actor, passenger));
    });
    function beginCrewDrag() {
        token.actor.isOwner = true;
        vi.stubGlobal("fromUuidSync", uuid => ({ uuid, name: uuid, isOwner: true, img: "token.webp", getFlag: (_scope, key) => key === "appearing" }));
        showVehicleTargets(token);
        const button = buttons()[0];
        const event = new window.Event("dragstart", { bubbles: true });
        const dataTransfer = { setData: vi.fn() };
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
        button.dispatchEvent(event);
        return { button, dataTransfer };
    }
    it("パネルの乗員を盤面へドロップすると、複製せず降車を要求する", async () => {
        const { dataTransfer } = beginCrewDrag();
        expect(JSON.parse(dataTransfer.setData.mock.calls[0][1]).type).toBe("tnxVehicleCrew");
        const drop = new window.Event("drop", { bubbles: true, cancelable: true });
        document.querySelector("canvas").dispatchEvent(drop);
        expect(drop.defaultPrevented).toBe(true);
        expect(requestVehicleOperation).toHaveBeenCalledWith("leave", { vehicleUuid: token.actor.uuid, actorUuid: "Actor.a" });
        await Promise.resolve();
    });
    it("盤面以外へ放した場合は降車しない", () => {
        const { button } = beginCrewDrag();
        document.querySelector("#hud").dispatchEvent(new window.Event("drop", { bubbles: true }));
        button.dispatchEvent(new window.Event("dragend"));
        expect(requestVehicleOperation).not.toHaveBeenCalled();
    });
    it("車両が不可視になれば展開を閉じる", () => {
        showVehicleTargets(token);
        token.isVisible = false;
        hooks.refreshToken(token);
        expect(buttons()).toHaveLength(0);
    });
});
