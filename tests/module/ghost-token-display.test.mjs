import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { registerAppearanceTokenSync } from "../../scripts/session/appearance-state.mjs";

describe("ゴースト本人の非表示", () => {
    let hooks;
    beforeEach(() => {
        hooks = {};
        vi.stubGlobal("Hooks", { on: (name, fn) => { hooks[name] = fn; } });
        vi.stubGlobal("game", { user: { id: "player" }, users: { activeGM: { id: "gm" } }, actors: [] });
        vi.stubGlobal("canvas", { ready: false });
        registerAppearanceTokenSync();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("配置からの車両登場が失敗したら通知し、未処理のPromise拒否を残さない", async () => {
        game.user = { id: "gm", isGM: true };
        game.scenes = { active: { id: "s" } };
        const actor = { id: "a", uuid: "Actor.a", type: "cast", system: {}, getFlag: () => false,
            items: [], setFlag: vi.fn() };
        actor.items.push({ type: "vehicle", actor, system: { isPrepared: true } });
        game.actors = { contents: [actor], get: () => actor };
        vi.stubGlobal("fromUuidSync", () => actor);
        vi.stubGlobal("Actor", { TYPES: ["cast"] });
        vi.stubGlobal("ui", { notifications: { error: vi.fn() } });
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            await expect(hooks.createToken({ actorId: "a", parent: { id: "s" } })).resolves.toBeUndefined();
            expect(ui.notifications.error).toHaveBeenCalledWith(expect.stringContaining("Foundry本体（サーバー）"));
            expect(actor.setFlag).not.toHaveBeenCalled();
        } finally { log.mockRestore(); }
    });

    it("本人のコマをPLから非表示にし、不透明度の保存値は変更しない", () => {
        const token = { actor: { system: { isGhost: true } }, visible: true, mesh: { alpha: 0.8 } };
        hooks.refreshToken(token, { refreshMesh: true });
        expect(token.visible).toBe(false);
        expect(token.mesh.alpha).toBe(0.8);
        hooks.refreshToken(token, { refreshPosition: true });
        expect(token.visible).toBe(false);
        // コアは状態更新時に元の不透明度を再適用する。
        token.mesh.alpha = 0.8;
        hooks.refreshToken(token, { refreshState: true });
        expect(token.mesh.alpha).toBe(0.8);
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

    it("盤面を開き直してもゴーストは不可視で、登場記帳用のトークンは削除しない", async () => {
        game.user.id = "gm";
        game.user.isGM = true;
        const updateEmbeddedDocuments = vi.fn();
        const actor = { id: "a", type: "cast", system: { isGhost: true }, getFlag: () => true };
        game.actors = [actor];
        const deleteEmbeddedDocuments = vi.fn();
        game.scenes = { active: { tokens: [{ id: "ghost", actorId: "a", actor, hidden: false }], updateEmbeddedDocuments, deleteEmbeddedDocuments } };
        await hooks.canvasReady();
        expect(updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [expect.objectContaining({ _id: "ghost", hidden: true })]);
        expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    });
});
