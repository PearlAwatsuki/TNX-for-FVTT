import { describe, it, expect } from "vitest";
import { MockBooleanField, MockStringField, MockNumberField, MockSchemaField } from "../../../setup.mjs";

const { OutfitBaseTemplate } = await import("../../../../scripts/data/item/common/outfit-base.mjs");

describe("OutfitBaseTemplate.defineSchema()", () => {
  const schema = OutfitBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("Boolean フィールドが正しい", () => {
    it("isPrepared は BooleanField で initial が true", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it('"isPre-play" は BooleanField で initial が false (ハイフン含みキー)', () => {
      expect(schema).toHaveProperty("isPre-play");
      expect(schema["isPre-play"]).toBeInstanceOf(MockBooleanField);
      expect(schema["isPre-play"].options.initial).toBe(false);
    });

    for (const key of ["isOption", "isCyber"]) {
      it(`${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }
  });

  describe("StringField (初期値 '-') フィールドが正しい", () => {
    const stringFields = [
      "majorCategory", "minorCategory", "buy", "preserveExp",
      "hide", "appearancePenalty", "hack", "part", "timing", "exclusive",
    ];
    for (const key of stringFields) {
      it(`${key} は StringField で initial が '-'`, () => {
        expect(schema[key]).toBeInstanceOf(MockStringField);
        expect(schema[key].options.initial).toBe("-");
      });
    }
  });

  describe("uses (SchemaField) の構造が正しい", () => {
    it("uses は SchemaField である", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });

    it("uses に isLimit / max / value が存在する", () => {
      expect(schema.uses.fields).toHaveProperty("isLimit");
      expect(schema.uses.fields).toHaveProperty("max");
      expect(schema.uses.fields).toHaveProperty("value");
    });

    it("uses.isLimit は BooleanField で initial が false", () => {
      expect(schema.uses.fields.isLimit).toBeInstanceOf(MockBooleanField);
      expect(schema.uses.fields.isLimit.options.initial).toBe(false);
    });

    it("uses.max は NumberField で initial が 0", () => {
      expect(schema.uses.fields.max).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.max.options.initial).toBe(0);
    });

    it("uses.value は NumberField で initial が 0", () => {
      expect(schema.uses.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.value.options.initial).toBe(0);
    });
  });
});
