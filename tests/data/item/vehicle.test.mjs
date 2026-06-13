import { describe, it, expect } from "vitest";
import { MockStringField, MockArrayField, MockBooleanField, MockNumberField, MockSchemaField } from "../../setup.mjs";

const { VehicleDataModel } = await import("../../../scripts/data/item/vehicle.mjs");

describe("VehicleDataModel.defineSchema()", () => {
  const schema = VehicleDataModel.defineSchema();

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

  describe("固有フィールドが存在する", () => {
    const ownFields = ["speedFactor", "passenger", "controlMod"];
    for (const key of ownFields) {
      it(`schema.${key} は NumberField で initial が 0`, () => {
        expect(schema[key]).toBeInstanceOf(MockNumberField);
        expect(schema[key].options.initial).toBe(0);
      });
    }
  });

  describe("attack / defence を持つ (フェーズ6-4)", () => {
    it("schema.attack は SchemaField (攻撃力)", () => {
      expect(schema.attack).toBeInstanceOf(MockSchemaField);
      expect(schema.attack.fields).toHaveProperty("damageType");
    });

    it("schema.defence は SchemaField (S/P/I)", () => {
      expect(schema.defence).toBeInstanceOf(MockSchemaField);
      expect(schema.defence.fields).toHaveProperty("S_defence");
    });
  });
});

describe("VehicleDataModel identificationKey (フェーズ6-0)", () => {
  const schema = VehicleDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("VehicleDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = VehicleDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
