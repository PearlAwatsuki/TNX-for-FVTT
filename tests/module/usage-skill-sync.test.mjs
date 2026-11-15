import { describe, it, expect, vi, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { syncUsageSkills } from "../../scripts/rules/usage-skill-sync.mjs";
import { TargetSelectionDialog } from "../../scripts/ui/tnx-dialog.mjs";
import { registerUsageSkillSync, synchronizeItemUsages } from "../../scripts/core/usage-skill-sync.mjs";

const skill = (id, extra = {}) => ({ id, type: "styleSkill", system: {
    identificationKey: id, checkMode: "normal", checkBonusSelf: "@item.self.system.levelTotal",
    dealsDamage: true, damageBonusSelf: "2", allowRecheck: true, damageType: "P", ...extra,
} });
describe("live skill settings in combined usages", () => {
    it("updates formulas, preserves manual rows, and removes departed contributions", () => {
        const a = skill("a"), b = skill("b", { damageType: "S" });
        const usage = { type: "physicalAttack", skillRefs: [{ itemId: "b" }],
            checkBonuses: [{ source: "manual", formula: "1" }] };
        const sync = () => syncUsageSkills(usage, a, id => id === "b" ? b : null);
        sync();
        expect(usage.checkBonuses).toHaveLength(2);
        expect(usage.checkBonuses[1].formula).toBe("@item.b.system.levelTotal");
        expect(usage.damageTypeOptions).toEqual(["P", "S"]);
        a.system.checkBonusSelf = "4"; b.system.checkBonusSelf = "@item.self.system.levelTotal * 2";
        sync(); sync();
        expect(usage.checkBonusSelf).toBe("4");
        expect(usage.checkBonuses).toHaveLength(2);
        expect(usage.checkBonuses[1].formula).toContain(" * 2");
        usage.skillRefs = [];
        a.system.allowRecheck = false;
        sync();
        expect(usage.checkBonuses).toEqual([{ source: "manual", formula: "1" }]);
        expect(usage.damageBonuses).toEqual([]);
        expect(usage.allowRecheck).toBe(false);
        expect(usage.damageTypeOptions).toEqual(["P"]);
    });
    it("keeps a shared flag until the last supplying skill is removed", () => {
        const parent = { id: "base", type: "generalSkill", system: {} };
        const skills = new Map(["a", "b"].map(id => [id, skill(id)]));
        const usage = { type: "check", skillRefs: [{ itemId: "a" }, { itemId: "b" }] };
        syncUsageSkills(usage, parent, id => skills.get(id));
        usage.skillRefs.pop();
        syncUsageSkills(usage, parent, id => skills.get(id));
        expect(usage.allowRecheck).toBe(true);
        usage.skillRefs = [];
        syncUsageSkills(usage, parent, id => skills.get(id));
        expect(usage.allowRecheck).toBe(false);
    });
    it("supports declarations and does not read another usage to obtain bonuses", () => {
        const parent = skill("a");
        Object.defineProperty(parent.system, "actions", { get() { throw Error("must not read usages"); } });
        const usage = { type: "declaration" };
        syncUsageSkills(usage, parent, () => null);
        expect(usage.allowRecheck).toBe(true);
        expect(usage.checkBonusSelf).toContain("levelTotal");
    });
});

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
    it("adds and removes body modifiers through the recheck dialog", async () => {
        const a = skill("a", { suits: { spade: true } });
        const b = skill("b", { suits: { spade: true }, damageType: "S" });
        const actor = { id: "actor", system: {}, items: new Map([["a", a], ["b", b]]) };
        vi.stubGlobal("game", { actors: new Map([["actor", actor]]), packs: new Map(), items: [], tnx: {} });
        const block = vi.spyOn(Flow, "_activationBlockReason").mockReturnValue(null);
        const refresh = vi.spyOn(Flow, "_refreshDialog").mockImplementation(() => {});
        const ctx = { actorId: "actor", type: "skillCheck", isRecheck: true, sourceItemId: "a",
            baseSkillIds: ["a"], skillIds: ["a"], dialogAddedSkillIds: [], baseConsumeUses: [],
            attack: { isAttack: true, category: "physical", damageBonuses: [] } };
        Flow._context = ctx;
        expect(await Flow.addDialogSkill("b")).toBe(true);
        expect(ctx.skillIds).toEqual(["a", "b"]);
        expect(ctx.checkBonuses.map(row => row.source)).toEqual(["b"]);
        expect(ctx.attack.damageTypeOptions).toEqual(["P", "S"]);
        expect(await Flow.removeDialogSkill("b")).toBe(true);
        expect(ctx.skillIds).toEqual(["a"]);
        expect(ctx.checkBonuses).toEqual([]);
        expect(ctx.attack.damageBonuses).toEqual([]);
        expect(ctx.consumeUses).toEqual([]);
        Flow._context = null;
        block.mockRestore(); refresh.mockRestore(); vi.unstubAllGlobals();
    });
    it("merges current body bonuses once and consumes only the newly supplied plan", async () => {
        const a = skill("a", { suits: { spade: true } });
        const b = skill("b", { suits: { spade: true }, damageType: "S" });
        b.name = "B";
        const actor = { id: "actor", isOwner: true, system: {}, items: new Map([["a", a], ["b", b]]) };
        vi.stubGlobal("game", { user: { isGM: false }, actors: new Map([["actor", actor]]) });
        const rc = { actorId: "actor", type: "skillCheck", sourceItemId: "a", skillIds: ["a"], validSuits: ["spade"],
            checkBonuses: [], checkBonusSelf: "old", attack: { isAttack: true, category: "physical", damageBonuses: [] } };
        const message = { id: "m", getFlag: () => rc };
        const block = vi.spyOn(Flow, "recheckBlockReason").mockReturnValue(null);
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        const plan = [{ itemId: "b", amount: 1 }];
        await Flow.startRecheck(message, { mergeSkill: b, consumeUses: plan });
        const context = open.mock.calls[0][0];
        expect(context.skillIds).toEqual(["a", "b"]);
        expect(context.checkBonuses).toHaveLength(1);
        expect(context.checkBonuses[0].source).toBe("b");
        expect(context.checkBonusSelf).toContain("levelTotal");
        expect(context.attack.damageBonuses).toHaveLength(1);
        expect(context.attack.damageTypeOptions).toEqual(["P", "S"]);
        expect(context.consumeUses).toBe(plan);
        expect(rc.skillIds).toEqual(["a"]);
        open.mockRestore(); block.mockRestore(); vi.unstubAllGlobals();
    });
});

describe("body updates refresh usages on other items", () => {
    it("updates the dependent item and settles after schema key reordering", async () => {
        const source = skill("source");
        const target = { id: "target", type: "generalSkill", system: { actions: [
            { type: "physicalAttack", skillRefs: [{ itemId: "source" }] },
        ] } };
        const items = [source, target];
        const actor = { items };
        for (const item of items) {
            item.actor = actor; item.isOwner = true; item.uuid = `Actor.a.Item.${item.id}`;
            item.update = vi.fn(async patch => {
                item.system.actions = JSON.parse(JSON.stringify(patch["system.actions"], (_key, value) =>
                    value && typeof value === "object" && !Array.isArray(value)
                        ? Object.fromEntries(Object.entries(value).reverse()) : value));
            });
        }
        foundry.utils.deepClone = structuredClone;
        const hooks = new Map();
        vi.stubGlobal("Hooks", { on: (name, callback) => hooks.set(name, callback) });
        vi.stubGlobal("game", { user: { id: "u" } });
        registerUsageSkillSync();
        await hooks.get("updateItem")(source, {}, {}, "u");
        source.system.checkBonusSelf = "7";
        await hooks.get("updateItem")(source, {}, {}, "u");
        expect(target.system.actions[0].checkBonuses[0].formula).toBe("7");
        const count = target.update.mock.calls.length;
        await synchronizeItemUsages(target);
        expect(target.update).toHaveBeenCalledTimes(count);
        vi.unstubAllGlobals();
    });
});
