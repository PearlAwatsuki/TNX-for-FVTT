import { describe, it, expect } from "vitest";
import { DAMAGE_CHART, DAMAGE_CATEGORIES, getDamageChartResult } from "../../scripts/data/damage-chart.mjs";
import { CONDITION_KINDS } from "../../scripts/module/conditions.mjs";

describe("ダメージチャート定義", () => {
  it("3系統とも 0〜21 の 22 段を持つ", () => {
    for (const cat of DAMAGE_CATEGORIES) {
      expect(DAMAGE_CHART[cat]).toHaveLength(22);
    }
  });

  it("全セルが name を持ち、conditions は配列", () => {
    for (const cat of DAMAGE_CATEGORIES) {
      for (const cell of DAMAGE_CHART[cat]) {
        expect(typeof cell.name).toBe("string");
        expect(Array.isArray(cell.conditions)).toBe(true);
      }
    }
  });

  it("付与する条件の kind は全て CONDITION_KINDS に存在する", () => {
    for (const cat of DAMAGE_CATEGORIES) {
      for (const cell of DAMAGE_CHART[cat]) {
        for (const c of cell.conditions) {
          expect(CONDITION_KINDS[c.kind], `${cat} ${cell.name}: ${c.kind}`).toBeDefined();
        }
      }
    }
  });

  it("controlNegate.downgradeTo も有効な kind", () => {
    for (const cat of DAMAGE_CATEGORIES) {
      for (const cell of DAMAGE_CHART[cat]) {
        for (const c of cell.conditions) {
          if (c.controlNegate?.downgradeTo) {
            expect(CONDITION_KINDS[c.controlNegate.downgradeTo]).toBeDefined();
          }
        }
      }
    }
  });

  it("getDamageChartResult はクランプして返す(段は min(value,21))", () => {
    expect(getDamageChartResult("physical", 6).name).toBe("胸部損傷");
    expect(getDamageChartResult("physical", 16).name).toBe("斬首");
    expect(getDamageChartResult("physical", 99).name).toBe("頭部損傷"); // 21段にクランプ
    expect(getDamageChartResult("mental", 0).name).toBe("ダメージなし");
    expect(getDamageChartResult("social", 11).conditions[0].kind).toBe("erased");
    expect(getDamageChartResult("bogus", 5)).toBeNull();
  });

  it("重圧の対象能力値指定(パニック=理性/感情消失=感情/権力剥奪=外界)", () => {
    expect(getDamageChartResult("mental", 18).conditions[0]).toMatchObject({ kind: "pressure", ability: "reason" });
    expect(getDamageChartResult("mental", 19).conditions[0]).toMatchObject({ kind: "pressure", ability: "passion" });
    expect(getDamageChartResult("social", 18).conditions[0]).toMatchObject({ kind: "pressure", ability: "mundane" });
  });
});
