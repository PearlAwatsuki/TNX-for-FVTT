import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
let Tracker;
beforeAll(async () => {
  vi.stubGlobal("Combat", class {});
  foundry.applications.sidebar = { tabs: { CombatTracker: class {} } };
  ({ TnxCombatTracker: Tracker } = await import("../../scripts/combat/tnx-combat-tracker.mjs"));
});
afterEach(() => vi.restoreAllMocks());

describe("interrupt tracker action", () => {
  it.each(["consume", "free"])("starts the clicked participant with %s, independent of viewed combat changes", async choice => {
    const dom = new JSDOM('<li data-combatant-id="b"><button data-action="tnxInterrupt">割り込み</button></li>');
    const button = dom.window.document.querySelector("button");
    const startInterrupt = vi.fn();
    const combat = { started: true, combatants: new Map([["b", { name: "B" }]]), startInterrupt };
    const tracker = { viewed: combat };
    foundry.applications.api.DialogV2 = { wait: vi.fn(async options => {
      expect(options.window.title).toBe("B：割り込み");
      expect(button.disabled).toBe(true);
      tracker.viewed = { startInterrupt: vi.fn() };
      return options.buttons.find(b => b.action === choice).callback();
    }) };
    await Tracker.DEFAULT_OPTIONS.actions.tnxInterrupt.call(tracker, { stopPropagation: vi.fn() }, button);
    expect(startInterrupt).toHaveBeenCalledWith("b", { consumesAr: choice === "consume" });
    expect(tracker.viewed.startInterrupt).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    dom.window.close();
  });
  it.each([false, null, "cancel"])("does not start on cancellation (%s)", async choice => {
    const dom = new JSDOM('<li data-combatant-id="b"><button>割り込み</button></li>');
    const button = dom.window.document.querySelector("button");
    const combat = { started: true, combatants: new Map([["b", { name: "B" }]]), startInterrupt: vi.fn() };
    foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue(choice) };
    await Tracker._onInterrupt.call({ viewed: combat }, { stopPropagation: vi.fn() }, button);
    expect(combat.startInterrupt).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    dom.window.close();
  });
});
