import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { buildCombatSeedUpdate } from "../../scripts/rules/combat-seed.mjs";
import { TnxActionHandler } from "../../scripts/cards/tnx-action-handler.mjs";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";
import { applyDamageChartResult, executeConditionDraw, renderConditionDrawCard } from "../../scripts/flow/condition-resolution.mjs";

const hooks = new Map();
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    const { registerItemTransferHooks } = await import("../../scripts/core/item-transfer.mjs");
    vi.stubGlobal("Hooks", { on(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); } });
    registerItemTransferHooks();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function damagedActor(current, inCombat = true) {
    vi.stubGlobal("game", { user: { id: "u" }, combats: [],
        combat: { started: inCombat, getCombatantsByActor: () => [{}] } });
    const notify = async (name, effect) => {
        for (const fn of hooks.get(name) ?? []) await fn(effect, {}, "u");
    };
    const actor = { id: "a", uuid: "Actor.a", documentName: "Actor", effects: [], items: [], flags: {},
        system: { actionRank: { value: current, maxTotal: 4 } },
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
        async update(patch) {
            for (const [path, value] of Object.entries(patch)) {
                const parts = path.split(".");
                let obj = this;
                for (const key of parts.slice(0, -1)) obj = obj[key] ??= {};
                obj[parts.at(-1)] = value;
            }
        },
        async createEmbeddedDocuments(_type, [data]) {
            const effect = { ...data, id: "w" + this.effects.length, parent: this };
            this.effects.push(effect);
            await notify("createActiveEffect", effect);
            return [effect];
        },
    };
    return { actor, notify };
}

it.each([[12, 3, 2], [12, 0, 0], [17, 3, 0]])("精神%s の付与・フック再送・治療 (AR %s)", async (rank, current, expected) => {
    const { actor, notify } = damagedActor(current);
    const effect = await applyDamageChartResult(actor, "mental", rank);
    expect(actor.system.actionRank).toEqual({ value: expected, maxTotal: 4 });
    await notify("createActiveEffect", effect);
    actor.effects = [];
    await notify("deleteActiveEffect", effect);
    expect(actor.system.actionRank).toEqual({ value: expected, maxTotal: 4 });
    await actor.update(buildCombatSeedUpdate(actor.system));
    expect(actor.system.actionRank.value).toBe(4);
});
it("同じダメージ行の再適用と、別の攻撃による驚愕を区別する", async () => {
    const { actor } = damagedActor(4);
    for (const damageApplication of ["m1:0", "m1:0", "m2:0"]) {
        await applyDamageChartResult(actor, "mental", 12, { extraFlags: { damageApplication } });
    }
    expect(actor.system.actionRank.value).toBe(2);
    expect(actor.effects).toHaveLength(2);
});
it("カット外の負傷は次のカットに繰り越さない", async () => {
    const { actor, notify } = damagedActor(3, false);
    const effect = await applyDamageChartResult(actor, "mental", 12);
    game.combat.started = true;
    await notify("createActiveEffect", effect);
    expect(actor.system.actionRank.value).toBe(3);
});
it("効果無視中の負傷は現在ARを消費しない", async () => {
    const { actor } = damagedActor(3);
    await applyDamageChartResult(actor, "mental", 17, { extraFlags: { manuallyIgnored: true } });
    expect(actor.system.actionRank.value).toBe(3);
});

it("ARを持たないアクターの手動付与でも作成フックを完了する", async () => {
    const { actor } = damagedActor(3);
    delete actor.system.actionRank;
    await expect(applyDamageChartResult(actor, "mental", 12)).resolves.toBeTruthy();
    expect(actor.system.actionRank).toBeUndefined();
});

it.each(["missing deck", "missing discard", "empty", "rejected", "no card", "unknown suit", "bad rank", "reveal failed", "joker", "ordinary"])(
    "状態ドロー %s", async scenario => {
        const card = { id: "draw", suit: "spades", value: 8 };
        if (scenario === "unknown suit") card.suit = "unknown";
        if (scenario === "bad rank") card.value = null;
        if (scenario === "joker") Object.assign(card, { suit: "joker", value: 99 });
        const deck = { availableCards: scenario === "empty" ? [] : [card] };
        const discard = { cards: new Map([[card.id, card]]), draw: vi.fn(async () => {
            if (scenario === "rejected") throw Error("draw failed");
            return scenario === "no card" ? [] : [card];
        }), updateEmbeddedDocuments: async () => { if (scenario === "reveal failed") throw Error("reveal failed"); } };
        vi.spyOn(TnxActionHandler, "getActiveDeck").mockResolvedValue(scenario === "missing deck" ? null : deck);
        vi.spyOn(TnxActionHandler, "getActiveDiscardPile").mockResolvedValue(scenario === "missing discard" ? null : discard);
        const wild = vi.spyOn(foundry.applications.api.DialogV2, "wait").mockResolvedValue({ suit: "club", value: 2 });
        const warn = vi.spyOn(ui.notifications, "warn");
        const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
        const effect = { setFlag: vi.fn() };
        await executeConditionDraw({}, effect, "weakness", {});
        const valid = ["ordinary", "joker"].includes(scenario);
        expect(wild).toHaveBeenCalledTimes(Number(scenario === "joker"));
        expect(patch).toHaveBeenCalledTimes(Number(valid));
        expect(effect.setFlag).toHaveBeenCalledTimes(Number(valid));
        if (valid) expect(effect.setFlag.mock.calls[0][0]).toBe(SYSTEM_ID);
        else expect(warn).toHaveBeenCalled();
    });

it.each(["joker", "bad"])("邪毒の受付から実カードを解決する (%s)", async scenario => {
    const card = { id: "c", suit: scenario, value: scenario === "joker" ? 99 : 6 };
    const actor = { isOwner: true, effects: new Map([["w", {}]]), createEmbeddedDocuments: vi.fn().mockResolvedValue([{}]) };
    vi.stubGlobal("fromUuid", async () => actor);
    const button = { addEventListener(_name, fn) { this.click = fn; } };
    vi.stubGlobal("document", { createElement: () => button });
    vi.spyOn(TnxActionHandler, "getActiveDeck").mockResolvedValue({ availableCards: [card] });
    vi.spyOn(TnxActionHandler, "getActiveDiscardPile").mockResolvedValue({ cards: new Map([["c", card]]),
        draw: async () => [card], updateEmbeddedDocuments: async () => {} });
    const dialog = vi.spyOn(foundry.applications.api.DialogV2, "wait").mockImplementation(async opts => {
        const element = { querySelector: sel => sel === '[name="value"]' ? { value: "5" } : null };
        return opts.buttons[0].callback(null, null, { element });
    });
    const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
    renderConditionDrawCard({ getFlag: () => ({ kind: "poison", effectId: "w", magnitude: 2 }) },
        { querySelector: () => ({ replaceChildren() {}, appendChild() {} }) });
    await button.click();
    if (scenario === "joker") {
        expect(actor.createEmbeddedDocuments.mock.calls[0][1][0].statuses).toEqual(["phys-7"]);
        expect(patch.mock.calls[0][1]).toMatchObject({ resolved: true, wild: true, value: 5 });
    } else {
        expect(dialog).not.toHaveBeenCalled();
        expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
        expect(patch).not.toHaveBeenCalled();
    }
});

it.each(["complete", "empty", "cancel", "bad rank", "rejected"])("複数枚のダメージドローは全数の確定を要する (%s)", async scenario => {
    const { drawDamageValueFromDeck } = await import("../../scripts/flow/damage-flow.mjs");
    const flip = vi.spyOn(TnxActionHandler, "flipFromDeck").mockResolvedValueOnce({ name: "Q", suit: "clubs", value: 12 });
    if (scenario === "rejected") flip.mockRejectedValueOnce(new Error("draw failed"));
    else flip.mockResolvedValueOnce(scenario === "empty" ? null : scenario === "cancel" ? { suit: "joker", value: 99 }
        : { name: "A", suit: "hearts", value: scenario === "complete" ? 1 : null });
    vi.spyOn(foundry.applications.api.DialogV2, "wait").mockResolvedValue(false);
    const result = await drawDamageValueFromDeck(2);
    if (scenario === "complete") expect(result).toEqual({ total: 21, drawn: ["Q=10", "A=11"] });
    else expect(result).toBeNull();
});
