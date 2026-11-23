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
    vi.stubGlobal("game", { user: { isGM: false }, actors: new Map([["a", { isOwner: true, items: new Map() }]]) });
    const flags = { checkRecheck: { actorId: "a", type: "skillCheck", skillIds: [], validSuits: ["spade"],
        allowRecheck: true, targetValue: 10, requestMessageId: "request" },
        checkResult: { result: { achievement, success: achievement >= 10, targetValue: 10 } }, ...extra };
    const message = { id: "m", getFlag: (_scope, key) => flags[key],
        content: `<div class="tnx-card"><div class="tnx-card__field"><span class="tnx-card__field-label">達成値</span><span class="tnx-card__field-value--total">${achievement}</span></div><div class="tnx-card__result tnx-card__result--failure">失敗</div></div>` };
    const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
    const emit = vi.spyOn(TnxSocketHandler, "emitCheckResult").mockImplementation(() => {});
    vi.spyOn(Flow, "_rerunContinuation").mockResolvedValue();
    return { dom, message, patch, emit };
}
describe("manual result correction", () => {
    it("writes rechecked damage contributions to the attack used for damage resolution", async () => {
        const { dom, message, patch } = fixture(8, { attackCheck: { state: "open", targets: [],
            damageType: "I", damageBonuses: [{ formula: "1" }] } });
        game.messages = new Map([[message.id, message]]);
        const previous = foundry.applications.handlebars;
        foundry.applications.handlebars = { renderTemplate: vi.fn().mockResolvedValue("attack") };
        try {
            const rows = [{ formula: "5", source: "skill" }];
            await Flow._applyRecheckReplacement({ ctx: { recheckMessageId: message.id, actorId: "a",
                attack: { isAttack: true, category: "physical", damageType: "X", damageBonuses: rows, damageTypeOptions: ["X"] } },
                suit: "spade", result: { achievement: 12, fumble: false }, cardCheckValue: 5 });
            const updated = patch.mock.calls[0][1];
            expect(updated["flags.tokyo-nova-axleration.attackCheck.damageBonuses"]).toEqual(rows);
            expect(updated["flags.tokyo-nova-axleration.attackCheck.damageType"]).toBe("X");
            expect(updated["flags.tokyo-nova-axleration.attackCheck.achievement"]).toBe(12);
        } finally { foundry.applications.handlebars = previous; dom.window.close(); }
    });
    it.each(["flag", "legacy"])("keeps a mismatch immutable but allows a fresh card (%s)", async format => {
        const { dom, message, patch, emit } = fixture(0, { checkResult: { result: {
            achievement: 0, success: false, ...(format === "flag" ? { suitMismatch: true } : {}),
        } } });
        if (format === "legacy") message.content += '<span class="cr-badge cr-badge--mismatch">スート不一致</span>';
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        const prompt = vi.spyOn(AmountInputDialog, "prompt");
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        expect(Flow.recheckBlockReason(message)).toBeNull();
        await Flow.startRecheck(message);
        expect(open.mock.calls[0][0]).toMatchObject({ isRecheck: true, recheckMessageId: message.id, consumeUses: [] });
        await Flow.manualEditAchievement(message);
        await Flow._applyCheckModify(message, { manual: { mod: 12, overrideTo: 12 } });
        await Flow._applyCheckModify(message, { consumeUses: [{ itemId: "limited" }] });
        expect(prompt).not.toHaveBeenCalled();
        expect(patch).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
        dom.window.close();
    });
    it.each(["mismatch", "fumble"])("replaces a failed attack and reopens its first defense (%s)", async cause => {
        const { dom, message, patch } = fixture(0, {
            attackCheck: { state: cause === "mismatch" ? "miss" : "fumble",
                targets: [{ uuid: "defender", state: "miss", resolution: null, controlValue: 4 }] },
            checkResult: { result: { achievement: 0, suitMismatch: cause === "mismatch", fumble: cause === "fumble" } },
        });
        vi.stubGlobal("fromUuid", vi.fn().mockResolvedValue({ system: { life: { totalControl: 7 } } }));
        game.messages = new Map([[message.id, message]]);
        const previous = foundry.applications.handlebars;
        foundry.applications.handlebars = { renderTemplate: vi.fn().mockResolvedValue("new attack") };
        try {
            const result = { achievement: 12, suitMismatch: false, fumble: false };
            await Flow._applyRecheckReplacement({ ctx: { recheckMessageId: "m", actorId: "a",
                attack: { isAttack: true, confrontation: [{ value: "dodge" }] } },
                suit: "heart", result, cardCheckValue: 8 });
            const data = patch.mock.calls[0][1];
            const prefix = "flags.tokyo-nova-axleration.";
            expect(data[prefix + "checkRecheck.rechecked"]).toBe(true);
            expect(data[prefix + "checkResult"].result).toEqual(result);
            expect(data[prefix + "attackCheck.state"]).toBe("active");
            expect(data[prefix + "attackCheck.targets"][0]).toMatchObject({ state: "pending", controlValue: 7, diff: null });
            expect(data.content).toBe("new attack");
        } finally { foundry.applications.handlebars = previous; dom.window.close(); }
    });
    it.each([{ rechecked: true }, { damageRolled: true }])("preserves timing and once-only restrictions %j", flags => {
        const { dom, message } = fixture(0, { checkRecheck: flags, attackCheck: flags,
            checkResult: { result: { suitMismatch: true } } });
        expect(Flow.recheckBlockReason(message)).toMatch(/再判定済み|ダメージ算出後/);
        dom.window.close();
    });
    it("resolves an unopposed attack against the new suit's control on recovery", async () => {
        const { rebuildRecheckedTargets } = await import("../../scripts/flow/attack-flow.mjs");
        vi.stubGlobal("fromUuid", vi.fn().mockResolvedValue({ system: { life: { totalControl: 7 } } }));
        const targets = await rebuildRecheckedTargets([{ uuid: "defender", state: "miss", resolution: null, controlValue: 4 }],
            { achievement: 12, suit: "heart", controlOnly: true, isAttack: true });
        expect(targets[0]).toMatchObject({ state: "hit", resolution: "none", controlValue: 7, diff: 5 });
    });
    it.each(["reaction", "covering"])("checks the parent attack's damage timing for %s", async key => {
        const { dom, message, patch } = fixture(0, { checkRecheck: { actorId: "a", [key]: { attackMessageId: "attack" } } });
        game.messages = new Map([["attack", { getFlag: () => ({ damageRolled: true }) }]]);
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        expect(Flow.recheckBlockReason(message)).toContain("ダメージ算出後");
        await Flow._applyCheckModify(message);
        expect(patch).not.toHaveBeenCalled();
        dom.window.close();
    });
    it.each([true, false])("replaces the result and rendered card with the new suit outcome (mismatch=%s)", async mismatch => {
        const { dom, message, patch } = fixture(0, { checkResult: { result: { suitMismatch: true, success: false, achievement: 0 } } });
        game.messages = new Map([["m", message]]);
        const renderResult = vi.spyOn(Flow, "_renderResultContent").mockResolvedValue("new result");
        const result = { achievement: mismatch ? 0 : 15, success: !mismatch, diff: mismatch ? null : 5, suitMismatch: mismatch };
        await Flow._applyRecheckReplacement({ ctx: { recheckMessageId: "m", actorId: "a", targetValue: 10 },
            card: { id: "new" }, suit: mismatch ? "heart" : "spade", result, suitMismatch: mismatch });
        const data = patch.mock.lastCall[1];
        expect(renderResult.mock.lastCall[0]).toMatchObject({ isRecheck: true, result, suitMismatch: mismatch });
        expect(data["flags.tokyo-nova-axleration.checkResult"].result).toEqual(result);
        expect(data["flags.tokyo-nova-axleration.checkRecheck.rechecked"]).toBe(true);
        expect(data.content).toBe("new result");
        dom.window.close();
    });
    it("requires an ability for an owner's recheck and accepts a declaration grant", async () => {
        const { dom, message } = fixture(0);
        message.getFlag("", "checkRecheck").allowRecheck = false;
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        await Flow.startRecheck(message);
        expect(open).not.toHaveBeenCalled();
        await Flow.startRecheck(message, { granted: true });
        expect(open).toHaveBeenCalledOnce();
        dom.window.close();
    });
    it("uses the played card name as the grant target when a fumble has no achievement", async () => {
        const { dom, message } = fixture(0, { checkResult: { result: { fumble: true } } });
        document.body.innerHTML = '<div class="tnx-card"><span class="cr-card-name">♠K</span></div>';
        render(message, document.body);
        render(message, document.body);
        const clicked = vi.spyOn(Flow, "_onGrantAchievementClick").mockResolvedValue();
        const name = document.querySelector(".cr-card-name");
        name.click();
        expect(clicked).not.toHaveBeenCalled();
        vi.spyOn(Flow, "peekAchievementAction").mockReturnValue({ kind: "recheck" });
        name.click();
        expect(clicked).toHaveBeenCalledOnce();
        expect(clicked).toHaveBeenCalledWith(message);
        dom.window.close();
    });
    it("allows only the GM final ruling to modify fixed 21", async () => {
        const { dom, message, patch } = fixture(21, { checkResult: { result: { fixedAt21: true, achievement: 21 } } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        const manual = { mod: 1, label: "裁定" };
        await Flow._applyCheckModify(message, { manual });
        game.user.isGM = true;
        await Flow._applyCheckModify(message);
        expect(patch).not.toHaveBeenCalled();
        await Flow._applyCheckModify(message, { manual });
        expect(patch.mock.calls[0][1]["flags.tokyo-nova-axleration.checkResult.result.achievement"]).toBe(22);
        dom.window.close();
    });
    it("keeps an established zero editable", async () => {
        const { dom, message, patch } = fixture(0);
        expect(Flow.recheckBlockReason(message)).toBeNull();
        await Flow._applyCheckModify(message, { manual: { mod: 12, label: "manual" } });
        expect(patch.mock.calls[0][1]["flags.tokyo-nova-axleration.checkResult.result.success"]).toBe(true);
        dom.window.close();
    });
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
