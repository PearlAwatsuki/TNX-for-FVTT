import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";
import { AmountInputDialog } from "../../scripts/ui/tnx-dialog.mjs";
let Flow, render;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    ({ TnxCheckFlow: Flow, renderRecheckButton: render } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(achievement = 8, extra = {}) {
    const dom = new JSDOM();
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("game", { user: { isGM: false }, actors: new Map([["a", { isOwner: true }]]) });
    const flags = { checkRecheck: { actorId: "a", type: "skillCheck", targetValue: 10, requestMessageId: "request" },
        checkResult: { result: { achievement, success: achievement >= 10, targetValue: 10 } }, ...extra };
    const message = { id: "m", getFlag: (_scope, key) => flags[key],
        content: `<div class="tnx-card"><div class="tnx-card__field"><span class="tnx-card__field-label">達成値</span><span class="tnx-card__field-value--total">${achievement}</span></div><div class="tnx-card__result tnx-card__result--failure">失敗</div></div>` };
    const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
    const emit = vi.spyOn(TnxSocketHandler, "emitCheckResult").mockImplementation(() => {});
    vi.spyOn(Flow, "_rerunContinuation").mockResolvedValue();
    return { dom, message, patch, emit };
}
describe("manual result correction", () => {
    it.each([[8, 4, true, 2], [12, -5, false, null]])("updates %s by %s in flags, content and request", async (old, mod, success, diff) => {
        const { dom, message, patch, emit } = fixture(old);
        await Flow._applyCheckModify(message, { manual: { mod, label: "manual" } });
        const data = patch.mock.calls[0][1];
        expect(data["flags.tokyo-nova-axleration.checkResult.result.success"]).toBe(success);
        expect(data["flags.tokyo-nova-axleration.checkResult.result.diff"]).toBe(diff);
        const host = document.createElement("div"); host.innerHTML = data.content;
        expect(host.querySelector(".tnx-card__field-value--total").textContent).toBe(String(old + mod));
        expect(host.querySelector(success ? ".tnx-card__result--success" : ".tnx-card__result--failure")).not.toBeNull();
        expect(host.querySelector(success ? ".tnx-card__result--failure" : ".tnx-card__result--success")).toBeNull();
        expect(emit.mock.calls[0][2].success).toBe(success);
        dom.window.close();
    });
    it("recomputes all resolved attack targets against their stored defense", async () => {
        const { dom, message, patch } = fixture(8, { attackCheck: { achievement: 8, suit: "spade", state: "active",
            targets: [
                { uuid: "one", state: "miss", resolution: "none", controlValue: 10 },
                { uuid: "two", state: "miss", resolution: "none", controlValue: 15 },
            ] } });
        await Flow._applyCheckModify(message, { manual: { mod: 4, label: "manual" } });
        expect(patch.mock.calls[0][1]["flags.tokyo-nova-axleration.attackCheck.targets"].map(t => t.state))
            .toEqual(["hit", "miss"]);
        dom.window.close();
    });
    it("permits owners and RL through the menu, with no card buttons", () => {
        const { dom, message } = fixture();
        document.body.innerHTML = message.content;
        render(message, document.body);
        expect(document.querySelector("button")).toBeNull();
        expect(Flow.canManageCheckResult(message)).toBe(true);
        game.actors.get("a").isOwner = false;
        expect(Flow.canManageCheckResult(message)).toBe(false);
        game.user.isGM = true;
        expect(Flow.canManageCheckResult(message)).toBe(true);
        expect(Flow.canManageCheckResult(null)).toBe(false);
        dom.window.close();
    });
    it("rejects manual edits from a non-owner before prompting", async () => {
        const { dom, message } = fixture();
        game.actors.get("a").isOwner = false;
        const prompt = vi.spyOn(AmountInputDialog, "prompt");
        await Flow.manualEditAchievement(message);
        expect(prompt).not.toHaveBeenCalled();
        dom.window.close();
    });
});
