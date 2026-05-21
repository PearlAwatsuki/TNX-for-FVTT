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

const { damageField, attributeField, combatSpeedField } = await import("../../scripts/data/helpers.mjs");

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

  it("14個のサブフィールドを持つ SchemaField を返す", () => {
    const field = attributeField();
    const keys = Object.keys(field.fields);
    expect(keys).toHaveLength(14);
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
      "effectMod", "controlEffectMod",
    ];
    for (const key of expectedKeys) {
      expect(field.fields).toHaveProperty(key);
    }
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
