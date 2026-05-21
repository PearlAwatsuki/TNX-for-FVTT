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

    it("type / name / description が存在する", () => {
      expect(schema.actions.element.fields).toHaveProperty("type");
      expect(schema.actions.element.fields).toHaveProperty("name");
      expect(schema.actions.element.fields).toHaveProperty("description");
    });

    it("各フィールドは StringField である", () => {
      expect(schema.actions.element.fields.type).toBeInstanceOf(MockStringField);
      expect(schema.actions.element.fields.name).toBeInstanceOf(MockStringField);
      expect(schema.actions.element.fields.description).toBeInstanceOf(MockStringField);
    });

    it("type / name / description の initial は空文字", () => {
      expect(schema.actions.element.fields.type.options.initial).toBe("");
      expect(schema.actions.element.fields.name.options.initial).toBe("");
      expect(schema.actions.element.fields.description.options.initial).toBe("");
    });
  });
});
