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

  describe("使用回数(uses)の構造が正しい(2026-07-18 汎用 uses へ一本化)", () => {
    it("schema.uses が SchemaField で存在し、usageCount は廃止", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema).not.toHaveProperty("usageCount");
    });

    it("uses に isLimit / type / max / spent が存在する", () => {
      for (const k of ["isLimit", "type", "max", "spent"]) expect(schema.uses.fields).toHaveProperty(k);
    });

    it("uses.isLimit は既定 true(神業は常に母数を持つ)・max 既定 1・spent 既定 0", () => {
      expect(schema.uses.fields.isLimit).toBeInstanceOf(MockBooleanField);
      expect(schema.uses.fields.isLimit.options.initial).toBe(true);
      expect(schema.uses.fields.max).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.max.options.initial).toBe(1);
      expect(schema.uses.fields.spent.options.initial).toBe(0);
    });
  });

  describe("migrateData(): 旧 usageCount → uses への移行", () => {
    it("value=母数/total=残り/mod=バフ → max=value+mod・spent=max−total", () => {
      const src = MiracleDataModel.migrateData({ usageCount: { value: 2, total: 1, mod: 1 } });
      expect(src.uses.max).toBe(3);        // 2 + 1
      expect(src.uses.spent).toBe(2);      // 3 − 1(残り)
      expect(src.uses.isLimit).toBe(true);
    });

    it("uses が既にあれば移行しない", () => {
      const src = MiracleDataModel.migrateData({ uses: { isLimit: true, max: 5, spent: 2 }, usageCount: { value: 1, total: 1, mod: 0 } });
      expect(src.uses).toEqual({ isLimit: true, max: 5, spent: 2 });
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
