import { describe, it, expect } from "vitest";
import {
  EXP_AWARD_CHECKS,
  calcPlayerExpTotal,
  calcRlExpTotal,
  awardEntryDate,
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

describe("awardEntryDate()（記帳する日付）", () => {
  // Date のコンストラクタ(年,月,日,時,分)はローカル時刻。UTC ではなく手元の日付になることを見る
  it("日中の確定はその日のローカル日付", () => {
    expect(awardEntryDate(new Date(2026, 7, 15, 13, 0))).toBe("2026-08-15");
  });

  it("午前7時台の確定はその日（UTC 変換で前日になっていた不具合＝KI-041）", () => {
    expect(awardEntryDate(new Date(2026, 7, 15, 7, 33))).toBe("2026-08-15");
  });

  it("日付が変わる直前の確定はその日", () => {
    expect(awardEntryDate(new Date(2026, 7, 15, 23, 59))).toBe("2026-08-15");
  });

  it("深夜(0時台)の確定は前日として扱う", () => {
    expect(awardEntryDate(new Date(2026, 7, 16, 0, 30))).toBe("2026-08-15");
  });

  it("深夜の終わり(4:59)までは前日", () => {
    expect(awardEntryDate(new Date(2026, 7, 16, 4, 59))).toBe("2026-08-15");
  });

  it("5時からはその日", () => {
    expect(awardEntryDate(new Date(2026, 7, 16, 5, 0))).toBe("2026-08-16");
  });

  it("月をまたぐ深夜は前月末になる", () => {
    expect(awardEntryDate(new Date(2026, 8, 1, 2, 0))).toBe("2026-08-31");
  });

  it("年をまたぐ深夜は前年末になる", () => {
    expect(awardEntryDate(new Date(2027, 0, 1, 3, 0))).toBe("2026-12-31");
  });

  it("月・日は 0 埋めする", () => {
    expect(awardEntryDate(new Date(2026, 0, 9, 12, 0))).toBe("2026-01-09");
  });
});
