import { afterEach, describe, expect, it, vi } from "vitest";
import { isGhostAppearing, vehicleDefenceItems } from "../../scripts/session/vehicle-state.mjs";
import { aggregateDefence } from "../../scripts/rules/damage.mjs";

const defence = (S, P, I) => ({ mode: "value", S_total: S, P_total: P, I_total: I });
const outfit = (id, type, minorCategory, values, prepared = true) => ({
  id, uuid: `Actor.a.Item.${id}`, type,
  system: {
    isCarrying: true, isPrepared: prepared,
    majorCategory: type === "cyborg" ? "cyberware" : type,
    minorCategory, defence: values,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("ゴースト登場の実効状態", () => {
  it("isGhost=true だけではゴースト登場にならず、登場フラグも必要", () => {
    const offstage = { system: { isGhost: true }, getFlag: () => false };
    const appearing = { system: { isGhost: true }, getFlag: () => true };
    expect(isGhostAppearing(offstage)).toBe(false);
    expect(isGhostAppearing(appearing)).toBe(true);
  });

  it("ゴースト登場中の所持品防御は準備中の全身義体だけを残し、防具と未準備品を除外", () => {
    vi.stubGlobal("game", { actors: { contents: [] } });
    const actor = {
      system: { isGhost: true }, getFlag: () => true,
      items: [
        outfit("armor", "armor", "armor", defence(2, 2, 2)),
        outfit("full", "cyborg", "fullCyborg", defence(3, 4, 5)),
        outfit("idle", "cyborg", "fullCyborg", defence(9, 9, 9), false),
      ],
    };
    expect(aggregateDefence(vehicleDefenceItems(actor))).toEqual({ S: 3, P: 4, I: 5 });
  });
});
