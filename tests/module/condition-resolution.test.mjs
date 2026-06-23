import { describe, it, expect } from "vitest";
import { conditionNeedsDraw, drawResultFlags, negateOutcome } from "../../scripts/module/condition-resolution-core.mjs";

describe("conditionNeedsDraw()", () => {
  it("衰弱は対象・数字が未確定(magnitude 0・targetAbility なし)なら要ドロー", () => {
    expect(conditionNeedsDraw("weakness", { magnitude: 0 })).toBe(true);
    expect(conditionNeedsDraw("weakness", {})).toBe(true);
    expect(conditionNeedsDraw("weakness", { magnitude: 3 })).toBe(false);              // (-数字)=確定
    expect(conditionNeedsDraw("weakness", { targetAbility: "life", magnitude: 0 })).toBe(false); // 引き済み
  });
  it("重圧は対象能力値が未指定なら要ドロー", () => {
    expect(conditionNeedsDraw("pressure", {})).toBe(true);
    expect(conditionNeedsDraw("pressure", { targetAbility: "reason" })).toBe(false);   // 指定済み
  });
  it("その他は要ドローでない", () => {
    expect(conditionNeedsDraw("doped-minor", {})).toBe(false);
    expect(conditionNeedsDraw("dead", {})).toBe(false);
  });
});

describe("drawResultFlags()", () => {
  it("スート→対象能力値。衰弱は数字を magnitude に", () => {
    expect(drawResultFlags("weakness", "heart", 7)).toEqual({ targetAbility: "life", magnitude: 7 });
    expect(drawResultFlags("weakness", "spade", 4)).toEqual({ targetAbility: "reason", magnitude: 4 });
  });
  it("重圧は対象能力値のみ(magnitude なし)", () => {
    expect(drawResultFlags("pressure", "club", 9)).toEqual({ targetAbility: "passion" });
  });
});

describe("negateOutcome()", () => {
  it("失敗 → そのまま付与", () => {
    expect(negateOutcome(false, { ability: "life" })).toEqual({ action: "apply" });
  });
  it("成功・降格先なし → 無効", () => {
    expect(negateOutcome(true, { ability: "life" })).toEqual({ action: "negate" });
  });
  it("成功・降格先あり → 降格", () => {
    expect(negateOutcome(true, { ability: "life", downgradeTo: "faint" })).toEqual({ action: "downgrade", to: "faint" });
  });
});
