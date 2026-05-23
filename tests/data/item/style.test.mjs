import { describe, it, expect } from "vitest";
import { MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { StyleDataModel } = await import("../../../scripts/data/item/style.mjs");

describe("StyleDataModel.defineSchema()", () => {
  const schema = StyleDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("Boolean フィールド", () => {
    it("schema.isPersona は BooleanField で initial が false", () => {
      expect(schema.isPersona).toBeInstanceOf(MockBooleanField);
      expect(schema.isPersona.options.initial).toBe(false);
    });

    it("schema.isKey は BooleanField で initial が false", () => {
      expect(schema.isKey).toBeInstanceOf(MockBooleanField);
      expect(schema.isKey.options.initial).toBe(false);
    });
  });

  describe("level フィールド", () => {
    it("schema.level は NumberField で initial が 1(0 ではない)", () => {
      expect(schema.level).toBeInstanceOf(MockNumberField);
      expect(schema.level.options.initial).toBe(1);
    });
  });

  describe("miracle フィールドの構造", () => {
    it("schema.miracle が SchemaField で存在する", () => {
      expect(schema.miracle).toBeInstanceOf(MockSchemaField);
    });

    it("miracle に name / id が存在する", () => {
      expect(schema.miracle.fields).toHaveProperty("name");
      expect(schema.miracle.fields).toHaveProperty("id");
    });

    it("miracle.name は StringField で initial が ''", () => {
      expect(schema.miracle.fields.name).toBeInstanceOf(MockStringField);
      expect(schema.miracle.fields.name.options.initial).toBe("");
    });

    it("miracle.id は StringField で initial が ''", () => {
      expect(schema.miracle.fields.id).toBeInstanceOf(MockStringField);
      expect(schema.miracle.fields.id.options.initial).toBe("");
    });
  });

  describe("能力値フィールド(reason / passion / life / mundane)の構造", () => {
    for (const key of ["reason", "passion", "life", "mundane"]) {
      describe(`schema.${key}`, () => {
        it(`${key} が SchemaField で存在する`, () => {
          expect(schema[key]).toBeInstanceOf(MockSchemaField);
        });

        it(`${key} に value / control が存在する`, () => {
          expect(schema[key].fields).toHaveProperty("value");
          expect(schema[key].fields).toHaveProperty("control");
        });

        it(`${key}.value は NumberField で initial が 0`, () => {
          expect(schema[key].fields.value).toBeInstanceOf(MockNumberField);
          expect(schema[key].fields.value.options.initial).toBe(0);
        });

        it(`${key}.control は NumberField で initial が 0`, () => {
          expect(schema[key].fields.control).toBeInstanceOf(MockNumberField);
          expect(schema[key].fields.control.options.initial).toBe(0);
        });
      });
    }
  });

  describe("style に含まれないフィールド", () => {
    it("usage 由来の actions が含まれない", () => {
      expect(schema).not.toHaveProperty("actions");
    });

    it("skillBase 由来の suits が含まれない", () => {
      expect(schema).not.toHaveProperty("suits");
    });

    it("outfitBase 由来の isPrepared が含まれない", () => {
      expect(schema).not.toHaveProperty("isPrepared");
    });
  });
});
