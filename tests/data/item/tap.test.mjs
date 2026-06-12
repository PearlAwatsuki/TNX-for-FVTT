import { describe, it, expect } from "vitest";
import { MockStringField, MockArrayField, MockBooleanField, MockNumberField, MockSchemaField } from "../../setup.mjs";

const { TapDataModel } = await import("../../../scripts/data/item/tap.mjs");

describe("TapDataModel.defineSchema()", () => {
  const schema = TapDataModel.defineSchema();

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
    it("schema.slot が ArrayField で存在する", () => {
      expect(schema.slot).toBeInstanceOf(MockArrayField);
    });
  });

  it("schema.cycle は NumberField で initial が 0", () => {
    expect(schema.cycle).toBeInstanceOf(MockNumberField);
    expect(schema.cycle.options.initial).toBe(0);
  });

  describe("KI-007: combatSpeedMod の綴り確認", () => {
    it("schema.combatSpeedMod(正しい綴り)が NumberField で存在する", () => {
      expect(schema.combatSpeedMod).toBeInstanceOf(MockNumberField);
      expect(schema.combatSpeedMod.options.initial).toBe(0);
    });

    it("schema.conbatSpeedMod(タイポ)は存在しない", () => {
      expect(schema).not.toHaveProperty("conbatSpeedMod");
    });
  });

  it("attack フィールドは含まれない(weapon 固有)", () => {
    expect(schema).not.toHaveProperty("attack");
  });
});

describe("TapDataModel identificationKey (フェーズ6-0)", () => {
  const schema = TapDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("TapDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = TapDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
