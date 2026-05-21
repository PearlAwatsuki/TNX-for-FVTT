import { describe, it, expect } from "vitest";
import { MockBooleanField, MockNumberField, MockSchemaField } from "../../setup.mjs";

const { ArmorDataModel } = await import("../../../scripts/data/item/armor.mjs");

describe("ArmorDataModel.defineSchema()", () => {
  const schema = ArmorDataModel.defineSchema();

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
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema.uses.fields).toHaveProperty("isLimit");
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

  it("schema.controlMod は NumberField で initial が 0", () => {
    expect(schema.controlMod).toBeInstanceOf(MockNumberField);
    expect(schema.controlMod.options.initial).toBe(0);
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slot");
  });

  it("cyborg 固有フィールドは含まれない(attack が含まれない)", () => {
    expect(schema).not.toHaveProperty("attack");
  });
});
