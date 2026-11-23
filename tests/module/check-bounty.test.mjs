import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let Flow;
beforeAll(async () => {
    foundry.utils.deepClone = structuredClone;
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
    const skill = { id: "combo", type: "generalSkill", system: { usesBounty: true } };
    const actor = { id: "a", uuid: "Actor.a", isOwner: true, getFlag: () => null,
        system: { bountyBase: 5, bounty: -1 }, items: new Map([[skill.id, skill]]), effects: [] };
    actor.update = vi.fn(async patch => { actor.system.bounty = patch["system.bounty"]; });
    vi.stubGlobal("game", { actors: new Map([["a", actor]]), tnx: {}, user: {} });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    vi.spyOn(Flow, "_closeDialog").mockImplementation(() => {});
    vi.spyOn(Flow, "_buildAbilitiesCtx").mockReturnValue({ reason: { totalValue: 5, totalControl: 10 } });
    vi.spyOn(Flow, "_computeCheckBonus").mockImplementation(() => ({ total: 2, sources: [{ name: "AE", value: 2 }] }));
    const prompt = vi.spyOn(Flow, "_promptBountyUsage").mockImplementation(async available => Math.min(3, available));
    const post = vi.spyOn(Flow, "_postResultChat").mockResolvedValue({});
    const ctx = { actorId: "a", type: "skillCheck", skillIds: ["base", "combo"], validSuits: ["spade"],
        manualMod: 1, targetValue: 22, bountyAvailable: 99, allowRecheck: true };
    async function execute(cardCheckValue = 11, overrides = {}) {
        await Flow._execute({ ctx: { ...ctx, ...overrides }, card: { id: "c" }, suit: "spade", fromDeck: true, cardCheckValue });
        return post.mock.lastCall[0].result;
    }
    return { actor, ctx, skill, execute, prompt, post };
}

describe("報酬点の資格と消費確定", () => {
    it("21固定は入力・消費なし。Aを11にすると現在の残高から支払う", async () => {
        const { actor, execute, prompt } = fixture();
        expect(await execute("FIXED_21")).toMatchObject({ achievement: 21, success: false, diff: null, bountyUsed: 0 });
        expect(prompt).not.toHaveBeenCalled();
        expect(actor.update).not.toHaveBeenCalled();
        expect(await execute()).toMatchObject({ achievement: 22, bountyUsed: 3, success: true, diff: 0 });
        expect(prompt).toHaveBeenCalledWith(4, { baseAchievement: 19 });
        expect(actor.system.bounty).toBe(-4);
    });

    it.each(["残高減少", "技能資格喪失", "口座凍結", "信用失墜"])("入力後に再評価する（%s）", async change => {
        const { actor, execute, prompt, skill } = fixture();
        prompt.mockImplementation(async () => {
            if (change === "残高減少") actor.system.bounty = -4;
            else if (change === "技能資格喪失") skill.system.usesBounty = false;
            else actor.effects.push({ statuses: [change === "口座凍結" ? "soc-13" : "soc-6"],
                flags: { "tokyo-nova-axleration": { sceneFired: true } } });
            return 3;
        });
        const used = change === "残高減少" ? 1 : 0;
        expect(await execute()).toMatchObject({ achievement: 19 + used, bountyUsed: used });
        expect(actor.update).toHaveBeenCalledTimes(used ? 1 : 0);
        expect(actor.system.bounty).toBe(used ? -5 : -1);
    });

    it.each(["abilityCheck", "controlCheck"])("%s は報酬点を使用できない", async type => {
        const { execute, prompt, actor } = fixture();
        await execute(10, { type });
        expect(prompt).not.toHaveBeenCalled();
        expect(actor.update).not.toHaveBeenCalled();
    });

    it("情報収集は技能のフラグにかかわらず支払える", async () => {
        const { execute, actor } = fixture();
        expect(await execute(2, { skillIds: [], infoGathering: {}, bountyAvailable: 0 })).toMatchObject({ bountyUsed: 3 });
        expect(actor.system.bounty).toBe(-4);
    });

    it("カードなし購入の結果カードには入力後に減算できた点数だけを載せる", async () => {
        const { actor, prompt } = fixture();
        const { startPurchaseFromBrowser } = await import("../../scripts/flow/purchase-flow.mjs");
        game.user.character = actor;
        game.settings = { get: () => ({ actStarted: true }) };
        actor.system.mundane = { total: 5 };
        vi.stubGlobal("canvas", { tokens: { controlled: [] } });
        vi.stubGlobal("fromUuid", async () => ({ name: "購入対象", system: { buy: { mode: "value", value: 8 } } }));
        vi.stubGlobal("ChatMessage", { create: vi.fn(), getSpeaker: () => ({}) });
        vi.spyOn(foundry.applications.api.DialogV2, "wait").mockResolvedValue({ kind: "noCard" });
        prompt.mockImplementation(async () => { actor.system.bounty = -4; return 3; });
        const render = vi.fn().mockResolvedValue("result");
        const previous = foundry.applications.handlebars;
        foundry.applications.handlebars = { renderTemplate: render };
        try {
            await startPurchaseFromBrowser("Item.outfit");
            expect(render.mock.lastCall[1]).toMatchObject({ mode: "noCard", bountySpent: 1, achievement: 6,
                success: false, diff: null, diffDisplay: null, granted: false });
            expect(actor.system.bounty).toBe(-5);
        } finally { foundry.applications.handlebars = previous; }
    });

    it("社会ダメージの対象行には実際に支払った軽減だけを記帳する", async () => {
        const { actor } = fixture();
        const { renderDamageCard } = await import("../../scripts/flow/damage-flow.mjs");
        const { AmountInputDialog } = await import("../../scripts/ui/tnx-dialog.mjs");
        const { TnxSocketHandler } = await import("../../scripts/core/tnx-socket-handler.mjs");
        const dom = new JSDOM('<div class="tnx-damage-ledger"></div><div class="tnx-damage-status"></div>');
        vi.stubGlobal("document", dom.window.document);
        vi.stubGlobal("fromUuidSync", () => actor);
        vi.stubGlobal("fromUuid", async () => actor);
        const roll = { category: "social", cards: [{ name: "カード", value: 8 }], targets: [{ uuid: "Actor.a",
            name: "対象", reactionEstablished: true }] };
        const message = { id: "damage", getFlag: () => roll };
        const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
        vi.spyOn(AmountInputDialog, "prompt").mockImplementation(async () => {
            actor.system.bounty = -4;
            return 3;
        });
        try {
            renderDamageCard(message, document.body);
            document.querySelector('[title="クリックで報酬点による軽減"]').click();
            await vi.waitFor(() => expect(patch).toHaveBeenCalledOnce());
            expect(patch.mock.lastCall[1].targets[0].mods).toEqual([{ label: "報酬点による軽減", value: -1, bounty: true }]);
            expect(actor.system.bounty).toBe(-5);
        } finally { dom.window.close(); }
    });

    it("用途の報酬点消費を反映した残高で判定し、凍結後の支払いを止める", async () => {
        const { actor, execute, prompt } = fixture();
        const { applyConsumptionPlan, resolveConsumeRowsForActor } = await import("../../scripts/flow/usage-consumption.mjs");
        const plan = [{ actorId: actor.id, kind: "bounty", amount: 2 }];
        expect(await execute(11, { consumeUses: plan })).toMatchObject({ bountyUsed: 2, achievement: 21 });
        expect(prompt.mock.lastCall[0]).toBe(2);
        actor.effects = [{ statuses: ["soc-13"] }];
        actor.system.bounty = 0;
        const rows = resolveConsumeRowsForActor(actor, null, [{ type: "bounty", amount: 2 }]);
        expect(rows[0].remaining).toBe(0);
        await applyConsumptionPlan(plan);
        expect(actor.system.bounty).toBe(0);
    });

    it("同じ社会ダメージへの並行支払いを対象行に両方記帳する", async () => {
        const { actor } = fixture();
        const { renderDamageCard } = await import("../../scripts/flow/damage-flow.mjs");
        const { AmountInputDialog } = await import("../../scripts/ui/tnx-dialog.mjs");
        const { TnxSocketHandler } = await import("../../scripts/core/tnx-socket-handler.mjs");
        const dom = new JSDOM('<div class="tnx-damage-ledger"></div><div class="tnx-damage-status"></div>');
        vi.stubGlobal("document", dom.window.document);
        vi.stubGlobal("fromUuidSync", () => actor);
        vi.stubGlobal("fromUuid", async () => actor);
        const roll = { category: "social", cards: [{ value: 8 }], targets: [{ uuid: actor.uuid, reactionEstablished: true }] };
        const message = { id: "damage", getFlag: () => roll };
        const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockImplementation(async (_msg, data) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            Object.assign(roll, data);
        });
        vi.spyOn(AmountInputDialog, "prompt").mockResolvedValue(3);
        try {
            renderDamageCard(message, document.body);
            const button = document.querySelector('[title="クリックで報酬点による軽減"]');
            button.click();
            button.click();
            await vi.waitFor(() => expect(patch.mock.settledResults.map(r => r.type)).toEqual(["fulfilled", "fulfilled"]));
            expect(roll.targets[0].mods.map(row => row.value)).toEqual([-3, -1]);
            expect(actor.system.bounty).toBe(-5);
        } finally { dom.window.close(); }
    });

    it.each([false, true])("元判定が0点でも、再判定時の参加技能で資格を得る（付与技能 %s）", async merge => {
        const { actor, ctx, execute, prompt, post, skill } = fixture();
        actor.system.bounty = -5;
        ctx.bountyAvailable = 0;
        if (merge) ctx.skillIds = ["base"];
        expect(await execute()).toMatchObject({ bountyUsed: 0 });
        expect(prompt.mock.calls.some(([available]) => available > 0)).toBe(false);
        const rc = { ...post.mock.lastCall[0].recheckCtx, bountyAllowed: false };
        const message = { id: "old", getFlag: (_s, key) => key === "checkRecheck" ? rc : null };
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        actor.system.bounty += 3;
        skill.system.suits = { spade: true };
        await Flow.startRecheck(message, { mergeSkill: merge ? skill : null });
        const next = open.mock.lastCall[0];
        expect(next.consumeUses).toEqual([]);
        game.messages = new Map([["old", message]]);
        const replace = vi.spyOn(Flow, "_applyRecheckReplacement").mockResolvedValue(true);
        await Flow._execute({ ctx: next, card: { id: "new" }, suit: "spade", fromDeck: true, cardCheckValue: 11 });
        expect(replace.mock.lastCall[0].result).toMatchObject({ achievement: 22, bountyUsed: 3 });
        expect(actor.system.bounty).toBe(-5);
    });

    it("並行した同一キャストの支払いは先行する更新を待って残高を読む", async () => {
        const { spendBounty } = await import("../../scripts/flow/bounty-spending.mjs");
        const { actor } = fixture();
        let release;
        const wait = new Promise(resolve => { release = resolve; });
        actor.update.mockImplementationOnce(async patch => { await wait; actor.system.bounty = patch["system.bounty"]; });
        const first = spendBounty(actor, 3);
        const second = spendBounty(actor, 3);
        await vi.waitFor(() => expect(actor.update).toHaveBeenCalledTimes(1));
        release();
        expect(await Promise.all([first, second])).toEqual([3, 1]);
        expect(actor.system.bounty).toBe(-5);
    });

    it("独立したクライアントのキューは相手の未配信の残高更新を検知できない", async () => {
        const first = (await import("../../scripts/flow/bounty-spending.mjs")).spendBounty;
        vi.resetModules();
        const second = (await import("../../scripts/flow/bounty-spending.mjs")).spendBounty;
        const writes = [];
        const clientActor = () => ({ uuid: "Actor.shared", system: { bountyBase: 3, bounty: 0 }, effects: [], items: [],
            async update(patch) { writes.push(patch["system.bounty"]); } });
        const credited = await Promise.all([first(clientActor(), 3), second(clientActor(), 3)]);
        expect(credited).toEqual([3, 3]);
        expect(writes).toEqual([-3, -3]);
    });
});
