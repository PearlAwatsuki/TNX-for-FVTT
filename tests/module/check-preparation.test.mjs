// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCheckContext } from "../../scripts/flow/check-preparation.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(result) {
    const wait = vi.fn(async options => typeof result === "function" ? result(options) : result);
    vi.stubGlobal("foundry", { utils: { ...foundry.utils, deepClone: structuredClone }, applications: { api: { DialogV2: { wait } } } });
    vi.stubGlobal("game", { system: { id: "tnx" }, messages: new Map([["attack", { getFlag: () => ({
        isAttack: true, targets: [{ uuid: "self", name: "自分" }, { uuid: "other", name: "他者" }],
    }) }]]) });
    return wait;
}
const context = () => ({ type: "skillCheck", reaction: { attackMessageId: "attack", targetIndex: 0, open: false } });

describe("separate pre-check dialogs", () => {
    it("does not prompt for an ordinary check", async () => {
        const wait = setup(false);
        expect(await prepareCheckContext({ type: "skillCheck" })).toEqual({ type: "skillCheck" });
        expect(wait).not.toHaveBeenCalled();
    });
    it("records reaction choices without changing the original or saved reroll settings", async () => {
        const wait = setup(options => {
            expect(options.content).not.toContain('value="self"');
            expect(options.content).toContain('value="other"');
            const element = document.createElement("div");
            element.innerHTML = options.content;
            element.querySelector('[name="failsAttack"]').checked = true;
            element.querySelector('[name="protect"]').checked = true;
            return options.buttons[0].callback(null, null, { element });
        });
        const original = context();
        const result = await prepareCheckContext(original);
        expect(result.reaction).toMatchObject({ failsAttack: true, protectedTargetUuids: ["other"] });
        expect(original.reaction.failsAttack).toBeUndefined();
        await prepareCheckContext(result);
        expect(wait.mock.calls[1][0].content).toContain('name="failsAttack" checked');
    });
    it.each([false, null, "cancel"])("stops before card selection on cancel: %s", async result => {
        setup(result);
        expect(await prepareCheckContext(context())).toBeNull();
    });
    it("sets a treatment target before the common check", async () => {
        setup(options => {
            const element = document.createElement("div");
            element.innerHTML = options.content;
            element.querySelector("input").value = "14";
            return options.buttons[0].callback(null, null, { element });
        });
        expect(await prepareCheckContext({ editableTargetValue: true, targetValue: 10 })).toMatchObject({ targetValue: 14 });
    });
    it("does not show attack effects for open opposed checks", async () => {
        const wait = setup(false);
        const input = context();
        input.reaction.open = true;
        expect(await prepareCheckContext(input)).toEqual(input);
        expect(wait).not.toHaveBeenCalled();
    });
});
