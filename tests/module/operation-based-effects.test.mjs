import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { acquisitionModificationSources } from "../../scripts/rules/acquisition-modification.mjs";

let recovery, repair, Flow;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    recovery = await import("../../scripts/flow/recovery-flow.mjs");
    repair = await import("../../scripts/flow/repair-flow.mjs");
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("operation-based effects", () => {
    it("reads parent and combination modification formulas live without duplicating a source", () => {
        const child = { id: "c", system: { acquisitionModification: "2" } };
        const parent = { id: "p", system: { acquisitionModification: "1" }, actor: { items: new Map([["c", child]]) } };
        const usage = { baseSkillRef: { itemId: "c" }, skillRefs: [{ itemId: "c" }] };
        expect(acquisitionModificationSources(parent, usage).map(s => s.formula)).toEqual(["1", "2"]);
        child.system.acquisitionModification = "4";
        expect(acquisitionModificationSources(parent, usage).map(s => s.formula)).toEqual(["1", "4"]);
        child.system.acquisitionModification = "";
        expect(acquisitionModificationSources(parent, usage)).toHaveLength(1);
    });
    it("does not hide a normal effect behind old recovery settings", () => {
        const effect = { id: "e", name: "effect", flags: {}, changes: [] };
        expect(recovery.listRecoverableEffects({ effects: [effect] }, { recoveryTargets: [], recoveryEffects: false, recoverySceneLimit: "all" })).toEqual([effect]);
    });
    it("offers malfunctioning equipment regardless of the old whitelist", () => {
        const item = { id: "i", type: "weapon", system: { majorCategory: "weapon", minorCategory: "melee", isMalfunction: true } };
        expect(repair.listRepairableOutfits({ items: [item] }, { repairableCategories: [] })).toEqual([item]);
        item.system.isMalfunction = false;
        expect(repair.listRepairableOutfits({ items: [item] })).toEqual([]);
    });
    it("allows editing a treatment target value and keeps that ability for rerolls", () => {
        Flow._context = { editableTargetValue: true, targetValue: 10 };
        Flow.setTargetValue("14");
        expect(Flow._context.targetValue).toBe(14);
        expect(Flow._buildRecheckContext(Flow._context).editableTargetValue).toBe(true);
        Flow.setTargetValue("");
        expect(Flow._context.targetValue).toBeNull();
        Flow._context = null;
    });
    it("removes chosen effects only on success, through the normal recovery continuation", async () => {
        const effects = [{ id: "e", changes: [], flags: {} }];
        effects.get = id => effects.find(e => e.id === id);
        const patient = { name: "patient", isOwner: true, effects, deleteEmbeddedDocuments: vi.fn() };
        vi.stubGlobal("fromUuid", async () => patient);
        const context = { patientUuid: "patient", removeIds: ["e"], effectLabel: "effect" };
        await recovery.resolveRecoveryFromCheck(context, { success: false });
        expect(patient.deleteEmbeddedDocuments).not.toHaveBeenCalled();
        await recovery.resolveRecoveryFromCheck(context, { success: true });
        expect(patient.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", ["e"]);
    });
});
