import { beforeAll, describe, expect, it } from "vitest";
import { applyRegisteredSkillDefaults } from "../../scripts/rules/style-skill-usage-defaults.mjs";

const skill = () => ({ id: "skill", name: "Skill", type: "styleSkill", system: {
    identificationKey: "test_skill", checkMode: "normal", allowRecheck: true,
    allowSuitChange: true, grantsInterrupt: true, interruptConsumesAr: false,
    requiresVehicle: true, checkBonusSelf: "@item.self.system.levelTotal + 2",
    checkBonusSelfStackable: true, dealsDamage: true, damageType: "P", canStun: true,
    damageBonusSelf: "3", damageBonusSelfStackable: true,
    damageBonusSelfCondition: { kind: "wet", mode: "exclude", key: "" },
    get actions() { throw new Error("Source usages must never be read"); },
} });
const usage = () => ({ _id: "usage", type: "physicalAttack", skillRefs: [],
    checkBonusSelf: "9", damageBonusSelf: "8", checkBonuses: [{ source: "manual", formula: "1" }],
});

describe("skill registration defaults", () => {
    it.each(["base", "combo"])("reads only the item body when registering %s", kind => {
        const previous = usage(), next = structuredClone(previous);
        if (kind === "base") next.baseSkillRef = { itemId: "skill" };
        else next.skillRefs = [{ itemId: "skill" }];
        applyRegisteredSkillDefaults(previous, next, "parent", () => skill());
        expect(next.checkBonusSelf).toBe("9");
        expect(next.damageBonusSelf).toBe("8");
        expect(next.checkBonuses).toEqual([previous.checkBonuses[0], {
            formula: "@item.test_skill.system.levelTotal + 2", source: "test_skill", stackable: true,
        }]);
        expect(next.damageBonuses).toEqual([{
            formula: "3", source: "test_skill", stackable: true,
            targetCondition: { kind: "wet", mode: "exclude", key: "" },
        }]);
        expect(next).toMatchObject({ allowRecheck: true, allowSuitChange: true,
            grantsInterrupt: true, interruptConsumesAr: false, requiresVehicle: true, canStun: true, damageType: "P" });
    });
    it("does not reread existing members, including a move from combo to base", () => {
        const previous = { ...usage(), skillRefs: [{ itemId: "skill" }] };
        const next = { ...structuredClone(previous), skillRefs: [], baseSkillRef: { itemId: "skill" } };
        const expected = structuredClone(next);
        applyRegisteredSkillDefaults(previous, next, "parent", () => { throw new Error("Unexpected read"); });
        expect(next).toEqual(expected);
    });
    it("does not duplicate the parent or an existing supplied bonus", () => {
        const previous = usage();
        previous.checkBonuses.push({ source: "test_skill", formula: "@item.test_skill.system.levelTotal + 2" });
        const next = { ...structuredClone(previous), skillRefs: [{ itemId: "parent" }, { itemId: "skill" }] };
        applyRegisteredSkillDefaults(previous, next, "parent", () => skill());
        expect(next.checkBonuses).toHaveLength(2);
        expect(next.damageBonuses).toHaveLength(1);
    });
    it("does not erase existing enabled flags with unchecked source defaults", () => {
        const previous = { ...usage(), allowRecheck: true, canStun: true };
        const next = { ...structuredClone(previous), skillRefs: [{ itemId: "skill" }] };
        const item = skill();
        Object.assign(item.system, { allowRecheck: false, canStun: false });
        applyRegisteredSkillDefaults(previous, next, "parent", () => item);
        expect(next.allowRecheck).toBe(true);
        expect(next.canStun).toBe(true);
    });
});

describe("usage sheet registration save path", () => {
    let Sheet;
    beforeAll(async () => {
        foundry.applications.api.ApplicationV2 = class {};
        foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
        foundry.utils.deepClone = structuredClone;
        foundry.utils.setProperty = (object, path, value) => {
            const parts = path.split(".");
            const last = parts.pop();
            for (const key of parts) object = object[key] ??= {};
            object[last] = value;
        };
        ({ TnxUsageSheet: Sheet } = await import("../../scripts/app/tnx-usage-sheet.mjs"));
    });
    it.each(["base", "combo"])("persists %s settings together with the new reference", async kind => {
        const item = { id: "parent", system: { actions: [usage()] }, actor: { items: [skill()] },
            async update(data) { this.system.actions = data["system.actions"]; } };
        const sheet = Object.assign(Object.create(Sheet.prototype), { _item: item, _usageId: "usage" });
        const patch = kind === "base" ? { "baseSkillRef.itemId": "skill" } : { skillRefs: [{ itemId: "skill" }] };
        await sheet._patchUsage(patch);
        expect(item.system.actions[0].checkBonuses).toHaveLength(2);
        expect(item.system.actions[0].allowRecheck).toBe(true);
        await sheet._patchUsage(patch);
        expect(item.system.actions[0].checkBonuses).toHaveLength(2);
        await sheet._patchUsage({ allowRecheck: false });
        // A participating skill still supplies the flag; clearing the local checkbox cannot remove it.
        expect(item.system.actions[0].allowRecheck).toBe(true);
    });
});
