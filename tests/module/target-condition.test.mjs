import { describe, it, expect } from "vitest";
import { hasTargetCondition, matchesTargetCondition, targetConditionApplies, targetConditionNote }
  from "../../scripts/module/target-condition.mjs";

/** 対象コンテキストの略記 */
const ctx = (isWet, styles = [], works = []) => ({ isWet, styles, works });

describe("hasTargetCondition()（条件が実質を持つか）", () => {
  it("kind なし/none は条件なし", () => {
    expect(hasTargetCondition(null)).toBe(false);
    expect(hasTargetCondition({})).toBe(false);
    expect(hasTargetCondition({ kind: "none" })).toBe(false);
  });

  it("wet は key を要さない・style/works は key 未選択なら条件なし扱い", () => {
    expect(hasTargetCondition({ kind: "wet" })).toBe(true);
    expect(hasTargetCondition({ kind: "style" })).toBe(false);
    expect(hasTargetCondition({ kind: "style", key: "kabutowari" })).toBe(true);
    expect(hasTargetCondition({ kind: "works", key: "" })).toBe(false);
    expect(hasTargetCondition({ kind: "works", key: "kabuki" })).toBe(true);
  });
});

describe("matchesTargetCondition()（種類の該当・極性の適用前）", () => {
  it("wet は対象のウェット状態で照合", () => {
    expect(matchesTargetCondition({ kind: "wet" }, ctx(true))).toBe(true);
    expect(matchesTargetCondition({ kind: "wet" }, ctx(false))).toBe(false);
  });

  it("style/works は対象が持つ識別キーで照合", () => {
    const c = ctx(false, ["ayakashi"], ["kabuki"]);
    expect(matchesTargetCondition({ kind: "style", key: "ayakashi" }, c)).toBe(true);
    expect(matchesTargetCondition({ kind: "style", key: "tatara" }, c)).toBe(false);
    expect(matchesTargetCondition({ kind: "works", key: "kabuki" }, c)).toBe(true);
    expect(matchesTargetCondition({ kind: "works", key: "union" }, c)).toBe(false);
  });

  it("none/未知の種類は該当しない", () => {
    expect(matchesTargetCondition({ kind: "none" }, ctx(true))).toBe(false);
    expect(matchesTargetCondition({ kind: "unknown" }, ctx(true))).toBe(false);
  });
});

describe("targetConditionApplies()（この対象に行を適用するか）", () => {
  it("条件なしは常に適用", () => {
    expect(targetConditionApplies(null, ctx(true))).toBe(true);
    expect(targetConditionApplies({ kind: "none" }, ctx(true))).toBe(true);
  });

  it("対象未解決(ctx=null)はゲートしない＝条件つきでも適用", () => {
    expect(targetConditionApplies({ kind: "wet", mode: "exclude" }, null)).toBe(true);
    expect(targetConditionApplies({ kind: "wet", mode: "only" }, null)).toBe(true);
  });

  it("exclude=該当したら無効・非該当なら適用（ウェットには効果がない）", () => {
    const cond = { kind: "wet", mode: "exclude" };
    expect(targetConditionApplies(cond, ctx(true))).toBe(false);
    expect(targetConditionApplies(cond, ctx(false))).toBe(true);
  });

  it("only=該当したときだけ適用（特定スタイルのみダメージ増強）", () => {
    const cond = { kind: "style", mode: "only", key: "ayakashi" };
    expect(targetConditionApplies(cond, ctx(false, ["ayakashi"]))).toBe(true);
    expect(targetConditionApplies(cond, ctx(false, ["tatara"]))).toBe(false);
  });

  it("mode 未指定は exclude 扱い（既定の極性）", () => {
    expect(targetConditionApplies({ kind: "wet" }, ctx(true))).toBe(false);
    expect(targetConditionApplies({ kind: "wet" }, ctx(false))).toBe(true);
  });
});

describe("targetConditionNote()（内訳の 0 行に付ける注記）", () => {
  it("ウェットは主語がウェット・極性で文が変わる", () => {
    expect(targetConditionNote({ kind: "wet", mode: "exclude" })).toBe("ウェット無効");
    expect(targetConditionNote({ kind: "wet", mode: "only" })).toBe("ウェットのみ・対象外");
  });

  it("style/works は逆引きした表示名を主語にする（生キーは渡さない）", () => {
    expect(targetConditionNote({ kind: "style", mode: "exclude" }, "カブトワリ")).toBe("カブトワリ無効");
    expect(targetConditionNote({ kind: "works", mode: "only" }, "N◎VA市警")).toBe("N◎VA市警のみ・対象外");
  });

  it("表示名が解決できないときは「指定対象」で代替する", () => {
    expect(targetConditionNote({ kind: "style", mode: "exclude" }, "")).toBe("指定対象無効");
  });
});
