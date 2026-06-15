import { describe, it, expect } from "vitest";
import { MockArrayField, MockSchemaField, MockStringField } from "../../../setup.mjs";

const { UsageTemplate } = await import("../../../../scripts/data/item/common/usage.mjs");

describe("UsageTemplate.defineSchema()", () => {
  const schema = UsageTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("actions フィールドが存在する", () => {
    expect(schema).toHaveProperty("actions");
  });

  it("actions は ArrayField である", () => {
    expect(schema.actions).toBeInstanceOf(MockArrayField);
  });

  describe("actions 要素スキーマの構造が正しい", () => {
    it("要素は SchemaField である", () => {
      expect(schema.actions.element).toBeInstanceOf(MockSchemaField);
    });

    it("type / name / description / skillRefs が存在する", () => {
      expect(schema.actions.element.fields).toHaveProperty("type");
      expect(schema.actions.element.fields).toHaveProperty("name");
      expect(schema.actions.element.fields).toHaveProperty("description");
      expect(schema.actions.element.fields).toHaveProperty("skillRefs");
    });

    it("type / name / description は StringField である", () => {
      expect(schema.actions.element.fields.type).toBeInstanceOf(MockStringField);
      expect(schema.actions.element.fields.name).toBeInstanceOf(MockStringField);
      expect(schema.actions.element.fields.description).toBeInstanceOf(MockStringField);
    });

    it("type / name / description の initial は空文字", () => {
      expect(schema.actions.element.fields.type.options.initial).toBe("");
      expect(schema.actions.element.fields.name.options.initial).toBe("");
      expect(schema.actions.element.fields.description.options.initial).toBe("");
    });

    describe("skillRefs の構造が正しい", () => {
      it("skillRefs は ArrayField である", () => {
        expect(schema.actions.element.fields.skillRefs).toBeInstanceOf(MockArrayField);
      });

      it("skillRefs の要素は SchemaField である", () => {
        expect(schema.actions.element.fields.skillRefs.element).toBeInstanceOf(MockSchemaField);
      });

      it("skillRefs の要素に itemId が存在する", () => {
        expect(schema.actions.element.fields.skillRefs.element.fields).toHaveProperty("itemId");
      });

      it("skillRefs.itemId は StringField で initial が空文字", () => {
        const itemId = schema.actions.element.fields.skillRefs.element.fields.itemId;
        expect(itemId).toBeInstanceOf(MockStringField);
        expect(itemId.options.initial).toBe("");
      });
    });
  });
});
