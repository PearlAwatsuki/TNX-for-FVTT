import { describe, it, expect } from "vitest";
import { MockBooleanField, MockSchemaField, MockStringField } from "../../setup.mjs";

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

  describe("combine フィールドの構造が正しい(フェーズ6-4)", () => {
    it("schema.combine は SchemaField で source1/source2/appearance を持つ", () => {
      expect(schema.combine).toBeInstanceOf(MockSchemaField);
      expect(schema.combine.fields.source1).toBeInstanceOf(MockStringField);
      expect(schema.combine.fields.source2).toBeInstanceOf(MockStringField);
      expect(schema.combine.fields.appearance).toBeInstanceOf(MockStringField);
    });

    it("appearance は initial '1'、choices は 1/2", () => {
      expect(schema.combine.fields.appearance.options.initial).toBe("1");
      expect(schema.combine.fields.appearance.options.choices).toEqual(["1", "2"]);
    });

    it("旧 combinedOutfitID は持たない", () => {
      expect(schema).not.toHaveProperty("combinedOutfitID");
    });
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slots");
  });

  it("armour 固有フィールドは含まれない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});

describe("CombinerDataModel identificationKey (フェーズ6-0)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("CombinerDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
