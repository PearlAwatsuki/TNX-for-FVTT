import { describe, it, expect } from "vitest";
import {
  temporarySuitStateAfterChange,
  reconcileTemporarySuits,
} from "../../scripts/rules/skill-level-edit.mjs";

const suits = { spade: true, club: false, heart: false, diamond: false };

describe("AE一時レベル由来スート", () => {
  it("一時枠で追加したスートと追加前のスートを分けて記録する", () => {
    expect(temporarySuitStateAfterChange({
      state: null, suits, suitKey: "heart", checked: true, baseLevel: 1, effectiveLevel: 2, nextBaseLevel: 1,
    })).toEqual({ baseSuits: ["spade"], addedSuits: ["heart"] });
  });

  it("AE補正がない通常成長では一時スートとして記録しない", () => {
    expect(temporarySuitStateAfterChange({
      state: null, suits, suitKey: "heart", checked: true, baseLevel: 1, effectiveLevel: 1, nextBaseLevel: 2,
    })).toBeNull();
  });

  it("素のレベル内に未選択枠がある場合はAE中でも一時スートにしない", () => {
    expect(temporarySuitStateAfterChange({
      state: null, suits, suitKey: "heart", checked: true,
      baseLevel: 2, effectiveLevel: 3, nextBaseLevel: 2,
    })).toBeNull();
  });

  it("AE解除で一時枠が0になったら追加スートだけを解除し、初期スートを保護する", () => {
    const result = reconcileTemporarySuits({
      state: { baseSuits: ["spade"], addedSuits: ["heart"] },
      suits: { ...suits, heart: true }, baseLevel: 1, effectiveLevel: 1,
    });
    expect(result.remove).toEqual(["heart"]);
    expect(result.remove).not.toContain("spade");
    expect(result.nextState).toBeNull();
  });

  it("一時枠が残る間は追加スートを維持する", () => {
    const result = reconcileTemporarySuits({
      state: { baseSuits: ["spade"], addedSuits: ["heart"] },
      suits: { ...suits, heart: true }, baseLevel: 1, effectiveLevel: 2,
    });
    expect(result.remove).toEqual([]);
    expect(result.keep).toEqual(["heart"]);
  });

  it("複数の一時枠が一部失われた場合は追加順の新しい一時スートだけを解除する", () => {
    const result = reconcileTemporarySuits({
      state: { baseSuits: ["spade"], addedSuits: ["heart", "diamond"] },
      suits: { spade: true, club: false, heart: true, diamond: true },
      baseLevel: 1, effectiveLevel: 2,
    });
    expect(result.keep).toEqual(["heart"]);
    expect(result.remove).toEqual(["diamond"]);
  });

  it("プレイヤーが一時スートを手動解除したら記録からも外す", () => {
    expect(temporarySuitStateAfterChange({
      state: { baseSuits: ["spade"], addedSuits: ["heart"] },
      suits: { ...suits, heart: true }, suitKey: "heart", checked: false,
      baseLevel: 1, effectiveLevel: 2, nextBaseLevel: 1,
    })).toBeNull();
  });
});
