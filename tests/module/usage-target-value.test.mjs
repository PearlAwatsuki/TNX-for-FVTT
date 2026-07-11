import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveUsageTargetValue } = await import("../../scripts/module/usage-target-value.mjs");

describe("resolveUsageTargetValue()（目標値の一本化・2026-07-13 ユーザー確定）", () => {
  it("数字: 特定の目標値が必ず入る=そのまま目標値", async () => {
    expect(await resolveUsageTargetValue({ targetValue: "number", targetValueNumber: 15 }, null, null)).toBe(15);
  });

  it("解説参照/その他: 自由記入欄の式(数値)を目標値に解決する", async () => {
    expect(await resolveUsageTargetValue({ targetValue: "other", targetValueOther: "12" }, null, null)).toBe(12);
    expect(await resolveUsageTargetValue({ targetValue: "explanation", targetValueOther: "20" }, null, null)).toBe(20);
  });

  it("解説参照/その他: 空欄は目標値なし", async () => {
    expect(await resolveUsageTargetValue({ targetValue: "other", targetValueOther: "" }, null, null)).toBeNull();
    expect(await resolveUsageTargetValue({ targetValue: "explanation" }, null, null)).toBeNull();
  });

  it("制御値/達成値/登場目標値/なし: 具体値は引かない(別メカニクス)", async () => {
    for (const tv of ["control", "total", "enterDifficulty", "none", "blank", undefined]) {
      expect(await resolveUsageTargetValue({ targetValue: tv, targetValueNumber: 99, targetValueOther: "99" }, null, null)).toBeNull();
    }
  });
});
