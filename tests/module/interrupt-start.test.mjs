import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";
let TnxCombat;
beforeAll(async () => {
  vi.stubGlobal("Combat", class {});
  ({ TnxCombat } = await import("../../scripts/combat/tnx-combat.mjs"));
});
afterEach(() => vi.restoreAllMocks());
function fixture(isGM = true, isOwner = true) {
  globalThis.game = { user: { isGM } };
  globalThis.Hooks = { callAll: vi.fn() };
  return { id: "combat", started: true, combatants: new Map([["b", { actor: { isOwner } }]]),
    cutPhase: "main", mainCombatantId: "a", majorActed: ["a"], interruptStack: [], interruptConsumesAr: null,
    getFlag: () => null, _turnIndexOf: () => 1, update: vi.fn() };
}
describe("interrupt start", () => {
  it.each([true, false])("takes explicit AR choice %s without grant flags", async consumesAr => {
    const combat = fixture();
    await TnxCombat.prototype.startInterrupt.call(combat, "b", { consumesAr });
    const patch = combat.update.mock.calls[0][0];
    expect(patch["flags.tokyo-nova-axleration.interruptConsumesAr"]).toBe(consumesAr);
    expect(patch["flags.tokyo-nova-axleration.mainCombatantId"]).toBe("b");
    expect(patch["flags.tokyo-nova-axleration.interruptStack"][0].mainCombatantId).toBe("a");
  });
  it("forwards a player's explicit AR choice", async () => {
    const combat = fixture(false);
    const emit = vi.spyOn(TnxSocketHandler, "emitInterruptStart").mockImplementation(() => {});
    await TnxCombat.prototype.startInterrupt.call(combat, "b", { consumesAr: false });
    expect(emit).toHaveBeenCalledWith({combatId: "combat", combatantId: "b", consumesAr: false});
    expect(combat.update).not.toHaveBeenCalled();
  });
  it("blocks non-owners and unstarted combats", async () => {
    const combat = fixture(false, false);
    const emit = vi.spyOn(TnxSocketHandler, "emitInterruptStart").mockImplementation(() => {});
    await TnxCombat.prototype.startInterrupt.call(combat, "b");
    expect(emit).not.toHaveBeenCalled();
    game.user.isGM = true;
    combat.started = false;
    await TnxCombat.prototype.startInterrupt.call(combat, "b");
    expect(combat.update).not.toHaveBeenCalled();
  });
});
