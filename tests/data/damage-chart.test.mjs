import { describe, it, expect } from "vitest";
import { buildDamageStates, getDamageChartKind, DAMAGE_CATEGORIES } from "../../scripts/data/damage-chart.mjs";
import { CONDITION_KINDS, buildInflictedEffectsData } from "../../scripts/module/conditions.mjs";

const SCOPE = "tokyo-nova-axleration";

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

describe("buildInflictedEffectsData()（カスケード生成データ）", () => {
  it("斬首→完全死亡: status のみ・hideFromList・changes なし", () => {
    const [d] = buildInflictedEffectsData("phys-16");
    expect(d.statuses).toEqual(["dead"]);
    expect(d.changes).toBeUndefined();               // コンディション=状態のみ
    expect(d.flags[SCOPE].hideFromList).toBe(true);  // ダメージ由来=非表示
    expect(d.flags[SCOPE].conditionKind).toBe("dead");
  });

  it("パニック→重圧: targetAbility=理性 をフラグに乗せる", () => {
    const [d] = buildInflictedEffectsData("ment-18");
    expect(d.statuses).toEqual(["pressure"]);
    expect(d.flags[SCOPE].conditions.pressure.targetAbility).toBe("reason");
  });

  it("腹部損傷→気絶: controlNegate を pendingControlNegate で保持(当面はそのまま付与)", () => {
    const [d] = buildInflictedEffectsData("phys-10");
    expect(d.statuses).toEqual(["faint"]);
    expect(d.flags[SCOPE].conditions.faint.pendingControlNegate).toEqual({ ability: "life" });
  });

  it("心臓停止→仮死: 降格先も保持", () => {
    const [d] = buildInflictedEffectsData("phys-11");
    expect(d.flags[SCOPE].conditions.coma.pendingControlNegate).toEqual({ ability: "life", downgradeTo: "faint" });
  });

  it("硬直→恐慌＋狼狽: 2件", () => {
    const ds = buildInflictedEffectsData("ment-13");
    expect(ds.map(d => d.statuses[0])).toEqual(["panic", "confusion"]);
  });

  it("inflicts を持たない状態は空配列", () => {
    expect(buildInflictedEffectsData("phys-1")).toEqual([]);
    expect(buildInflictedEffectsData("dead")).toEqual([]);
    expect(buildInflictedEffectsData("weakness")).toEqual([]);
  });

  it("hidden:false で表示扱い(技能由来など)", () => {
    const [d] = buildInflictedEffectsData("phys-16", { hidden: false });
    expect(d.flags[SCOPE].hideFromList).toBe(false);
  });
});
