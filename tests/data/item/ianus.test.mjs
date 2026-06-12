import { describe, it, expect } from "vitest";
import { MockStringField, MockArrayField, MockBooleanField, MockNumberField, MockSchemaField } from "../../setup.mjs";

const { IanusDataModel } = await import("../../../scripts/data/item/ianus.mjs");

describe("IanusDataModel.defineSchema()", () => {
  const schema = IanusDataModel.defineSchema();

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
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema.uses.fields).toHaveProperty("isLimit");
    });
  });

  describe("ExtensibleTemplate のフィールドが含まれる", () => {
    it("schema.slots が ArrayField で存在する", () => {
      expect(schema.slots).toBeInstanceOf(MockArrayField);
    });
  });

  it("schema.controlMod は NumberField で initial が 0", () => {
    expect(schema.controlMod).toBeInstanceOf(MockNumberField);
    expect(schema.controlMod.options.initial).toBe(0);
  });

  it("defence フィールドは含まれない", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});

describe("IanusDataModel identificationKey (フェーズ6-0)", () => {
  const schema = IanusDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("IanusDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = IanusDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
