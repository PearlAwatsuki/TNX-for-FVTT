import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { getCardCheckValue } from "../../scripts/rules/tnx-check-engine.mjs";
import { TnxActionHandler } from "../../scripts/cards/tnx-action-handler.mjs";
let Flow;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Flow._context = null; });

describe("post-card number and suit controls", () => {
    it("applies jamming to an upward check only", () => {
        const actor = { system: {}, items: [{ system: { isPrepared: true, majorCategory: "weapon",
            minorCategory: "melee", hack: { mode: "value", value: 2 } } }] };
        const conditions = [{ kind: "interference", active: true, magnitude: 3 }];
        expect(Flow._computeJammingSource(actor, conditions, true)).toMatchObject({ value: -1 });
        expect(Flow._computeJammingSource(actor, conditions, false)).toBeNull();
    });
    it.each([10, 11, 12, 13])("distinguishes a drawn joker declaring rank %s from a natural card", async rank => {
        const card = { id: "c", value: 99, suit: "joker" };
        vi.spyOn(TnxActionHandler, "getActiveDeck").mockResolvedValue({ availableCards: [card] });
        vi.spyOn(TnxActionHandler, "getActiveDiscardPile").mockResolvedValue({
            draw: async () => [card], updateEmbeddedDocuments: async () => {}, cards: new Map([[card.id, card]]),
        });
        vi.spyOn(Flow, "_cardValueOverride").mockReturnValue(null);
        vi.spyOn(Flow, "_promptJokerDeclaration").mockResolvedValue({ suit: "spade", numericValue: rank });
        const execute = vi.spyOn(Flow, "_execute").mockResolvedValue(true);
        Flow._context = { type: "skillCheck", validSuits: ["spade"] };
        await Flow.executeFromDeck();
        expect(execute.mock.lastCall[0]).toMatchObject({ cardCheckValue: 10, suit: "spade", fromDeck: true });
        Flow._context.validSuits = ["heart"];
        await Flow.executeFromDeck();
        expect(execute.mock.lastCall[0]).toMatchObject({ suitMismatch: true, cardCheckValue: null });
        Object.assign(card, { suit: "heart", value: rank });
        await Flow.executeFromDeck();
        expect(execute.mock.lastCall[0].cardCheckValue).toBe(rank === 10 ? 10 : "FUMBLE");
    });
    it.each(["joker", "trump"])("uses the chosen fixed 21 for a declared ace from %s", async source => {
        const card = { id: "c", suit: source === "joker" ? "joker" : "spade", value: source === "joker" ? 99 : 5 };
        vi.stubGlobal("game", { user: { flags: { "tokyo-nova-axleration": { handPileId: "hand", trumpCardPileId: "trump" } } } });
        vi.stubGlobal("fromUuid", async id => id === "hand" ? { cards: new Map([["c", card]]) } : { cards: { contents: [{ id: "t" }] } });
        vi.spyOn(Flow, "_promptJokerDeclaration").mockResolvedValue({ suit: "heart", numericValue: 1 });
        foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue("fixed21") };
        Flow._context = { type: "skillCheck", validSuits: ["heart"] };
        Flow._trumpMode = source === "trump";
        const execute = vi.spyOn(Flow, "_execute").mockResolvedValue(true);
        await Flow.executeFromHand("c");
        expect(execute.mock.lastCall[0]).toMatchObject({ cardCheckValue: "FIXED_21", suit: "heart" });
        expect(!!execute.mock.lastCall[0].trumpUsed).toBe(source === "trump");
        Flow._trumpMode = false;
    });
    it.each([[1, "spade", false], [99, "joker", true]])("checks the suit of a drawn ace before offering fixed 21 (%s)", async (value, suit, mismatch) => {
        const card = { id: "ace", value, suit };
        vi.spyOn(TnxActionHandler, "getActiveDeck").mockResolvedValue({ availableCards: [card] });
        vi.spyOn(TnxActionHandler, "getActiveDiscardPile").mockResolvedValue({
            draw: async () => [card], updateEmbeddedDocuments: async () => {}, cards: new Map([[card.id, card]]),
        });
        vi.spyOn(Flow, "_cardValueOverride").mockReturnValue(null);
        vi.spyOn(Flow, "_promptJokerDeclaration").mockResolvedValue({ suit: "heart", numericValue: 1 });
        const ace = vi.spyOn(Flow, "_handleAceChoice").mockResolvedValue(true);
        const execute = vi.spyOn(Flow, "_execute").mockResolvedValue(true);
        Flow._context = { type: "skillCheck", validSuits: ["spade"] };
        await Flow.executeFromDeck();
        expect(ace).toHaveBeenCalledTimes(mismatch ? 0 : 1);
        if (mismatch) expect(execute.mock.calls[0][0]).toMatchObject({ suitMismatch: true, fromDeck: true });
    });
    it.each(["cancel", "play"])("resolves a mismatched hand before spending cards or applying effects: %s", async decision => {
        const update = vi.fn();
        const actor = { id: "a", uuid: "Actor.a", system: { bountyBase: 1 }, items: new Map(), effects: [], getFlag: () => null, update };
        vi.stubGlobal("game", { actors: new Map([["a", actor]]), tnx: {} });
        vi.spyOn(Flow, "_closeDialog").mockImplementation(() => {});
        const hand = vi.spyOn(TnxActionHandler, "playCard").mockResolvedValue();
        const trump = vi.spyOn(TnxActionHandler, "useTrump").mockResolvedValue();
        vi.spyOn(TnxActionHandler, "autoReplenishHand").mockResolvedValue();
        const bonus = vi.spyOn(Flow, "_computeCheckBonus");
        const post = vi.spyOn(Flow, "_postResultChat").mockResolvedValue({});
        foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue(decision) };
        const ctx = Flow._context = { actorId: "a", type: "skillCheck", validSuits: ["club"], targetValue: 0,
            consumeUses: [{ actorId: "a", kind: "bounty", amount: 1 }], manualMod: 50 };
        await Flow._execute({ ctx, card: { id: "c" }, cardCheckValue: null, suit: "heart",
            trumpUsed: true, trumpCardId: "t", suitMismatch: true });
        expect(Flow.context).toBeNull();
        expect(bonus).not.toHaveBeenCalled();
        const count = decision === "play" ? 1 : 0;
        for (const action of [hand, trump, update, post]) expect(action).toHaveBeenCalledTimes(count);
        if (count) expect(post.mock.calls[0][0].result).toMatchObject({ achievement: 0, success: false, diff: null, suitMismatch: true });
    });
    it.each([false, true])("passes selected rank/suit and modifier from hand (joker=%s)", async joker => {
        const card = { id: "c", value: joker ? 99 : 4, suit: joker ? "joker" : "spade" };
        vi.stubGlobal("game", { user: { flags: { "tokyo-nova-axleration": { handPileId: "hand" } } } });
        vi.stubGlobal("fromUuid", vi.fn().mockResolvedValue({ cards: new Map([["c", card]]) }));
        vi.spyOn(Flow, "_cardValueOverride").mockReturnValue(null);
        vi.spyOn(Flow, "_promptJokerDeclaration").mockResolvedValue({ suit: "spade", numericValue: 4 });
        const change = vi.spyOn(Flow, "_resolveCardChange").mockResolvedValue({ suit: "heart", numericValue: 13, modifier: 2 });
        const execute = vi.spyOn(Flow, "_execute").mockResolvedValue(true);
        Flow._trumpMode = false;
        Flow._context = { validSuits: ["heart"], allowSuitChange: true, allowNumberChange: true };
        await Flow.executeFromHand("c");
        expect(change).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0][0]).toMatchObject({ cardCheckValue: 10, suit: "heart", suitChangedFrom: "spade",
            cardOverride: { from: 4, to: 13, modifier: 2 } });
        expect(card.value).toBe(joker ? 99 : 4);
    });
    it("changes a drawn face card before fumble evaluation", async () => {
        const card = { id: "c", value: 13, suit: "spade" };
        vi.spyOn(TnxActionHandler, "getActiveDeck").mockResolvedValue({ availableCards: [card] });
        vi.spyOn(TnxActionHandler, "getActiveDiscardPile").mockResolvedValue({
            draw: async () => [card], updateEmbeddedDocuments: async () => {}, cards: new Map([["c", card]]),
        });
        vi.spyOn(Flow, "_cardValueOverride").mockReturnValue(null);
        const change = vi.spyOn(Flow, "_resolveCardChange").mockResolvedValue({ suit: "heart", numericValue: 2, modifier: 3 });
        const execute = vi.spyOn(Flow, "_execute").mockResolvedValue(true);
        Flow._context = { validSuits: ["heart"], allowSuitChange: true, allowNumberChange: true };
        await Flow.executeFromDeck();
        expect(change).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0][0]).toMatchObject({ fromDeck: true, cardCheckValue: 2, suit: "heart",
            cardOverride: { from: 13, to: 2, modifier: 3 } });
    });
    it.each([false, true])("shows one dialog with suit enabled=%s and working rank/spinner controls", async allowSuitChange => {
        const wait = vi.fn(async options => {
            const dom = new JSDOM(options.content);
            const element = dom.window.document.body;
            expect(element.querySelector('[name="suit"]') !== null).toBe(allowSuitChange);
            expect(element.querySelectorAll('[name="numericValue"] option')).toHaveLength(13);
            expect(element.querySelector('[name="numericValue"]').value).toBe("12");
            options.render(null, { element });
            element.querySelector('[name="numericValue"]').value = "13";
            element.querySelector('[data-number-step="1"]').click();
            element.querySelector('[data-number-step="1"]').click();
            element.querySelector('[data-number-step="-1"]').click();
            if (allowSuitChange) element.querySelector('[name="suit"]').value = "heart";
            const result = options.buttons[0].callback(null, null, { element });
            dom.window.close();
            return result;
        });
        foundry.applications.api.DialogV2 = { wait };
        expect(await Flow._resolveCardChange("spade", 12, { allowNumberChange: true, allowSuitChange }))
            .toEqual({ suit: allowSuitChange ? "heart" : "spade", numericValue: 13, modifier: 1 });
        expect(wait).toHaveBeenCalledOnce();
    });
    it.each([false, null, { numericValue: 99, modifier: 2 }, { numericValue: 4, modifier: NaN }])("keeps original values on cancellation/invalid input", async result => {
        foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue(result) };
        expect(await Flow._resolveCardChange("club", 5, { allowNumberChange: true }))
            .toEqual({ suit: "club", numericValue: 5, modifier: 0 });
    });
    it("does not prompt when both controls are off", async () => {
        const wait = vi.fn();
        foundry.applications.api.DialogV2 = { wait };
        expect(await Flow._resolveCardChange("heart", 4, {})).toEqual({ suit: "heart", numericValue: 4, modifier: 0 });
        expect(wait).not.toHaveBeenCalled();
    });
    it("retains checkboxes, not the last chosen rank/modifier, for a reroll", () => {
        Flow._context = { type: "skillCheck", suitChangePermitted: true };
        Flow.setAllowNumberChange(true);
        Flow.setAllowSuitChange(true);
        const rc = Flow._buildRecheckContext(Flow._context);
        expect(rc.allowNumberChange).toBe(true);
        expect(rc.allowSuitChange).toBe(true);
        expect(rc.cardOverride).toBeUndefined();
        Flow.setAllowNumberChange(false);
        expect(Flow._context.allowNumberChange).toBe(false);
    });
    it.each([
        [13, false, false, 2, 12, false],
        [1, false, false, -2, 9, false],
        [1, false, true, 2, "A(21固定)", false],
        [13, true, false, -3, undefined, true],
        [2, false, false, 11, 13, false],
    ])("applies numeric adjustment once after rank conversion (%s)", async (rank, deck, fixedAt21, modifier, expected, fumble) => {
        const actor = { id: "a", uuid: "Actor.a", name: "Actor", system: {}, items: new Map(), effects: [], getFlag: () => null };
        vi.stubGlobal("game", { actors: new Map([["a", actor]]), tnx: {} });
        vi.spyOn(Flow, "_gatherConditions").mockReturnValue([]);
        vi.spyOn(Flow, "_closeDialog").mockImplementation(() => {});
        vi.spyOn(Flow, "_buildAbilitiesCtx").mockReturnValue({ reason: { totalValue: 5, totalControl: 8 } });
        vi.spyOn(Flow, "_computeCheckBonus").mockReturnValue({ total: 0, sources: [] });
        vi.spyOn(Flow, "_promptBountyUsage").mockResolvedValue(0);
        const stop = new Error("stop after calculation");
        const post = vi.spyOn(Flow, "_postResultChat").mockRejectedValue(stop);
        await expect(Flow._execute({ card: { id: "c" }, suit: "spade", fromDeck: true,
            cardCheckValue: getCardCheckValue({ numericValue: rank, isFromDeck: deck, fixedAt21 }),
            cardOverride: { from: 5, to: rank, modifier }, ctx: { actorId: "a", type: "skillCheck" },
        })).rejects.toThrow(stop);
        const result = post.mock.calls[0][0].result;
        expect(result.cardValue).toBe(expected);
        expect(result.fumble).toBe(fumble);
        if (fixedAt21) expect(result.achievement).toBe(21);
        else if (!fumble) expect(result.achievement).toBe(expected + 5);
    });
});
