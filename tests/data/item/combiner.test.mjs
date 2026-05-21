import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { CombinerDataModel } = await import("../../../scripts/data/item/combiner.mjs");

describe("CombinerDataModel.defineSchema()", () => {
  const schema = CombinerDataModel.defineSchema();

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

  describe("combinedOutfitID フィールドの構造が正しい", () => {
    it("schema.combinedOutfitID が ArrayField(StringField) である", () => {
      expect(schema.combinedOutfitID).toBeInstanceOf(MockArrayField);
      expect(schema.combinedOutfitID.element).toBeInstanceOf(MockStringField);
    });
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slot");
  });

  it("armour 固有フィールドは含まれない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});
