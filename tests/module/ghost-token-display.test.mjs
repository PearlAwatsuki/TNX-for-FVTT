import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { registerAppearanceTokenSync } from "../../scripts/session/appearance-state.mjs";

describe("ゴーストの半透明表示", () => {
    let hooks;
    beforeEach(() => {
        hooks = {};
        vi.stubGlobal("Hooks", { on: (name, fn) => { hooks[name] = fn; } });
        vi.stubGlobal("game", { user: { id: "player" }, users: { activeGM: { id: "gm" } } });
        registerAppearanceTokenSync();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("プレイヤー側でも半透明にし、無関係の更新で薄さを累積させない", () => {
        const token = { actor: { system: { isGhost: true } }, mesh: { alpha: 0.8 } };
        hooks.refreshToken(token, { refreshMesh: true });
        expect(token.mesh.alpha).toBe(0.4);
        hooks.refreshToken(token, { refreshPosition: true });
        expect(token.mesh.alpha).toBe(0.4);
        // コアは状態更新時に元の不透明度を再適用する。
        token.mesh.alpha = 0.8;
        hooks.refreshToken(token, { refreshState: true });
        expect(token.mesh.alpha).toBe(0.4);
        token.actor.system.isGhost = false;
        token.mesh.alpha = 0.8;
        hooks.refreshToken(token, { refreshMesh: true });
        expect(token.mesh.alpha).toBe(0.8);
    });

    it("ゴースト切替時はプレイヤー側でも描画更新する", () => {
        const set = vi.fn();
        hooks.updateActor({ getActiveTokens: () => [{ renderFlags: { set } }] }, { system: { isGhost: false } });
        expect(set).toHaveBeenCalledWith({ refreshMesh: true });
    });

    it("盤面を開くとRLが旧ゴーストの不可視だけを解除する", async () => {
        game.user.id = "gm";
        const updateEmbeddedDocuments = vi.fn();
        await hooks.canvasReady({ scene: { tokens: [
            { id: "ghost", hidden: true, actor: { system: { isGhost: true } } },
            { id: "secret", hidden: true, actor: { system: { isGhost: false } } },
        ], updateEmbeddedDocuments } });
        expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [{ _id: "ghost", hidden: false }]);
    });
});
