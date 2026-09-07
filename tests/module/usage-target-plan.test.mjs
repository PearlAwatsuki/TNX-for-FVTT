import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { usageTargetGroup, usageCardForm, planUsageTargets } =
  await import("../../scripts/rules/usage-target-plan.mjs");

describe("usageTargetGroup()（対象値の群分け・2026-07-18 決定表）", () => {
  it("「-」「解説参照」「その他」= none（対象という概念がない）", () => {
    for (const t of ["blank", "explanation", "other", "", undefined]) {
      expect(usageTargetGroup(t)).toBe("none");
    }
  });

  it("自身= self / 単体= single（※は保存値が同じ single）", () => {
    expect(usageTargetGroup("self")).toBe("self");
    expect(usageTargetGroup("single")).toBe("single");
  });

  it("チーム/シーン/範囲等= manual", () => {
    for (const t of ["team", "scene", "sceneSelect", "area", "areaSelect"]) {
      expect(usageTargetGroup(t)).toBe("manual");
    }
  });
});

describe("usageCardForm()（カード形式: 対象×対決）", () => {
  it("対決あり×対象なし群= open（オープンリアクション）", () => {
    expect(usageCardForm({ target: "blank", opposed: true })).toBe("open");
    expect(usageCardForm({ target: "explanation", opposed: true })).toBe("open");
    expect(usageCardForm({ target: "other", opposed: true })).toBe("open");
  });

  it("対決あり×対象あり群= targeted（攻撃扱いの対決）", () => {
    expect(usageCardForm({ target: "single", opposed: true })).toBe("targeted");
    expect(usageCardForm({ target: "self", opposed: true })).toBe("targeted");
    expect(usageCardForm({ target: "team", opposed: true })).toBe("targeted");
  });

  it("非対決= plain（普通のカード）", () => {
    for (const t of ["blank", "self", "single", "team", "explanation"]) {
      expect(usageCardForm({ target: t, opposed: false })).toBe("plain");
    }
  });
});

describe("planUsageTargets()（対象解決の決定表）", () => {
  it("対象なし群: レティクルの有無にかかわらず none（読まない）", () => {
    expect(planUsageTargets({ target: "blank" }).mode).toBe("none");
    expect(planUsageTargets({ target: "explanation", targetedOthers: true }).mode).toBe("none");
    expect(planUsageTargets({ target: "other", targetedSelf: true, opposed: true }).mode).toBe("none");
  });

  it("自身: 未ターゲットは常に autoSelf（対決の有無を問わない）", () => {
    expect(planUsageTargets({ target: "self" }).mode).toBe("autoSelf");
    expect(planUsageTargets({ target: "self", opposed: true }).mode).toBe("autoSelf");
  });

  it("自身: ターゲット状態によらず常に autoSelf（2026-07-19 ブロック撤廃・値の意味どおり自分へ読み替え）", () => {
    expect(planUsageTargets({ target: "self", targetedOthers: true }).mode).toBe("autoSelf");
    expect(planUsageTargets({ target: "self", targetedSelf: true, targetedOthers: true }).mode).toBe("autoSelf");
    expect(planUsageTargets({ target: "self", targetedSelf: true }).mode).toBe("autoSelf");
  });

  it("単体×非対決: 未ターゲットは autoSelf", () => {
    expect(planUsageTargets({ target: "single" }).mode).toBe("autoSelf");
  });

  it("単体×対決あり: 未ターゲットは dialog（自動セルフしない）", () => {
    expect(planUsageTargets({ target: "single", opposed: true }).mode).toBe("dialog");
  });

  it("単体: ターゲット中はそのまま targets（数は検証しない）", () => {
    expect(planUsageTargets({ target: "single", targetedOthers: true }).mode).toBe("targets");
    expect(planUsageTargets({ target: "single", targetedOthers: true, opposed: true }).mode).toBe("targets");
    expect(planUsageTargets({ target: "single", targetedSelf: true }).mode).toBe("targets");
  });

  it("「自身に適用できない」: 自動セルフを抑止して dialog", () => {
    expect(planUsageTargets({ target: "single", cannotTargetSelf: true }).mode).toBe("dialog");
    expect(planUsageTargets({ target: "self", cannotTargetSelf: true }).mode).toBe("dialog");
  });

  it("「自身に適用できない」: 明示ターゲットは弾かない（2026-07-19 ブロック撤廃・効果は自動セルフ抑止のみ）", () => {
    expect(planUsageTargets({ target: "single", cannotTargetSelf: true, targetedSelf: true }).mode).toBe("targets");
    expect(planUsageTargets({ target: "team", cannotTargetSelf: true, targetedSelf: true, targetedOthers: true }).mode).toBe("targets");
  });

  it("「自身に適用できない」: 他者のみターゲット中は targets", () => {
    expect(planUsageTargets({ target: "single", cannotTargetSelf: true, targetedOthers: true }).mode).toBe("targets");
  });

  it("チーム/範囲等×対決あり: 未ターゲットは dialog", () => {
    expect(planUsageTargets({ target: "team", opposed: true }).mode).toBe("dialog");
    expect(planUsageTargets({ target: "area", opposed: true }).mode).toBe("dialog");
  });

  it("チーム/範囲等×非対決: 未ターゲットは none（対象要求なし）・ターゲット中は targets", () => {
    expect(planUsageTargets({ target: "team" }).mode).toBe("none");
    expect(planUsageTargets({ target: "scene", targetedOthers: true }).mode).toBe("targets");
  });
});
