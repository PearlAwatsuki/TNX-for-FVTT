import { describe, it, expect } from "vitest";
import { movementStagesFromAchievement } from "../../scripts/rules/vehicle-move.mjs";

describe("movementStagesFromAchievement()（操縦移動＝達成値÷10・切り捨て・2026-07-09 確定）", () => {
  it("達成値÷10 の切り捨てを段階数として返す", () => {
    expect(movementStagesFromAchievement(10)).toBe(1);
    expect(movementStagesFromAchievement(19)).toBe(1);
    expect(movementStagesFromAchievement(20)).toBe(2);
    expect(movementStagesFromAchievement(25)).toBe(2);
    expect(movementStagesFromAchievement(37)).toBe(3);
  });

  it("達成値が10未満なら0段階（端数切り捨て）", () => {
    expect(movementStagesFromAchievement(9)).toBe(0);
    expect(movementStagesFromAchievement(1)).toBe(0);
  });

  it("0・負値・非数は0段階（ファンブル/スート不一致は達成値0として渡す）", () => {
    expect(movementStagesFromAchievement(0)).toBe(0);
    expect(movementStagesFromAchievement(-5)).toBe(0);
    expect(movementStagesFromAchievement(NaN)).toBe(0);
    expect(movementStagesFromAchievement(undefined)).toBe(0);
    expect(movementStagesFromAchievement(null)).toBe(0);
  });
});
