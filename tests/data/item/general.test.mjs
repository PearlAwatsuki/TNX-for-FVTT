import { describe, it, expect } from "vitest";
import { MockStringField, MockBooleanField, MockSchemaField } from "../../setup.mjs";

const { GeneralDataModel } = await import("../../../scripts/data/item/general.mjs");

describe("GeneralDataModel.defineSchema()", () => {
  const schema = GeneralDataModel.defineSchema();

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

  it("general 固有フィールドは存在しない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slots");
  });
});

describe("GeneralDataModel identificationKey (フェーズ6-0)", () => {
  const schema = GeneralDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("GeneralDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = GeneralDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
