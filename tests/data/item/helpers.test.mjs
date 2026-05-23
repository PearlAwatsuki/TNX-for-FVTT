import { describe, it, expect } from "vitest";
import { MockArrayField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { defenceField, attackField } = await import("../../../scripts/data/item/helpers.mjs");

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

describe("attackField()", () => {
  it("呼び出せる", () => {
    expect(attackField).toBeDefined();
  });

  it("SchemaField を返す", () => {
    expect(attackField()).toBeInstanceOf(MockSchemaField);
  });

  it("damageType / value / mod の 3 フィールドを持つ", () => {
    const field = attackField();
    expect(field.fields).toHaveProperty("damageType");
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).toHaveProperty("mod");
  });

  it("damageType は ArrayField(StringField) である", () => {
    const field = attackField();
    expect(field.fields.damageType).toBeInstanceOf(MockArrayField);
    expect(field.fields.damageType.element).toBeInstanceOf(MockStringField);
  });

  it("value は NumberField で initial が 0", () => {
    const field = attackField();
    expect(field.fields.value).toBeInstanceOf(MockNumberField);
    expect(field.fields.value.options.initial).toBe(0);
  });

  it("mod は NumberField で initial が 0", () => {
    const field = attackField();
    expect(field.fields.mod).toBeInstanceOf(MockNumberField);
    expect(field.fields.mod.options.initial).toBe(0);
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(attackField()).not.toBe(attackField());
  });
});
