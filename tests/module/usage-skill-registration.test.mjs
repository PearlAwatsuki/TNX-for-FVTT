import { beforeAll, describe, expect, it } from "vitest";

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
    it.each(["base", "combo"])("persists the %s reference without copying definition settings", async kind => {
        const item = { id: "parent", system: { actions: [usage()] }, actor: { items: [skill()] },
            async update(data) { this.system.actions = data["system.actions"]; } };
        const sheet = Object.assign(Object.create(Sheet.prototype), { _item: item, _usageId: "usage" });
        const patch = kind === "base" ? { "baseSkillRef.itemId": "skill" } : { skillRefs: [{ itemId: "skill" }] };
        await sheet._patchUsage(patch);
        expect(item.system.actions[0].checkBonuses).toHaveLength(1);
        expect(item.system.actions[0].allowRecheck).toBeUndefined();
        await sheet._patchUsage(patch);
        expect(item.system.actions[0].checkBonuses).toHaveLength(1);
        await sheet._patchUsage({ allowRecheck: false });
        // The saved checkbox is local, independently of the effective permission.
        expect(item.system.actions[0].allowRecheck).toBe(false);
    });
});
