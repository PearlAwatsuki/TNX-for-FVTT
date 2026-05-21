import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField } from "../../setup.mjs";

const { defenceField } = await import("../../../scripts/data/item/helpers.mjs");

describe("defenceField()", () => {
  it("呼び出せる", () => {
    expect(defenceField).toBeDefined();
  });

  it("SchemaField を返す", () => {
    expect(defenceField()).toBeInstanceOf(MockSchemaField);
  });

  it("S_defence / P_defence / I_defence の 3 フィールドを持つ", () => {
    const field = defenceField();
    expect(field.fields).toHaveProperty("S_defence");
    expect(field.fields).toHaveProperty("P_defence");
    expect(field.fields).toHaveProperty("I_defence");
  });

  it("各フィールドは NumberField で initial が 0", () => {
    const field = defenceField();
    for (const key of ["S_defence", "P_defence", "I_defence"]) {
      expect(field.fields[key]).toBeInstanceOf(MockNumberField);
      expect(field.fields[key].options.initial).toBe(0);
    }
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(defenceField()).not.toBe(defenceField());
  });
});
