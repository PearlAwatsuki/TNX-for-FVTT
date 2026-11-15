import { beforeAll, describe, expect, it, vi } from "vitest";
import { effectiveBaseSkillId } from "../../scripts/rules/usage-types.mjs";
import { enforceUsageChainDefaultsOnImport } from "../../scripts/core/usage-derivation.mjs";
import { submitUsageForm } from "../../scripts/app/usage-sheet-submit.mjs";

let Sheet;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    foundry.utils.setProperty = (object, path, value) => {
        const parts = path.split("."), key = parts.pop();
        for (const part of parts) object = object[part] ??= {};
        object[key] = value;
    };
    ({ TnxUsageSheet: Sheet } = await import("../../scripts/app/tnx-usage-sheet.mjs"));
});
const skill = (id, isAction = false, comboSkill = []) => ({
    id, type: "generalSkill", name: id, system: { identificationKey: id, isAction, comboSkill, level: 5 },
});
function fixture() {
    const parent = skill("parent"), a = skill("a", true), b = skill("b", true), support = skill("support");
    const items = [parent, a, b, support];
    items.get = id => items.find(i => i.id === id);
    items.has = id => !!items.get(id);
    for (const item of items) item.actor = { items };
    parent.system.actions = [{ _id: "u", type: "check", baseSkillRef: { itemId: "a" }, skillRefs: [] }];
    parent.update = async patch => { parent.system.actions = patch["system.actions"]; };
    const sheet = Object.assign(Object.create(Sheet.prototype), { _item: parent, _usageId: "u", render: vi.fn() });
    return { sheet, parent, a, b, support };
}
describe("editing an action base", () => {
    it("persists clearing through the actual form submit without a trim prompt", async () => {
        const { sheet, parent } = fixture();
        sheet.usage.timing = {};
        sheet._promptTrimCombos = vi.fn();
        await submitUsageForm(sheet, {}, {}, { object: { "baseSkillRef.itemId": "" } });
        expect(sheet.usage.baseSkillCleared).toBe(true);
        expect(sheet.usage.baseSkillRef.itemId).toBe("");
        expect(sheet._promptTrimCombos).not.toHaveBeenCalled();
        await sheet._enforceComboRequirements();
        expect(effectiveBaseSkillId(sheet.usage, parent)).toBe("");
    });
    it("does not lock the selector because of the chosen base itself", () => {
        const { sheet } = fixture();
        expect(sheet._resolveComboChain().baseLocked).toBe(true);
        expect(sheet._resolveComboChain({ includeBase: false }).baseLocked).toBe(false);
    });
    it("switches between action bases and remains stable", async () => {
        const { sheet } = fixture();
        await sheet._patchUsage({ "baseSkillRef.itemId": "b" });
        await sheet._enforceComboRequirements();
        expect(sheet.usage.baseSkillRef.itemId).toBe("b");
        expect(await sheet._enforceComboRequirements()).toBe(false);
        expect(sheet._resolveComboChain({ includeBase: false }).baseLocked).toBe(false);
    });
    it("keeps a deliberate clear through enforcement and import; execution has no fallback", async () => {
        const { sheet, parent } = fixture();
        await sheet._patchUsage({ "baseSkillRef.itemId": "", baseSkillCleared: true });
        await sheet._enforceComboRequirements();
        await enforceUsageChainDefaultsOnImport(parent);
        expect(sheet.usage.baseSkillRef.itemId).toBe("");
        expect(effectiveBaseSkillId(sheet.usage, parent)).toBe("");
        await sheet._patchUsage({ "baseSkillRef.itemId": "b", baseSkillCleared: false });
        await sheet._enforceComboRequirements();
        expect(effectiveBaseSkillId(sheet.usage, parent)).toBe("b");
    });
    it("replaces dependencies added by the old base without removing manual members", async () => {
        const { sheet, a, parent } = fixture();
        a.system.comboSkill = [{ value: "skillName", name: "support" }];
        // A non-action base traverses its designated skill.
        a.system.isAction = false;
        await sheet._enforceComboRequirements();
        expect(sheet.usage.skillRefs).toContainEqual({ itemId: "support" });
        expect(sheet.usage.autoRequiredSkillIds).toContain("support");
        await sheet._patchUsage({ "baseSkillRef.itemId": "b" });
        await sheet._enforceComboRequirements();
        expect(sheet.usage.skillRefs).not.toContainEqual({ itemId: "support" });
        expect(parent.system.actions[0].baseSkillRef.itemId).toBe("b");
    });
    it("retains a base required by the parent skill", () => {
        const { sheet, parent } = fixture();
        parent.system.comboSkill = [{ value: "skillName", name: "a" }];
        const constraints = sheet._resolveComboChain({ includeBase: false });
        expect(constraints.baseLocked).toBe(true);
        expect(constraints.baseCandidateItemIds).toEqual(["a"]);
    });
    it("keeps action parents as their own base", async () => {
        const { sheet, parent } = fixture();
        parent.system.isAction = true;
        await sheet._enforceComboRequirements();
        expect(sheet.usage.baseSkillRef.itemId).toBe("parent");
    });
});
