import { describe, it, expect } from "vitest";
import {
  EXP_AWARD_CHECKS,
  calcPlayerExpTotal,
  calcRlExpBreakdown,
  calcRlExpTotal,
  sumMiracleSpent,
  buildAutoFilledRow,
  awardEntryDate,
} from "../../scripts/rules/exp-award.mjs";

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

describe("calcRlExpTotal()（RL＝会場手配＋PL合計÷min(3, PL人数)[切り捨て]・2026-08-30 是正）", () => {
  it("PL 3人以上は合計を3で割る（切り捨て）", () => {
    expect(calcRlExpTotal({ venue: false, playerTotal: 40, playerCount: 3 })).toBe(13);
    expect(calcRlExpTotal({ venue: false, playerTotal: 40, playerCount: 5 })).toBe(13);
  });

  it("PL 3人未満は合計を人数で割る", () => {
    expect(calcRlExpTotal({ venue: false, playerTotal: 41, playerCount: 2 })).toBe(20);
    expect(calcRlExpTotal({ venue: false, playerTotal: 7, playerCount: 1 })).toBe(7);
  });

  it("会場手配で +1", () => {
    expect(calcRlExpTotal({ venue: true, playerTotal: 9, playerCount: 5 })).toBe(1 + 3);
  });

  it("PL がいなければ配分 0（0除算しない・会場のみ）", () => {
    expect(calcRlExpTotal({ venue: true, playerTotal: 0, playerCount: 0 })).toBe(1);
    expect(calcRlExpTotal({})).toBe(0);
  });
});

describe("calcRlExpBreakdown()（配布ダイアログの内訳表示が読む）", () => {
  it("除数と配分を返す", () => {
    expect(calcRlExpBreakdown({ venue: true, playerTotal: 26, playerCount: 4 }))
      .toEqual({ playerTotal: 26, divisor: 3, share: 8, total: 9 });
    expect(calcRlExpBreakdown({ venue: false, playerTotal: 26, playerCount: 2 }))
      .toEqual({ playerTotal: 26, divisor: 2, share: 13, total: 13 });
  });

  it("欠損・負数は0として頑健", () => {
    expect(calcRlExpBreakdown({ playerTotal: -5, playerCount: -1 }))
      .toEqual({ playerTotal: 0, divisor: 0, share: 0, total: 0 });
  });
});

describe("sumMiracleSpent()（神業の消費済み回数の合算＝自動入力の神業欄）", () => {
  it("神業アイテムの uses.spent だけを合算する", () => {
    const items = [
      { type: "miracle", system: { uses: { spent: 2 } } },
      { type: "miracle", system: { uses: { spent: 1 } } },
      { type: "generalSkill", system: { uses: { spent: 9 } } },
    ];
    expect(sumMiracleSpent(items)).toBe(3);
  });

  it("欠損・負数・非数は0として頑健", () => {
    expect(sumMiracleSpent([])).toBe(0);
    expect(sumMiracleSpent(null)).toBe(0);
    expect(sumMiracleSpent([
      { type: "miracle" },
      { type: "miracle", system: { uses: { spent: -2 } } },
      { type: "miracle", system: { uses: { spent: "x" } } },
    ])).toBe(0);
  });
});

describe("buildAutoFilledRow()（「全て自動で入力する」の1行分・2026-08-30 承認）", () => {
  it("チェック8種は全て ON・カウントは実測値", () => {
    const row = buildAutoFilledRow({ miracleCount: 2, sceneCount: 4 });
    expect(Object.keys(row.checks)).toEqual(EXP_AWARD_CHECKS.map(c => c.key));
    expect(Object.values(row.checks).every(v => v === true)).toBe(true);
    expect(row.miracleCount).toBe(2);
    expect(row.sceneCount).toBe(4);
  });

  it("登場は実数のまま入れる（上限5は合計側=calcPlayerExpTotal が掛ける）", () => {
    const row = buildAutoFilledRow({ sceneCount: 7 });
    expect(row.sceneCount).toBe(7);
    expect(calcPlayerExpTotal(row)).toBe(32 + 0 + 5);
  });

  it("元データ無し・負数は0", () => {
    const row = buildAutoFilledRow();
    expect(row.miracleCount).toBe(0);
    expect(row.sceneCount).toBe(0);
    expect(buildAutoFilledRow({ miracleCount: -1, sceneCount: -3 }))
      .toMatchObject({ miracleCount: 0, sceneCount: 0 });
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
