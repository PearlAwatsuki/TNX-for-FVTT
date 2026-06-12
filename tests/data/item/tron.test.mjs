import { describe, it, expect } from "vitest";
import { MockStringField, MockArrayField, MockBooleanField, MockSchemaField } from "../../setup.mjs";

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
    it("schema.slots が ArrayField で存在する", () => {
      expect(schema.slots).toBeInstanceOf(MockArrayField);
    });
  });

  it("tron 固有フィールドは存在しない(controlMod が含まれない)", () => {
    expect(schema).not.toHaveProperty("controlMod");
  });

  it("tron 固有フィールドは存在しない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});

describe("TronDataModel identificationKey (フェーズ6-0)", () => {
  const schema = TronDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("TronDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = TronDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
