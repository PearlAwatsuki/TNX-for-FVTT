import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../scripts/flow/usage-consumption.mjs", () => ({
    resolveConsumeRowsForActor: () => [], promptConsumption: async () => [], applyConsumptionPlan: async () => {},
}));
vi.mock("../../scripts/flow/usage-check-context.mjs", () => ({ buildUsageCheckContext: async () => ({ type: "skillCheck" }) }));
vi.mock("../../scripts/flow/target-resolution.mjs", () => ({ resolveUsageTargetRefs: async () => [] }));
vi.mock("../../scripts/flow/usage-effects.mjs", () => ({ prepareUsageEffectPayload: async () => null }));
vi.mock("../../scripts/session/vehicle-state.mjs", () => ({ ghostCanInteract: () => true, preparedVehicle: () => null }));
let activate, Flow;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    ({ activateItemCheck: activate } = await import("../../scripts/flow/item-activation.mjs"));
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
afterEach(() => vi.restoreAllMocks());
describe("legacy flags do not activate click-wait modes", () => {
    it.each(["check", "declaration"])("executes %s normally", async type => {
        const usage = { _id: "u", type, grantRecheck: true, allowRecheck: true, modifyDamage: true };
        const item = { id: "i", name: "Skill", type: "generalSkill", system: { actions: [usage] }, postDescriptionCard: vi.fn() };
        const actor = { items: new Map([["i", item]]) };
        const pending = vi.spyOn(Flow, "startAchievementAction");
        const open = vi.spyOn(Flow, "open").mockResolvedValue();
        await activate(actor, item, { usageId: "u" });
        expect(pending).not.toHaveBeenCalled();
        if (type === "check") expect(open).toHaveBeenCalledOnce();
        else expect(item.postDescriptionCard).toHaveBeenCalledOnce();
    });
});
