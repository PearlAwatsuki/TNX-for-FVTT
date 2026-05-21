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

const { damageField } = await import("../../scripts/data/helpers.mjs");

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
