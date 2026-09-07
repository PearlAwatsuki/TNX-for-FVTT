import { describe, it, expect } from "vitest";
import {
  buildBountyGrantData,
  nextBountyValue,
  markBountyReceived,
  isBountyReceived,
} from "../../scripts/rules/bounty-grant.mjs";

const TARGETS = [
  { uuid: "Actor.aaa", name: "キャストA" },
  { uuid: "Actor.bbb", name: "キャストB" },
];

describe("buildBountyGrantData()（報酬点の配布カード＝前金・2026-07-20）", () => {
  it("対象・点数・記述を持つカードデータを返す", () => {
    const f = buildBountyGrantData({ targets: TARGETS, amount: 5, note: "前金" });
    expect(f.amount).toBe(5);
    expect(f.note).toBe("前金");
    expect(f.targets).toEqual([
      { uuid: "Actor.aaa", name: "キャストA" },
      { uuid: "Actor.bbb", name: "キャストB" },
    ]);
    expect(f.received).toEqual({});
  });

  it("負数を受け付ける（没収を同じ機構で表す）", () => {
    expect(buildBountyGrantData({ targets: TARGETS, amount: -3 }).amount).toBe(-3);
  });

  it("記述は省略できる", () => {
    expect(buildBountyGrantData({ targets: TARGETS, amount: 1 }).note).toBe("");
  });

  it("非数は0として扱う", () => {
    expect(buildBountyGrantData({ targets: TARGETS, amount: NaN }).amount).toBe(0);
    expect(buildBountyGrantData({ targets: TARGETS }).amount).toBe(0);
  });
});

describe("nextBountyValue()（着地は system.bounty・bountyBase は変えない）", () => {
  it("正数は加算する", () => {
    expect(nextBountyValue({ bountyBase: 5, bounty: 2, amount: 3 })).toBe(5);
  });

  it("負数は減算する（有効報酬点 = bountyBase + bounty）", () => {
    expect(nextBountyValue({ bountyBase: 5, bounty: 2, amount: -3 })).toBe(-1);
  });

  it("有効報酬点が0を下回らないところで止まる（持っている以上は没収できない）", () => {
    expect(nextBountyValue({ bountyBase: 5, bounty: 0, amount: -8 })).toBe(-5);
    expect(nextBountyValue({ bountyBase: 0, bounty: 3, amount: -10 })).toBe(-0);
  });

  it("基礎点が未設定でも成立する", () => {
    expect(nextBountyValue({ amount: 4 })).toBe(4);
  });
});

describe("markBountyReceived() / isBountyReceived()（二重受け取りの防止）", () => {
  it("受け取り済みを記録する", () => {
    const f = buildBountyGrantData({ targets: TARGETS, amount: 5 });
    expect(isBountyReceived(f, "Actor.aaa")).toBe(false);
    const next = markBountyReceived(f, "Actor.aaa");
    expect(isBountyReceived(next, "Actor.aaa")).toBe(true);
  });

  it("他の対象は未受け取りのまま", () => {
    const f = markBountyReceived(buildBountyGrantData({ targets: TARGETS, amount: 5 }), "Actor.aaa");
    expect(isBountyReceived(f, "Actor.bbb")).toBe(false);
  });

  it("元のデータを書き換えない", () => {
    const f = buildBountyGrantData({ targets: TARGETS, amount: 5 });
    markBountyReceived(f, "Actor.aaa");
    expect(isBountyReceived(f, "Actor.aaa")).toBe(false);
  });
});
