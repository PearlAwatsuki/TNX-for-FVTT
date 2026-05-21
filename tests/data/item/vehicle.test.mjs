import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField } from "../../setup.mjs";

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
    it("schema.slot が ArrayField で存在する", () => {
      expect(schema.slot).toBeInstanceOf(MockArrayField);
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

  it("defence フィールドは含まれない", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});
