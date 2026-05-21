import { describe, it, expect } from "vitest";
import { MockArrayField, MockSchemaField, MockStringField, MockNumberField } from "../../../setup.mjs";

const { ExtensibleTemplate } = await import("../../../../scripts/data/item/common/extensible.mjs");

describe("ExtensibleTemplate.defineSchema()", () => {
  const schema = ExtensibleTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("slot フィールドが存在する", () => {
    expect(schema).toHaveProperty("slot");
  });

  it("slot は ArrayField である", () => {
    expect(schema.slot).toBeInstanceOf(MockArrayField);
  });

  describe("slot 要素スキーマの構造が正しい", () => {
    it("要素は SchemaField である", () => {
      expect(schema.slot.element).toBeInstanceOf(MockSchemaField);
    });

    it("label / value / optionId が存在する", () => {
      expect(schema.slot.element.fields).toHaveProperty("label");
      expect(schema.slot.element.fields).toHaveProperty("value");
      expect(schema.slot.element.fields).toHaveProperty("optionId");
    });

    it("label は StringField で initial が空文字", () => {
      expect(schema.slot.element.fields.label).toBeInstanceOf(MockStringField);
      expect(schema.slot.element.fields.label.options.initial).toBe("");
    });

    it("value は NumberField で initial が 0", () => {
      expect(schema.slot.element.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.slot.element.fields.value.options.initial).toBe(0);
    });

    it("optionId は ArrayField(StringField) である", () => {
      const optionId = schema.slot.element.fields.optionId;
      expect(optionId).toBeInstanceOf(MockArrayField);
      expect(optionId.element).toBeInstanceOf(MockStringField);
    });
  });
});
