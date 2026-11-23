import { describe, it, expect, vi, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { ListSelectionDialog, TargetSelectionDialog } from "../../scripts/ui/tnx-dialog.mjs";

const skill = (id, extra = {}) => ({ id, type: "styleSkill", system: {
    identificationKey: id, checkMode: "normal", checkBonusSelf: "@item.self.system.levelTotal",
    dealsDamage: true, damageBonusSelf: "2", allowRecheck: true, damageType: "P", ...extra,
} });
describe("recheck runtime choices", () => {
    let Flow, renderRecheckButton;
    beforeAll(async () => {
        foundry.applications.api.ApplicationV2 = class {};
        foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
        ({ TnxCheckFlow: Flow, renderRecheckButton } = await import("../../scripts/flow/tnx-check-flow.mjs"));
    });
    it("clicking the target after declaration or success keeps the combination without a chooser", async () => {
        const source = skill("source");
        const actor = { id: "a", items: new Map([[source.id, source]]) };
        vi.stubGlobal("game", { actors: new Map([["a", actor]]) });
        const prompt = vi.spyOn(TargetSelectionDialog, "prompt");
        const block = vi.spyOn(Flow, "recheckBlockReason").mockReturnValue(null);
        const start = vi.spyOn(Flow, "startRecheck").mockResolvedValue(true);
        const cancel = vi.spyOn(Flow, "cancelAchievementAction").mockImplementation(() => { Flow._clickState = null; });
        Flow._clickState = { kind: "recheck", actorId: "a", skillItemId: "source", merge: false, consumeUses: [] };
        const message = { getFlag: () => ({ actorId: "a" }) };
        await Flow._onGrantAchievementClick(message);
        expect(start).toHaveBeenCalledWith(message, { mergeSkill: null, consumeUses: [] });
        expect(prompt).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
        prompt.mockRestore(); block.mockRestore(); start.mockRestore(); cancel.mockRestore(); vi.unstubAllGlobals();
    });
    it("does not add inline recheck controls or activate on ordinary achievement clicks", async () => {
        const dom = new JSDOM('<div class="tnx-card"><div class="tnx-card__field"><span class="tnx-card__field-label">達成値</span><span class="tnx-card__field-value--total">20</span></div></div>');
        vi.stubGlobal("document", dom.window.document);
        vi.stubGlobal("game", { user: {}, actors: new Map([["a", { isOwner: true }]]) });
        const rc = { actorId: "a", allowRecheck: false };
        const message = { getFlag: (_scope, key) => key === "checkRecheck" ? rc : null };
        const block = vi.spyOn(Flow, "recheckBlockReason").mockReturnValue(null);
        const start = vi.spyOn(Flow, "startRecheck").mockResolvedValue(true);
        Flow._clickState = null;
        renderRecheckButton(message, document.body);
        renderRecheckButton(message, document.body);
        expect(document.querySelectorAll(".tnx-result-recheck, .tnx-result-modify, .tnx-recheck-block")).toHaveLength(0);
        const achievement = document.querySelector(".tnx-card__field-value--total");
        expect(achievement.classList.contains("tnx-recheck-ready")).toBe(false);
        expect(achievement.title).toBe("");
        achievement.click();
        await Promise.resolve();
        expect(start).not.toHaveBeenCalled();
        block.mockRestore(); start.mockRestore(); vi.unstubAllGlobals();
        dom.window.close();
    });
    it.each([false, true])("adds and removes skill modifiers and limited uses (recheck=%s)", async isRecheck => {
        const a = skill("a", { suits: { spade: true } });
        const b = skill("b", { suits: { spade: true }, damageType: "S", uses: { isLimit: true, max: 2, spent: 0 } });
        const actor = { id: "actor", system: {}, items: new Map([["a", a], ["b", b]]) };
        vi.stubGlobal("game", { actors: new Map([["actor", actor]]), packs: new Map(), items: [], tnx: {} });
        const block = vi.spyOn(Flow, "_activationBlockReason").mockReturnValue(null);
        const refresh = vi.spyOn(Flow, "_refreshDialog").mockImplementation(() => {});
        const consumption = vi.spyOn(ListSelectionDialog, "prompt").mockResolvedValue(["b:uses"]);
        const ctx = { actorId: "actor", type: "skillCheck", isRecheck, sourceItemId: "a",
            baseSkillIds: ["a"], skillIds: ["a"], dialogAddedSkillIds: [], baseConsumeUses: [],
            usageSettingsInput: { settingsVersion: 1, type: "physicalAttack", skillRefs: [] },
            attack: { isAttack: true, category: "physical", damageBonuses: [] } };
        Flow._context = ctx;
        expect(await Flow.addDialogSkill("b")).toBe(true);
        expect(ctx.consumeUses).toEqual([{ actorId: actor.id, itemId: "b", kind: "uses", amount: 1 }]);
        consumption.mockRestore();
        expect(ctx.skillIds).toEqual(["a", "b"]);
        expect(ctx.checkBonuses.map(row => row.source)).toEqual(["a", "b"]);
        expect(ctx.attack.damageTypeOptions).toEqual(["P", "S"]);
        expect(ctx.attack.damageType).toBe("P");
        a.system.damageType = "I";
        expect(await Flow.removeDialogSkill("b")).toBe(true);
        expect(ctx.skillIds).toEqual(["a"]);
        expect(ctx.checkBonuses.map(row => row.source)).toEqual(["a"]);
        expect(ctx.attack.damageBonuses.map(row => row.source)).toEqual(["a"]);
        expect(ctx.attack.damageType).toBe("I");
        expect(ctx.attack.damageTypeOptions).toEqual(["I"]);
        expect(ctx.consumeUses).toEqual([]);
        Flow._context = null;
        block.mockRestore(); refresh.mockRestore(); vi.unstubAllGlobals();
    });
    it("preserves legacy recheck values without inferring their provenance", async () => {
        const a = skill("a", { suits: { spade: true } });
        const actor = { id: "actor", system: {}, items: new Map([["a", a]]) };
        vi.stubGlobal("game", { actors: new Map([["actor", actor]]), packs: new Map(), items: [], tnx: {} });
        const attack = { isAttack: true, category: "physical", damageType: "X", damageTypeOptions: ["X", "S"],
            damageBonuses: [{ source: "a", formula: "17" }], damageBonusSelfCondition: { kind: "wet", mode: "only", key: "" } };
        const ctx = { actorId: "actor", type: "skillCheck", isRecheck: true, sourceItemId: "a",
            baseSkillIds: ["a"], dialogAddedSkillIds: [], checkBonusSelf: "13", checkBonusSelfStackable: true,
            checkBonuses: [{ source: "a", formula: "11" }], attack: structuredClone(attack) };
        Flow._context = ctx;
        await Flow._rebuildDialogSkillContext();
        expect(ctx.checkBonusSelf).toBe("13");
        expect(ctx.checkBonuses).toEqual([{ source: "a", formula: "11" }]);
        expect(ctx.attack).toMatchObject(attack);
        Flow._context = null;
        vi.unstubAllGlobals();
    });
    it("merges current body bonuses once and consumes only the newly supplied plan", async () => {
        const a = skill("a", { suits: { spade: true } });
        const b = skill("b", { suits: { spade: true }, damageType: "S" });
        b.name = "B";
        const actor = { id: "actor", isOwner: true, system: {}, items: new Map([["a", a], ["b", b]]) };
        vi.stubGlobal("game", { user: { isGM: false }, actors: new Map([["actor", actor]]) });
        const rc = { actorId: "actor", type: "skillCheck", sourceItemId: "a", skillIds: ["a"], validSuits: ["spade"],
            usageKind: "attack", usageType: "physicalAttack", attackWeaponKind: "ranged", usageTiming: { value: "major" },
            usageSettingsInput: { settingsVersion: 1, type: "physicalAttack", checkBonusSelf: "9", skillRefs: [] },
            checkBonuses: [], checkBonusSelf: "9", attack: { isAttack: true, category: "physical", damageBonuses: [] } };
        const message = { id: "m", getFlag: () => rc };
        const block = vi.spyOn(Flow, "recheckBlockReason").mockReturnValue(null);
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        const plan = [{ itemId: "b", amount: 1 }];
        await Flow.startRecheck(message, { mergeSkill: b, consumeUses: plan });
        const context = open.mock.calls[0][0];
        expect(Flow._buildRecheckContext(context)).toMatchObject({
            usageKind: "attack", usageType: "physicalAttack", attackWeaponKind: "ranged", usageTiming: { value: "major" },
        });
        expect(context.skillIds).toEqual(["a", "b"]);
        expect(context.checkBonuses).toHaveLength(2);
        expect(context.checkBonuses[1].source).toBe("b");
        expect(context.checkBonusSelf).toBe("9");
        expect(context.attack.damageBonuses).toHaveLength(2);
        expect(context.attack.damageTypeOptions).toEqual(["P", "S"]);
        expect(context.consumeUses).toBe(plan);
        expect(rc.skillIds).toEqual(["a"]);
        open.mockRestore(); block.mockRestore(); vi.unstubAllGlobals();
    });
});
