import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { MiracleDataModel } = await import("../../../scripts/data/item/miracle.mjs");

describe("MiracleDataModel.defineSchema()", () => {
  const schema = MiracleDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("UsageTemplate のフィールドが含まれる", () => {
    it("schema.actions が ArrayField で存在する", () => {
      expect(schema.actions).toBeInstanceOf(MockArrayField);
    });

    it("actions の要素は SchemaField で type/name/description を持つ", () => {
      expect(schema.actions.element).toBeInstanceOf(MockSchemaField);
      expect(schema.actions.element.fields).toHaveProperty("type");
      expect(schema.actions.element.fields).toHaveProperty("name");
      expect(schema.actions.element.fields).toHaveProperty("description");
    });
  });

  describe("String フィールドの初期値", () => {
    it("schema.furigana は StringField で initial が ''", () => {
      expect(schema.furigana).toBeInstanceOf(MockStringField);
      expect(schema.furigana.options.initial).toBe("");
    });

    it("schema.usageCondition は StringField で initial が ''", () => {
      expect(schema.usageCondition).toBeInstanceOf(MockStringField);
      expect(schema.usageCondition.options.initial).toBe("");
    });
  });

  describe("Boolean フィールドが BooleanField で initial false", () => {
    for (const key of ["isKill", "isDefence", "isAll", "isUsed"]) {
      it(`schema.${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }
  });

  describe("usageCount の構造が正しい", () => {
    it("schema.usageCount が SchemaField で存在する", () => {
      expect(schema.usageCount).toBeInstanceOf(MockSchemaField);
    });

    it("usageCount に value / total / mod が存在する", () => {
      expect(schema.usageCount.fields).toHaveProperty("value");
      expect(schema.usageCount.fields).toHaveProperty("total");
      expect(schema.usageCount.fields).toHaveProperty("mod");
    });

    it("usageCount.value は NumberField で initial が 1(0 ではない)", () => {
      expect(schema.usageCount.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.usageCount.fields.value.options.initial).toBe(1);
    });

    it("usageCount.total は NumberField で initial が 1(0 ではない)", () => {
      expect(schema.usageCount.fields.total).toBeInstanceOf(MockNumberField);
      expect(schema.usageCount.fields.total.options.initial).toBe(1);
    });

    it("usageCount.mod は NumberField で initial が 0", () => {
      expect(schema.usageCount.fields.mod).toBeInstanceOf(MockNumberField);
      expect(schema.usageCount.fields.mod.options.initial).toBe(0);
    });
  });

  describe("miracle に含まれないフィールド", () => {
    it("skillBase 由来の level が含まれない", () => {
      expect(schema).not.toHaveProperty("level");
    });

    it("skillBase 由来の suits が含まれない", () => {
      expect(schema).not.toHaveProperty("suits");
    });

    it("outfitBase 由来の isPrepared が含まれない", () => {
      expect(schema).not.toHaveProperty("isPrepared");
    });
  });
});
