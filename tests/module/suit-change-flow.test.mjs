import { describe, it, expect, beforeAll, vi } from "vitest";
let Flow;
beforeAll(async () => {
  foundry.applications.api.ApplicationV2 = class {};
  foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
  ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
});
describe("suit selection after playing a card", () => {
  it.each(["spade", "heart", "diamond", "club"])("uses %s from the separate dialog", async suit => {
    const prompt = vi.fn().mockResolvedValue(suit);
    foundry.applications.api.DialogV2 = { wait: prompt };
    expect(await Flow._resolveSuitChange("spade", { type: "skillCheck", allowSuitChange: true })).toBe(suit);
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0][0].content).toContain('value="spade" selected');
  });
  it("does not prompt when the checkbox is off", async () => {
    const prompt = vi.fn();
    foundry.applications.api.DialogV2 = { wait: prompt };
    expect(await Flow._resolveSuitChange("heart", { type: "skillCheck", allowSuitChange: false })).toBe("heart");
    expect(prompt).not.toHaveBeenCalled();
  });
  it.each([false, null, "invalid"])("keeps the original suit on cancel or invalid result: %s", async value => {
    foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue(value) };
    expect(await Flow._resolveSuitChange("heart", { allowSuitChange: true })).toBe("heart");
  });
  it("keeps control check suits unchanged", async () => {
    const prompt = vi.fn();
    foundry.applications.api.DialogV2 = { wait: prompt };
    expect(await Flow._resolveSuitChange("heart", { type: "controlCheck", allowSuitChange: true })).toBe("heart");
    expect(prompt).not.toHaveBeenCalled();
  });
  it("updates and resets the current selection", () => {
    Flow._context = {};
    Flow.setAllowSuitChange(true);
    expect(Flow._context.allowSuitChange).toBe(false);
    Flow._context.suitChangePermitted = true;
    Flow.setAllowSuitChange(true);
    expect(Flow._context.allowSuitChange).toBe(true);
    Flow.setAllowSuitChange(false);
    expect(Flow._context.allowSuitChange).toBe(false);
    Flow._context = null;
  });
});
