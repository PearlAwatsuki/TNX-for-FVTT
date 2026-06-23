import { describe, it, expect } from "vitest";
import { buildDamageStates, getDamageChartKind, DAMAGE_CATEGORIES } from "../../scripts/data/damage-chart.mjs";
import { CONDITION_KINDS } from "../../scripts/module/conditions.mjs";

describe("ダメージ負傷状態", () => {
  const states = buildDamageStates();

  it("3系統 × 21段 = 63 状態(段0は状態なし)", () => {
    expect(Object.keys(states)).toHaveLength(63);
  });

  it("各状態は label/group/type=wound を持つ", () => {
    for (const [id, def] of Object.entries(states)) {
      expect(typeof def.label, id).toBe("string");
      expect(DAMAGE_CATEGORIES, id).toContain(def.group);
      expect(def.type, id).toBe("wound");
    }
  });

  it("CONDITION_KINDS に統合され、BS→戦闘不能→肉体→精神→社会 の順", () => {
    const keys = Object.keys(CONDITION_KINDS);
    expect(keys[0]).toBe("panic");          // 先頭=BS
    expect(keys).toContain("dead");         // 戦闘不能
    expect(keys).toContain("phys-1");       // 肉体
    // 肉体は戦闘不能より後、精神は肉体より後、社会は精神より後
    expect(keys.indexOf("phys-1")).toBeGreaterThan(keys.indexOf("erased"));
    expect(keys.indexOf("ment-1")).toBeGreaterThan(keys.indexOf("phys-21"));
    expect(keys.indexOf("soc-1")).toBeGreaterThan(keys.indexOf("ment-21"));
  });

  it("inflicts の kind は全て CONDITION_KINDS に存在(降格先も)", () => {
    for (const def of Object.values(states)) {
      for (const inf of (def.inflicts ?? [])) {
        expect(CONDITION_KINDS[inf.kind], inf.kind).toBeDefined();
        if (inf.controlNegate?.downgradeTo) {
          expect(CONDITION_KINDS[inf.controlNegate.downgradeTo]).toBeDefined();
        }
      }
    }
  });

  it("getDamageChartKind: 段クランプ・段0/負値は null", () => {
    expect(getDamageChartKind("physical", 6)).toBe("phys-6");
    expect(getDamageChartKind("physical", 99)).toBe("phys-21"); // 21にクランプ
    expect(getDamageChartKind("mental", 13)).toBe("ment-13");
    expect(getDamageChartKind("social", 21)).toBe("soc-21");
    expect(getDamageChartKind("physical", 0)).toBeNull();        // ダメージなし
    expect(getDamageChartKind("bogus", 5)).toBeNull();
  });

  it("負傷の代表例が正しい(斬首→完全死亡 / 胸部損傷→衰弱 / パニック→重圧(理性))", () => {
    expect(CONDITION_KINDS["phys-16"]).toMatchObject({ label: "斬首", inflicts: [{ kind: "dead" }] });
    expect(CONDITION_KINDS["phys-6"]).toMatchObject({ label: "胸部損傷", inflicts: [{ kind: "weakness" }] });
    expect(CONDITION_KINDS["ment-18"]).toMatchObject({ label: "パニック", inflicts: [{ kind: "pressure", ability: "reason" }] });
  });
});
