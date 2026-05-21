import { describe, it, expect } from "vitest";
import { MockNumberField, MockBooleanField, MockSchemaField } from "../../../setup.mjs";

const { SkillBaseTemplate } = await import("../../../../scripts/data/item/common/skill-base.mjs");

describe("SkillBaseTemplate.defineSchema()", () => {
  const schema = SkillBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("トップレベルフィールドがすべて存在する", () => {
    for (const key of ["level", "suits", "isAction"]) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  it("level は NumberField で initial が 0", () => {
    expect(schema.level).toBeInstanceOf(MockNumberField);
    expect(schema.level.options.initial).toBe(0);
  });

  describe("suits (SchemaField) の構造が正しい", () => {
    it("suits は SchemaField である", () => {
      expect(schema.suits).toBeInstanceOf(MockSchemaField);
    });

    for (const suit of ["spade", "heart", "diamond", "club"]) {
      it(`suits.${suit} は BooleanField で initial が false`, () => {
        expect(schema.suits.fields[suit]).toBeInstanceOf(MockBooleanField);
        expect(schema.suits.fields[suit].options.initial).toBe(false);
      });
    }
  });

  it("isAction は BooleanField で initial が false", () => {
    expect(schema.isAction).toBeInstanceOf(MockBooleanField);
    expect(schema.isAction.options.initial).toBe(false);
  });
});
