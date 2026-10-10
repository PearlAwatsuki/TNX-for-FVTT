import { describe, it, expect } from "vitest";
import {
  skillLevelAdjustment,
  baseLevelFromEffectiveInput,
  baseLevelAfterSuitChange,
} from "../../scripts/rules/skill-level-edit.mjs";

describe("技能レベル編集と一時修正", () => {
  it("素のレベルと実効レベルの差を一時修正として扱う", () => {
    expect(skillLevelAdjustment(1, 2)).toBe(1);
    expect(skillLevelAdjustment(2, 2)).toBe(0);
  });

  it("実効レベルを直接編集しても一時修正を素のレベルへ焼き込まない", () => {
    expect(baseLevelFromEffectiveInput(2, 1, 2)).toBe(1);
    expect(baseLevelFromEffectiveInput(3, 1, 2)).toBe(2);
  });

  it("一時修正で賄えるスート追加は素のレベルを増やさない", () => {
    expect(baseLevelAfterSuitChange({
      baseLevel: 1, effectiveLevel: 2, selectedSuitCount: 2, checked: true,
    })).toBe(1);
  });

  it("実効レベルを超えるスート追加分だけ素のレベルを増やす", () => {
    expect(baseLevelAfterSuitChange({
      baseLevel: 1, effectiveLevel: 2, selectedSuitCount: 3, checked: true,
    })).toBe(2);
  });

  it("スート解除は一時修正を焼き込まず、選択数が素のレベルを下回るときだけ下げる", () => {
    expect(baseLevelAfterSuitChange({
      baseLevel: 1, effectiveLevel: 2, selectedSuitCount: 1, checked: false,
    })).toBe(1);
    expect(baseLevelAfterSuitChange({
      baseLevel: 1, effectiveLevel: 2, selectedSuitCount: 0, checked: false,
    })).toBe(0);
  });

  it("AEが無い場合は従来どおりスート数に応じて素のレベルを増やす", () => {
    expect(baseLevelAfterSuitChange({
      baseLevel: 1, effectiveLevel: 1, selectedSuitCount: 2, checked: true,
    })).toBe(2);
  });
});
