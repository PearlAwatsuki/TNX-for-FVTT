import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveUsageSettings, diagnoseUsageSettings, migrateUsageSettings, restoreUsageSettings,
    USAGE_SKILL_FIELDS } from "../../scripts/rules/usage-skill-sync.mjs";
import { registerUsageSkillSync } from "../../scripts/core/usage-skill-sync.mjs";
import { updateUsageActions } from "../../scripts/core/usage-derivation.mjs";
import { submitUsageForm } from "../../scripts/app/usage-sheet-submit.mjs";

const skill = (id, system = {}) => ({ id, name: id, type: "styleSkill", system: {
    identificationKey: id, checkBonusSelf: "@item.self.system.levelTotal", dealsDamage: true,
    damageBonusSelf: "2", damageType: "P", allowRecheck: true, ...system,
} });
const usage = extra => ({ settingsVersion: 1, type: "physicalAttack", skillRefs: [{ itemId: "b" }],
    checkBonusSelf: "9", damageBonusSelf: "8", checkBonuses: [{ source: "b", formula: "1", stackable: true }],
    ...extra });
afterEach(() => vi.unstubAllGlobals());

describe("usage definitions, local settings and effective settings", () => {
    it("is pure, deterministic and idempotent even when given its effective output", () => {
        const a = skill("a"), b = skill("b"), input = usage();
        const before = structuredClone({ a, b, input });
        const first = resolveUsageSettings(input, a, () => b);
        expect(resolveUsageSettings(input, a, () => b)).toEqual(first);
        expect(resolveUsageSettings(first.effective, a, () => b)).toEqual(first);
        expect({ a, b, input }).toEqual(before);
        expect(first.effective.checkBonusSelf).toBe("9");
        expect(first.effective.damageBonusSelf).toBe("8");
        expect(first.effective.checkBonuses.map(r => r.origin.kind)).toEqual(["usage", "skill", "skill"]);
        expect(first.effective.checkBonuses[2].formula).toBe("@item.b.system.levelTotal");
        first.effective.checkBonuses[0].formula = "changed";
        expect(input.checkBonuses[0].formula).toBe("1");
    });
    it("preserves manual rows with the same key and formula, including after removal or key rename", () => {
        const a = skill("a", { allowRecheck: false }), b = skill("b");
        const input = usage({ checkBonuses: [{ source: "b", formula: "@item.b.system.levelTotal" }] });
        const get = () => b;
        expect(resolveUsageSettings(input, a, get).effective.checkBonuses).toHaveLength(3);
        b.system.identificationKey = "renamed";
        b.system.checkBonusSelf = "7";
        const changed = resolveUsageSettings(input, a, get).effective;
        expect(changed.checkBonuses[0]).toMatchObject(input.checkBonuses[0]);
        expect(changed.checkBonuses[2]).toMatchObject({ source: "renamed", formula: "7" });
        input.skillRefs = [];
        const removed = resolveUsageSettings(input, a, get).effective;
        expect(removed.checkBonuses).toHaveLength(2);
        expect(removed.checkBonuses[0]).toMatchObject(input.checkBonuses[0]);
        expect(removed.allowRecheck).toBe(false);
    });
    it("handles shared permissions, requirements, local choices and interrupt AR separately", () => {
        const a = skill("a", { damageType: "P", grantsInterrupt: true, interruptConsumesAr: false });
        const b = skill("b", { damageType: "S", grantsInterrupt: true, interruptConsumesAr: true, requiresVehicle: true });
        const input = usage({ damageType: "X", requiresVehicle: false });
        const first = resolveUsageSettings(input, a, () => b).effective;
        expect(first.damageType).toBe("X");
        expect(first.damageTypeOptions).toEqual(["X", "P", "S"]);
        expect(first.interruptConsumesAr).toBe(true);
        expect(first.requiresVehicle).toBe(true);
        input.skillRefs = [];
        const removed = resolveUsageSettings(input, a).effective;
        expect(removed.interruptConsumesAr).toBe(false);
        expect(removed.requiresVehicle).toBe(false);
        expect(removed.allowRecheck).toBe(true);
        a.system.allowRecheck = false;
        input.allowRecheck = true;
        expect(resolveUsageSettings(input, a).effective.allowRecheck).toBe(true);
    });
    it("keeps target conditions attached to each contribution and does not read source usages", () => {
        const a = skill("a", { damageBonusSelfCondition: { kind: "wet", mode: "exclude", key: "" } });
        Object.defineProperty(a.system, "actions", { get() { throw Error("must not read usages"); } });
        const localCondition = { kind: "style", mode: "only", key: "kabuto" };
        const result = resolveUsageSettings(usage({ damageBonusSelfCondition: localCondition }), a);
        expect(result.effective.damageBonusSelfCondition).toEqual(localCondition);
        expect(result.contributions.damageBonuses[0].targetCondition).toEqual(a.system.damageBonusSelfCondition);
    });
    it("resolves duplicate membership once and removes deleted sources without removing local data", () => {
        const a = skill("a"), b = skill("b");
        const input = usage({ baseSkillRef: { itemId: "b" }, skillRefs: [{ itemId: "b" }, { itemId: "a" }] });
        expect(resolveUsageSettings(input, a, () => b).contributions.checkBonuses).toHaveLength(2);
        expect(resolveUsageSettings(input, a, () => null).contributions.checkBonuses).toHaveLength(1);
        expect(resolveUsageSettings(input, a).effective.checkBonuses[0].source).toBe("b");
    });
    it("reports an unbindable formula instead of applying it to the parent", () => {
        const result = resolveUsageSettings(usage(), skill("a"), () => skill("b", { identificationKey: "" }));
        expect(result.diagnostics).toContainEqual(expect.objectContaining({ error: true, code: "missing-formula-key" }));
    });
});

describe("legacy diagnosis, explicit migration and restoration", () => {
    it("does not guess provenance from history, equal values, or source keys", () => {
        const input = usage({ settingsVersion: 0, skillSettingsSync: { sources: ["b"], local: { allowRecheck: false } } });
        const original = structuredClone(input);
        const result = resolveUsageSettings(input, skill("a"), () => skill("b"));
        const { usageSettingsInput: snapshot, ...effective } = result.effective;
        expect(effective).toEqual(original);
        expect(snapshot).toEqual(original);
        expect(diagnoseUsageSettings(input).needsReview).toBe(true);
        expect(input).toEqual(original);
    });
    it("requires decisions for every field, preserves chosen rows and restores the exact original", () => {
        const input = usage({ settingsVersion: 0, unknownExtension: { x: [1, 2] } });
        expect(() => migrateUsageSettings(input, {})).toThrow();
        const decisions = Object.fromEntries(USAGE_SKILL_FIELDS.map(key => [key, { action: "keep" }]));
        decisions.damageBonusSelf = { action: "replace", value: "" };
        const migrated = migrateUsageSettings(input, decisions);
        expect(migrated.checkBonuses).toEqual(input.checkBonuses);
        expect(migrated.damageBonusSelf).toBe("");
        expect(diagnoseUsageSettings(migrated).needsReview).toBe(false);
        migrated.checkBonusSelf = "modified after migration";
        expect(restoreUsageSettings(migrated)).toEqual(input);
        expect(input.damageBonusSelf).toBe("8");
    });
});

describe("persistence boundaries", () => {
    it("skill create/update/delete refresh views on every client without saving documents", () => {
        const callbacks = new Map(), update = vi.fn(), render = vi.fn();
        const instances = new Map([["sheet", { _usageId: "u", _item: { update }, rendered: true, render }]]);
        const previous = foundry.applications.instances;
        foundry.applications.instances = instances;
        vi.stubGlobal("Hooks", { on: (key, fn) => callbacks.set(key, fn) });
        registerUsageSkillSync();
        for (const event of ["createItem", "updateItem", "deleteItem"]) callbacks.get(event)({}, {}, {}, "other-client");
        expect(render).toHaveBeenCalledTimes(3);
        expect(update).not.toHaveBeenCalled();
        foundry.applications.instances = previous;
    });
    it("saving an unrelated edit does not rewrite skill settings", async () => {
        const input = usage({ _id: "u" }), original = structuredClone(input);
        const item = { id: "a", type: "styleSkill", system: { actions: [input], checkBonusSelf: "100" }, update: vi.fn() };
        foundry.utils.deepClone = structuredClone;
        await updateUsageActions(item, actions => { actions[0].name = "new name"; return actions; });
        expect(item.update).toHaveBeenCalledWith({ "system.actions": [{ ...original, name: "new name" }] });
    });
    it("partial form submission preserves undisplayed modifier rows and stackability", async () => {
        const input = usage({ timing: {}, checkBonusSelfStackable: true, damageBonusSelfStackable: true,
            damageBonuses: [{ source: "b", formula: "3" }] });
        const sheet = { usage: input, _item: { system: {} }, _patchUsage: vi.fn(), _enforceComboRequirements: vi.fn(), render: vi.fn() };
        await submitUsageForm(sheet, {}, {}, { object: { name: "renamed" } });
        expect(sheet._patchUsage.mock.calls[0][0]).toMatchObject({ checkBonuses: input.checkBonuses,
            damageBonuses: input.damageBonuses, checkBonusSelfStackable: true, damageBonusSelfStackable: true });
    });
});
