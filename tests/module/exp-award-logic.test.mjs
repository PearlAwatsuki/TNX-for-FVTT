import { describe, it, expect } from "vitest";
import {
  EXP_AWARD_CHECKS,
  calcPlayerExpTotal,
  calcRlExpTotal,
} from "../../scripts/module/exp-award-logic.mjs";

describe("EXP_AWARD_CHECKS（PL のチェック項目＝Scenario_Progress の経験点表）", () => {
  it("8項目・配点は 1/1/5/5/5/5/5/5", () => {
    expect(EXP_AWARD_CHECKS.map(c => c.points)).toEqual([1, 1, 5, 5, 5, 5, 5, 5]);
    expect(new Set(EXP_AWARD_CHECKS.map(c => c.key)).size).toBe(8);
  });
});

describe("calcPlayerExpTotal()（チェック＋神業×1＋登場シーン×1[上限5]）", () => {
  it("チェックの合計＋カウントを加算する", () => {
    const checks = { request: true, fullPlay: true };   // 1 + 5
    expect(calcPlayerExpTotal({ checks, miracleCount: 2, sceneCount: 3 })).toBe(1 + 5 + 2 + 3);
  });

  it("登場シーンは最大5点で頭打ち", () => {
    expect(calcPlayerExpTotal({ checks: {}, miracleCount: 0, sceneCount: 9 })).toBe(5);
  });

  it("全チェックで 32＋カウント", () => {
    const checks = Object.fromEntries(EXP_AWARD_CHECKS.map(c => [c.key, true]));
    expect(calcPlayerExpTotal({ checks, miracleCount: 1, sceneCount: 5 })).toBe(32 + 1 + 5);
  });

  it("欠損・負数は0として頑健", () => {
    expect(calcPlayerExpTotal({})).toBe(0);
    expect(calcPlayerExpTotal({ checks: null, miracleCount: -3, sceneCount: -1 })).toBe(0);
  });
});

describe("calcRlExpTotal()（RL＝会場手配＋min(PL合計÷3切り捨て, PL人数)）", () => {
  it("PL合計÷3（切り捨て）と PL 人数の少ない方", () => {
    expect(calcRlExpTotal({ venue: false, playerTotal: 40, playerCount: 3 })).toBe(3);   // min(13, 3)
    expect(calcRlExpTotal({ venue: false, playerTotal: 7, playerCount: 4 })).toBe(2);    // min(2, 4)
  });

  it("会場手配で +1", () => {
    expect(calcRlExpTotal({ venue: true, playerTotal: 9, playerCount: 5 })).toBe(1 + 3);
  });

  it("PL がいなければ 0（＋会場のみ）", () => {
    expect(calcRlExpTotal({ venue: true, playerTotal: 0, playerCount: 0 })).toBe(1);
    expect(calcRlExpTotal({})).toBe(0);
  });
});
