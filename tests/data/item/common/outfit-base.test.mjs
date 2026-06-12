import { describe, it, expect } from "vitest";
import { MockBooleanField, MockStringField, MockNumberField, MockSchemaField } from "../../../setup.mjs";

const { OutfitBaseTemplate } = await import("../../../../scripts/data/item/common/outfit-base.mjs");
const { getMajorCategoryChoices, getMinorCategoryChoices } =
  await import("../../../../scripts/data/item/outfit-categories.mjs");

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

    for (const key of ["isOption", "isCyber", "isCarrying"]) {
      it(`${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }
  });

  describe("StringField (初期値 '-') フィールドが正しい", () => {
    const stringFields = ["hack", "part", "timing", "exclusive"];
    for (const key of stringFields) {
      it(`${key} は StringField で initial が '-'`, () => {
        expect(schema[key]).toBeInstanceOf(MockStringField);
        expect(schema[key].options.initial).toBe("-");
      });
    }
  });

  describe("カテゴリフィールド (choices 付き) が正しい", () => {
    it("majorCategory は StringField で initial が空文字・blank 許容", () => {
      expect(schema.majorCategory).toBeInstanceOf(MockStringField);
      expect(schema.majorCategory.options.initial).toBe("");
      expect(schema.majorCategory.options.blank).toBe(true);
    });

    it("majorCategory の choices は大分類リストを返す関数", () => {
      expect(schema.majorCategory.options.choices).toBe(getMajorCategoryChoices);
    });

    it("minorCategory は StringField で initial が空文字・blank 許容", () => {
      expect(schema.minorCategory).toBeInstanceOf(MockStringField);
      expect(schema.minorCategory.options.initial).toBe("");
      expect(schema.minorCategory.options.blank).toBe(true);
    });

    it("minorCategory の choices は小分類リストを返す関数", () => {
      expect(schema.minorCategory.options.choices).toBe(getMinorCategoryChoices);
    });
  });

  describe("buy / hide (3 状態 SchemaField) が正しい", () => {
    for (const key of ["buy", "hide"]) {
      it(`${key} は SchemaField である`, () => {
        expect(schema[key]).toBeInstanceOf(MockSchemaField);
      });

      it(`${key}.mode は StringField で initial が 'none'、choices は none/value/reference`, () => {
        expect(schema[key].fields.mode).toBeInstanceOf(MockStringField);
        expect(schema[key].fields.mode.options.initial).toBe("none");
        expect(schema[key].fields.mode.options.choices).toEqual(["none", "value", "reference"]);
      });

      it(`${key}.value は NumberField で initial が 0`, () => {
        expect(schema[key].fields.value).toBeInstanceOf(MockNumberField);
        expect(schema[key].fields.value.options.initial).toBe(0);
      });
    }
  });

  describe("数値フィールドが正しい", () => {
    it("preserveExp は NumberField で initial が 0 (常備化経験点は必ず数値)", () => {
      expect(schema.preserveExp).toBeInstanceOf(MockNumberField);
      expect(schema.preserveExp.options.initial).toBe(0);
    });

    it("appearancePenalty は NumberField で initial が 0 (危険値は必ず数値)", () => {
      expect(schema.appearancePenalty).toBeInstanceOf(MockNumberField);
      expect(schema.appearancePenalty.options.initial).toBe(0);
    });
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
