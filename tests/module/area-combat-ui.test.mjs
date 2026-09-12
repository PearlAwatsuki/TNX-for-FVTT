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
const { registerAreaCombat } = await import("../../scripts/combat/area-combat.mjs");
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
describe("独立した情報表示の撤去", () => {
    it("盤面を開いて選択・移動してもHTMLの情報欄を作らない", () => {
        Hooks.callAll("canvasReady");
        Hooks.callAll("controlToken", token, true);
        Hooks.callAll("hoverToken", token, true);
        Hooks.callAll("moveToken", token.document, {});
        canvas.tokens.controlled = [];
        Hooks.callAll("controlToken", token, false);
        expect(body.children).toHaveLength(0);
        expect(hooks.updateChatMessage).toBeUndefined();
        expect(hooks.moveToken).toBeUndefined();
        expect(canvas.stage.addChild).toHaveBeenCalled();
    });
    it("プレビューと破棄でも独立表示を作らない", () => {
        Hooks.callAll("canvasReady");
        Hooks.callAll("tnxAreaBoardPreview", scene.id, board);
        Hooks.callAll("tnxAreaBoardPreview", scene.id, null);
        Hooks.callAll("canvasTearDown");
        expect(body.children).toHaveLength(0);
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
