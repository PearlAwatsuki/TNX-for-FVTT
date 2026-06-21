import { describe, it, expect } from "vitest";

// foundry グローバルのモック(helpers.mjs が使うフィールド型のみ)
class MockNumberField {
  constructor(options = {}) { this.options = options; }
}
class MockSchemaField {
  constructor(fields) { this.fields = fields; }
}

globalThis.foundry = {
  data: {
    fields: {
      NumberField: MockNumberField,
      SchemaField: MockSchemaField,
    },
  },
};

const { damageField, attributeField, combatSpeedField, computeAttributeFinal, computeOutfitAggregates } = await import("../../scripts/data/helpers.mjs");

describe("damageField()", () => {
  it("呼び出せる", () => {
    expect(() => damageField()).not.toThrow();
  });

  it("value / min / max のフィールドを持つ SchemaField を返す", () => {
    const field = damageField();
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).toHaveProperty("min");
    expect(field.fields).toHaveProperty("max");
  });

  it("value / min / max はすべて NumberField である", () => {
    const field = damageField();
    expect(field.fields.value).toBeInstanceOf(MockNumberField);
    expect(field.fields.min).toBeInstanceOf(MockNumberField);
    expect(field.fields.max).toBeInstanceOf(MockNumberField);
  });

  it("各 NumberField の initial は 0 である", () => {
    const field = damageField();
    expect(field.fields.value.options.initial).toBe(0);
    expect(field.fields.min.options.initial).toBe(0);
    expect(field.fields.max.options.initial).toBe(0);
  });
});

describe("attributeField()", () => {
  it("呼び出せる", () => {
    expect(() => attributeField()).not.toThrow();
  });

  it("12個のサブフィールドを持つ SchemaField を返す(v2: effectMod 2 種を廃止)", () => {
    const field = attributeField();
    const keys = Object.keys(field.fields);
    expect(keys).toHaveLength(12);
  });

  it("期待されるすべてのキーが存在する", () => {
    const field = attributeField();
    const expectedKeys = [
      "value", "control",
      "styleA_value", "styleA_control",
      "styleB_value", "styleB_control",
      "styleC_value", "styleC_control",
      "growth", "controlGrowth",
      "mod", "controlMod",
    ];
    for (const key of expectedKeys) {
      expect(field.fields).toHaveProperty(key);
    }
    // v2: effectMod / controlEffectMod は廃止(バフは適用パスが total へ直接)
    expect(field.fields).not.toHaveProperty("effectMod");
    expect(field.fields).not.toHaveProperty("controlEffectMod");
  });

  it("各フィールドは NumberField で initial が 0", () => {
    const field = attributeField();
    for (const f of Object.values(field.fields)) {
      expect(f).toBeInstanceOf(MockNumberField);
      expect(f.options.initial).toBe(0);
    }
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(attributeField()).not.toBe(attributeField());
  });
});

describe("combatSpeedField()", () => {
  it("呼び出せる", () => {
    expect(() => combatSpeedField()).not.toThrow();
  });

  it("value / base / current / mod / freeMod を持つ SchemaField を返す", () => {
    const field = combatSpeedField();
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).toHaveProperty("base");
    expect(field.fields).toHaveProperty("current");
    expect(field.fields).toHaveProperty("mod");
    expect(field.fields).toHaveProperty("freeMod");
  });

  it("各フィールドは NumberField で initial が 0", () => {
    const field = combatSpeedField();
    for (const f of Object.values(field.fields)) {
      expect(f).toBeInstanceOf(MockNumberField);
      expect(f.options.initial).toBe(0);
    }
  });
});

// ─── computeAttributeFinal ────────────────────────────────────────────────────
// 能力値・制御値の最終実効値の一本化(フェーズ9-1)。
// 実効値 = growth + Σ(スタイル基本値 × レベル) + mod + effectMod + outfitMod、最終 0clamp。

describe("computeAttributeFinal()", () => {
  const ability = {
    growth: 2, mod: 1, effectMod: 0,
    controlGrowth: 3, controlMod: 0, controlEffectMod: 0,
  };

  it("スタイル1つ・レベル1の合算", () => {
    const r = computeAttributeFinal(ability, [{ value: 4, control: 5, level: 1 }]);
    expect(r.total).toBe(2 + 4 + 1 + 0);        // growth + style + mod + effectMod
    expect(r.totalControl).toBe(3 + 5 + 0 + 0); // controlGrowth + styleControl + ...
  });

  it("スタイルレベルで基本値を倍化する", () => {
    const r = computeAttributeFinal(ability, [{ value: 4, control: 5, level: 2 }]);
    expect(r.total).toBe(2 + 4 * 2 + 1);
    expect(r.totalControl).toBe(3 + 5 * 2);
  });

  it("複数スタイルを合算する", () => {
    const styles = [
      { value: 4, control: 1, level: 1 },
      { value: 2, control: 3, level: 2 },
    ];
    const r = computeAttributeFinal(ability, styles);
    expect(r.total).toBe(2 + (4 + 2 * 2) + 1);
    expect(r.totalControl).toBe(3 + (1 + 3 * 2));
  });

  it("outfitMod を能力値・制御値それぞれに加算する", () => {
    const r = computeAttributeFinal(ability, [{ value: 4, control: 5, level: 1 }], 3, 7);
    expect(r.total).toBe(2 + 4 + 1 + 3);
    expect(r.totalControl).toBe(3 + 5 + 7);
  });

  it("effectMod は無視する(v2: バフは適用パスが total へ直接効かせる)", () => {
    const ab = { ...ability, effectMod: 5, controlEffectMod: -1 };
    const r = computeAttributeFinal(ab, [{ value: 0, control: 0, level: 1 }]);
    expect(r.total).toBe(2 + 0 + 1);        // effectMod 5 は含まれない
    expect(r.totalControl).toBe(3 + 0 + 0); // controlEffectMod -1 も含まれない
  });

  it("負値もそのまま返す(0clamp は適用パス後に行うため computeAttributeFinal では clamp しない)", () => {
    const ab = { growth: 0, mod: -10, controlGrowth: 0, controlMod: -10 };
    const r = computeAttributeFinal(ab, [{ value: 1, control: 1, level: 1 }]);
    expect(r.total).toBe(-9);
    expect(r.totalControl).toBe(-9);
  });

  it("スタイルなしでも算出できる", () => {
    const r = computeAttributeFinal(ability, []);
    expect(r.total).toBe(2 + 1);
    expect(r.totalControl).toBe(3);
  });

  it("欠落フィールドは 0 として扱う", () => {
    const r = computeAttributeFinal({}, [{ value: 4, level: 1 }]);
    expect(r.total).toBe(4);
    expect(r.totalControl).toBe(0);
  });

  it("level 未指定は 1 とみなす", () => {
    const r = computeAttributeFinal({}, [{ value: 4, control: 2 }]);
    expect(r.total).toBe(4);
    expect(r.totalControl).toBe(2);
  });
});

// ─── computeOutfitAggregates ──────────────────────────────────────────────────
// 携帯中アウトフィットからの outfitMod(制御値・CS修正)・危険値の集計(フェーズ9-2, B-2)。

describe("computeOutfitAggregates()", () => {
  const outfit = (type, system) => ({ type, system });
  const ctrl   = (v) => ({ mode: "value", value: v });

  it("準備済み・携帯中の制御値修正を合算する", () => {
    const items = [
      outfit("armor", { isCarrying: true, isPrepared: true, controlMod: ctrl(2) }),
      outfit("cyborg", { isCarrying: true, isPrepared: true, controlMod: ctrl(3) }),
    ];
    expect(computeOutfitAggregates(items).control).toBe(5);
  });

  it("未準備(isPrepared=false)の制御値修正は加算しない", () => {
    const items = [outfit("armor", { isCarrying: true, isPrepared: false, controlMod: ctrl(2) })];
    expect(computeOutfitAggregates(items).control).toBe(0);
  });

  it("非携帯(isCarrying=false)はすべて無視する", () => {
    const items = [outfit("armor", {
      isCarrying: false, isPrepared: true,
      controlMod: ctrl(2), combatSpeedMod: ctrl(2), appearancePenalty: ctrl(2),
    })];
    expect(computeOutfitAggregates(items)).toEqual({ control: 0, combatSpeed: 0, appearance: 0 });
  });

  it("CS修正は isPrepared を問わず携帯中なら合算する(tap 等)", () => {
    const items = [outfit("tap", { isCarrying: true, isPrepared: false, combatSpeedMod: ctrl(4) })];
    expect(computeOutfitAggregates(items).combatSpeed).toBe(4);
  });

  it("ゴースト登場中(isGhost)は CS修正を無効化する", () => {
    const items = [outfit("tap", { isCarrying: true, isPrepared: true, combatSpeedMod: ctrl(4) })];
    expect(computeOutfitAggregates(items, true).combatSpeed).toBe(0);
    expect(computeOutfitAggregates(items, false).combatSpeed).toBe(4);
  });

  it("危険値(appearancePenalty)を携帯中で合算する", () => {
    const items = [
      outfit("weapon", { isCarrying: true, appearancePenalty: ctrl(1) }),
      outfit("armor",  { isCarrying: true, appearancePenalty: ctrl(2) }),
    ];
    expect(computeOutfitAggregates(items).appearance).toBe(3);
  });

  it("mode が value でない修正は加算しない", () => {
    const items = [outfit("armor", {
      isCarrying: true, isPrepared: true,
      controlMod: { mode: "none", value: 9 },
      appearancePenalty: { mode: "none", value: 9 },
    })];
    expect(computeOutfitAggregates(items)).toEqual({ control: 0, combatSpeed: 0, appearance: 0 });
  });

  it("アウトフィット以外の type は集計対象外", () => {
    const items = [outfit("style", { isCarrying: true, isPrepared: true, controlMod: ctrl(5) })];
    expect(computeOutfitAggregates(items).control).toBe(0);
  });
});
