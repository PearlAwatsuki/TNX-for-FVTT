import { beforeEach, describe, expect, it, vi } from "vitest";

class Element {
    textContent = "";
    children = [];
    listeners = {};
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    querySelector(selector) { return this.children.find(c => selector === `.${c.className}`) ?? null; }
    remove() { this.removed = true; }
}
class Graphics {
    clear() { return this; }
    destroy() { this.destroyed = true; }
    lineStyle() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    beginFill() { return this; }
    drawRect() { return this; }
    drawCircle() { return this; }
    endFill() { return this; }
}
class BaseRuler {
    constructor(token) { this.token = token; this.visible = this.isVisible = true; }
    _getWaypointLabelContext() { return { distance: { total: "900" }, units: "m", elevation: { total: 0, hidden: true } }; }
    refresh() {}
    clear() {}
    destroy() {}
    _onVisibleChange() {}
}
foundry.canvas = { placeables: { tokens: { TokenRuler: BaseRuler } } };
foundry.applications.api.ApplicationV2 = class {
    async close() { this.closed = true; }
};
foundry.applications.api.HandlebarsApplicationMixin = base => base;
const { registerAreaCombat, renderAreaMovementReference } = await import("../../scripts/combat/area-combat.mjs");
const { TnxTokenRuler } = await import("../../scripts/combat/tnx-token-ruler.mjs");

const board = {
    schemaVersion: 1, enabled: true, origin: { x: 0, y: 0 }, cell: { width: 600, height: 400 },
    rows: 3, columns: 5, style: { color: "#88ccee", alpha: 0.65 },
};
let hooks, scene, token, body;
beforeEach(() => {
    hooks = {};
    globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, callAll: (name, ...args) => hooks[name]?.forEach(fn => fn(...args)) };
    globalThis.CONFIG = { Token: {} };
    globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
    globalThis.HTMLElement = Element;
    body = new Element();
    globalThis.document = { body, createElement: () => new Element() };
    globalThis.PIXI = { Graphics };
    globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
    scene = { id: "scene", getFlag: () => board, update: vi.fn(), dimensions: { rect: { x: 0, y: 0, right: 3000, bottom: 2000 } } };
    const actor = { id: "actor", isOwner: true, items: [] };
    token = {
        name: "キャスト", actor, isOwner: true, isVisible: true, renderFlags: { set: vi.fn() },
        document: { id: "token", uuid: "Scene.scene.Token.token", parent: scene, getCenterPoint: p => p ?? ({ x: 300, y: 200 }) },
    };
    token.document.object = token;
    globalThis.canvas = { ready: true, scene, stage: { addChild: vi.fn() }, grid: { units: "m" }, tokens: { controlled: [token], placeables: [token] } };
    globalThis.game = { user: { id: "user", isGM: true, targets: new Set() }, actors: new Map([[actor.id, actor]]), messages: new Map() };
    registerAreaCombat();
    Hooks.callAll("canvasTearDown");
});
const readout = () => body.children.at(-1).textContent;

describe("エリア盤面のFVTT接続", () => {
    it("移動のpassedだけを計測しpendingを消費済みにしない", () => {
        Hooks.callAll("canvasReady");
        Hooks.callAll("moveToken", token.document, {
            method: "dragging", origin: { x: 300, y: 200 },
            passed: { waypoints: [{ x: 900, y: 200 }] }, pending: { waypoints: [{ x: 2100, y: 200 }] },
        });
        expect(readout()).toContain("直近の移動：1段階");
    });
    it("対象の秘匿を尊重し、見える斜め隣は中", () => {
        Hooks.callAll("canvasReady");
        const target = { name: "相手", isVisible: false, document: { parent: scene, getCenterPoint: () => ({ x: 900, y: 600 }) } };
        game.user.targets.add(target);
        Hooks.callAll("targetToken");
        expect(readout()).not.toContain("相手");
        target.isVisible = true;
        Hooks.callAll("targetToken");
        expect(readout()).toContain("相手：中");
    });
    it("設定がないSceneでは描画もデータ更新もしない", () => {
        scene.getFlag = () => undefined;
        Hooks.callAll("canvasReady");
        expect(body.children).toHaveLength(0);
        expect(scene.update).not.toHaveBeenCalled();
    });
    it("ローカルプレビュー取消で保存済み配置へ戻る", () => {
        Hooks.callAll("canvasReady");
        Hooks.callAll("tnxAreaBoardPreview", scene.id, { ...board, origin: { x: 500, y: 500 } });
        expect(readout()).toContain("盤面外");
        Hooks.callAll("tnxAreaBoardPreview", scene.id, null);
        expect(readout()).toContain("1列・1行");
        expect(scene.update).not.toHaveBeenCalled();
    });
    it("対決移動の結果を参照し、後の妨害で0段階に追随する", () => {
        Hooks.callAll("canvasReady");
        const flags = { checkResult: { actorId: "actor" }, attackCheck: { movement: {}, state: "open", achievement: 35 } };
        const message = { id: "message", visible: true, getFlag: (_scope, key) => flags[key] };
        game.messages.set(message.id, message);
        const root = new Element();
        renderAreaMovementReference(message, root);
        root.children[0].listeners.click();
        expect(readout()).toContain("参照中の移動判定：3段階");
        flags.attackCheck.state = "failed";
        Hooks.callAll("updateChatMessage");
        expect(readout()).toContain("参照中の移動判定：0段階");
        expect(scene.update).not.toHaveBeenCalled();
    });

});

describe("標準ルーラーを維持するエリア表示", () => {
    const point = (x, y, previous = null, extra = {}) => ({ center: { x, y }, previous, stage: "planned", movementId: null, ...extra });
    it("明示経由の往復を2段階と表示し、前の移動履歴を加算しない", () => {
        const ruler = new TnxTokenRuler(token);
        const old = point(2100, 200, null, { stage: "passed", movementId: "old" });
        const start = point(300, 200, old, { stage: "passed", movementId: "old" });
        const via = point(900, 200, start);
        const end = point(300, 200, via);
        expect(ruler._getWaypointLabelContext(end, {}).distance.total).toBe("2 段階");
    });
    it("無効Scene・秘匿経路ではコア表示をそのまま返す", () => {
        const ruler = new TnxTokenRuler(token);
        const hidden = point(300, 200, null, { hidden: true });
        expect(ruler._getWaypointLabelContext(point(900, 200, hidden), {}).units).toBe("m");
        scene.getFlag = () => undefined;
        expect(ruler._getWaypointLabelContext(point(900, 200), {}).distance.total).toBe("900");
    });
    it("エリア内移動・特殊移動・盤面外を区別する", () => {
        const ruler = new TnxTokenRuler(token);
        const start = point(300, 200);
        expect(ruler._getWaypointLabelContext(point(400, 200, start), {}).distance.total).toBe("エリア内移動");
        expect(ruler._getWaypointLabelContext(point(900, 200, start, { action: "teleport" }), {}).distance.total).toBe("配置・特殊移動");
        expect(ruler._getWaypointLabelContext(point(-100, 200, start), {}).distance.total).toContain("盤面外");
    });
});
