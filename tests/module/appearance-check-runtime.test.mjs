import { describe, it, expect } from "vitest";
import { currentAppearanceModifier } from "../../scripts/flow/appearance-check.mjs";

describe("currentAppearanceModifier()", () => {
  it("古い actor 集計ではなく、アイテムの AE 込み total を使う", () => {
    const actor = { system: { appearanceModifier: -2 }, items: [
      { type: "weapon", system: { isCarrying: true, appearancePenalty: { mode: "value", value: -2, total: -3 } } },
    ]};
    expect(currentAppearanceModifier(actor)).toBe(-3);
  });
});
