import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
    state: { actStarted: true, phase: "ending" },
    appearing: false, setAppearing: vi.fn(), setGhost: vi.fn(), appearance: vi.fn(),
}));
vi.mock("../../scripts/session/session-state.mjs", () => ({
    getSessionState: () => mock.state, getCurrentSceneAppearance: mock.appearance,
}));
vi.mock("../../scripts/session/appearance-state.mjs", () => ({
    isAppearing: () => mock.appearing, setAppearing: mock.setAppearing, setGhost: mock.setGhost,
}));
let startFreeAppearance, startAppearanceCheck;
const originalFoundry = globalThis.foundry, originalGame = globalThis.game;
const actor = { id: "my-cast" };
beforeAll(async () => {
    globalThis.foundry = { applications: { api: { DialogV2: {} } } };
    ({ startFreeAppearance, startAppearanceCheck } = await import("../../scripts/flow/appearance-check.mjs"));
});
afterAll(() => { globalThis.foundry = originalFoundry; globalThis.game = originalGame; });
beforeEach(() => {
    mock.state = { actStarted: true, phase: "ending" }; mock.appearing = false;
    globalThis.game = { user: { character: actor } }; vi.clearAllMocks();
});
describe("エンディングの自由登場", () => {
    it("判定を経ず、自分の担当キャラクターを通常登場させる", async () => {
        await startFreeAppearance();
        expect(mock.setGhost).toHaveBeenCalledWith(actor, false);
        expect(mock.setAppearing).toHaveBeenCalledWith(actor, true);
        expect(mock.appearance).not.toHaveBeenCalled();
    });
    it("既に登場中なら繰り返し適用しない", async () => {
        mock.appearing = true; await startFreeAppearance();
        expect(mock.setAppearing).not.toHaveBeenCalled();
    });
    it("エンディング以外では自由登場できない", async () => {
        mock.state.phase = "climax"; await startFreeAppearance();
        expect(mock.setAppearing).not.toHaveBeenCalled();
    });
    it("アクト未開始・担当なしでは何も変更しない", async () => {
        mock.state.actStarted = false; await startFreeAppearance();
        mock.state.actStarted = true; game.user.character = null; await startFreeAppearance();
        expect(mock.setAppearing).not.toHaveBeenCalled();
    });
    it("古いボタンから登場判定を呼んでもエンディングでは判定を起動しない", async () => {
        await startAppearanceCheck(); expect(mock.appearance).not.toHaveBeenCalled();
        expect(mock.setAppearing).not.toHaveBeenCalled();
    });
});
