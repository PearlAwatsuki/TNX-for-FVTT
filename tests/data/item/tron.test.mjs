import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockSchemaField } from "../../setup.mjs";

const { TronDataModel } = await import("../../../scripts/data/item/tron.mjs");

describe("TronDataModel.defineSchema()", () => {
  const schema = TronDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が BooleanField で存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });
  });

  describe("ExtensibleTemplate のフィールドが含まれる", () => {
    it("schema.slot が ArrayField で存在する", () => {
      expect(schema.slot).toBeInstanceOf(MockArrayField);
    });
  });

  it("tron 固有フィールドは存在しない(controlMod が含まれない)", () => {
    expect(schema).not.toHaveProperty("controlMod");
  });

  it("tron 固有フィールドは存在しない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});
