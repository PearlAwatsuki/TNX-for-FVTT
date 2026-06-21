import { describe, it, expect } from "vitest";
import { MockSchemaField, MockNumberField } from "../../../setup.mjs";

const { AttributesTemplate } = await import("../../../../scripts/data/actor/common/attributes.mjs");

describe("AttributesTemplate.defineSchema()", () => {
  const schema = AttributesTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("トップレベルフィールドがすべて存在する", () => {
    const expectedKeys = [
      "reason", "passion", "life", "mundane",
      "combatSpeed",
      "physicalDamage", "mentalDamage", "socialDamage",
    ];
    for (const key of expectedKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("reason / passion / life / mundane (attributeField) の構造が正しい", () => {
    const attributeKeys = [
      "value", "control",
      "styleA_value", "styleA_control",
      "styleB_value", "styleB_control",
      "styleC_value", "styleC_control",
      "growth", "controlGrowth",
      "mod", "controlMod",
    ];

    it("reason は SchemaField である", () => {
      expect(schema.reason).toBeInstanceOf(MockSchemaField);
    });

    for (const key of attributeKeys) {
      it(`reason.${key} が存在する`, () => {
        expect(schema.reason.fields).toHaveProperty(key);
      });
    }

    it("reason と passion は別インスタンスである", () => {
      expect(schema.reason).not.toBe(schema.passion);
    });

    it("reason.value は NumberField で initial が 0", () => {
      expect(schema.reason.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.reason.fields.value.options.initial).toBe(0);
    });
  });

  describe("combatSpeed (combatSpeedField) の構造が正しい", () => {
    it("combatSpeed は SchemaField である", () => {
      expect(schema.combatSpeed).toBeInstanceOf(MockSchemaField);
    });

    for (const key of ["value", "base", "current", "mod", "freeMod"]) {
      it(`combatSpeed.${key} が存在する`, () => {
        expect(schema.combatSpeed.fields).toHaveProperty(key);
      });
    }
  });

  describe("ダメージフィールド(physicalDamage / mentalDamage / socialDamage)の構造が正しい", () => {
    for (const name of ["physicalDamage", "mentalDamage", "socialDamage"]) {
      it(`${name} は SchemaField である`, () => {
        expect(schema[name]).toBeInstanceOf(MockSchemaField);
      });

      it(`${name} は value / min / max を持つ`, () => {
        expect(schema[name].fields).toHaveProperty("value");
        expect(schema[name].fields).toHaveProperty("min");
        expect(schema[name].fields).toHaveProperty("max");
      });

      // template.json では max の初期値は 21。damageField() の 0 とは異なる点に注意
      it(`${name}.max の initial は 21 (template.json 準拠)`, () => {
        expect(schema[name].fields.max.options.initial).toBe(21);
      });
    }
  });
});
