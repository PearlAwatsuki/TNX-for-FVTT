import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { GeneralSkillDataModel } = await import("../../../scripts/data/item/general-skill.mjs");

describe("GeneralSkillDataModel.defineSchema()", () => {
  const schema = GeneralSkillDataModel.defineSchema();

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

  describe("SkillBaseTemplate のフィールドが含まれる", () => {
    it("schema.level が NumberField で存在する", () => {
      expect(schema.level).toBeInstanceOf(MockNumberField);
      expect(schema.level.options.initial).toBe(0);
    });

    it("schema.suits が SchemaField で存在する", () => {
      expect(schema.suits).toBeInstanceOf(MockSchemaField);
    });

    it("suits に spade / heart / diamond / club が存在する", () => {
      for (const suit of ["spade", "heart", "diamond", "club"]) {
        expect(schema.suits.fields[suit]).toBeInstanceOf(MockBooleanField);
        expect(schema.suits.fields[suit].options.initial).toBe(false);
      }
    });

    it("schema.isAction が BooleanField で存在する", () => {
      expect(schema.isAction).toBeInstanceOf(MockBooleanField);
      expect(schema.isAction.options.initial).toBe(false);
    });
  });

  describe("generalSkillCategory フィールド", () => {
    it("schema.generalSkillCategory は StringField で initial が 'initialSkill'", () => {
      expect(schema.generalSkillCategory).toBeInstanceOf(MockStringField);
      expect(schema.generalSkillCategory.options.initial).toBe("initialSkill");
    });
  });

  describe("initialSkill の構造が正しい", () => {
    it("schema.initialSkill が SchemaField で存在する", () => {
      expect(schema.initialSkill).toBeInstanceOf(MockSchemaField);
    });

    it("initialSkill に initialSuit / expCost が存在する", () => {
      expect(schema.initialSkill.fields).toHaveProperty("initialSuit");
      expect(schema.initialSkill.fields).toHaveProperty("expCost");
    });

    it("initialSkill.initialSuit は StringField で initial が ''", () => {
      expect(schema.initialSkill.fields.initialSuit).toBeInstanceOf(MockStringField);
      expect(schema.initialSkill.fields.initialSuit.options.initial).toBe("");
    });

    it("initialSkill.expCost は NumberField で initial が 10", () => {
      expect(schema.initialSkill.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.initialSkill.fields.expCost.options.initial).toBe(10);
    });
  });

  describe("onomasticSkill の構造が正しい", () => {
    it("schema.onomasticSkill が SchemaField で存在する", () => {
      expect(schema.onomasticSkill).toBeInstanceOf(MockSchemaField);
    });

    it("onomasticSkill に isInitial / expCost が存在する", () => {
      expect(schema.onomasticSkill.fields).toHaveProperty("isInitial");
      expect(schema.onomasticSkill.fields).toHaveProperty("expCost");
    });

    it("onomasticSkill.isInitial は BooleanField で initial が false", () => {
      expect(schema.onomasticSkill.fields.isInitial).toBeInstanceOf(MockBooleanField);
      expect(schema.onomasticSkill.fields.isInitial.options.initial).toBe(false);
    });

    it("onomasticSkill.expCost は NumberField で initial が 5", () => {
      expect(schema.onomasticSkill.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.onomasticSkill.fields.expCost.options.initial).toBe(5);
    });
  });

  describe("generalSkill に含まれないフィールド", () => {
    it("outfitBase 由来の isPrepared が含まれない", () => {
      expect(schema).not.toHaveProperty("isPrepared");
    });

    it("miracle 固有の usageCount が含まれない", () => {
      expect(schema).not.toHaveProperty("usageCount");
    });
  });
});
