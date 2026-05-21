import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { CyborgDataModel } = await import("../../../scripts/data/item/cyborg.mjs");

describe("CyborgDataModel.defineSchema()", () => {
  const schema = CyborgDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });
  });

  describe("defence フィールドの構造が正しい", () => {
    it("schema.defence が SchemaField で存在する", () => {
      expect(schema.defence).toBeInstanceOf(MockSchemaField);
    });

    it("defence に S_defence / P_defence / I_defence が存在する", () => {
      expect(schema.defence.fields).toHaveProperty("S_defence");
      expect(schema.defence.fields).toHaveProperty("P_defence");
      expect(schema.defence.fields).toHaveProperty("I_defence");
    });

    it("defence の各フィールドは NumberField で initial が 0", () => {
      for (const key of ["S_defence", "P_defence", "I_defence"]) {
        expect(schema.defence.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.defence.fields[key].options.initial).toBe(0);
      }
    });
  });

  describe("attack フィールドの構造が正しい", () => {
    it("schema.attack が SchemaField で存在する", () => {
      expect(schema.attack).toBeInstanceOf(MockSchemaField);
    });

    it("attack.damageType は ArrayField(StringField) である", () => {
      expect(schema.attack.fields.damageType).toBeInstanceOf(MockArrayField);
      expect(schema.attack.fields.damageType.element).toBeInstanceOf(MockStringField);
    });

    it("attack.value は NumberField で initial が 0", () => {
      expect(schema.attack.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.value.options.initial).toBe(0);
    });

    it("attack.mod は NumberField で initial が 0", () => {
      expect(schema.attack.fields.mod).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.mod.options.initial).toBe(0);
    });
  });

  it("schema.guardValue は NumberField で initial が 0", () => {
    expect(schema.guardValue).toBeInstanceOf(MockNumberField);
    expect(schema.guardValue.options.initial).toBe(0);
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slot");
  });
});
