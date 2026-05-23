import { describe, it, expect } from "vitest";
import {
  MockArrayField,
  MockBooleanField,
  MockNumberField,
  MockSchemaField,
  MockStringField,
} from "../../setup.mjs";

const { StyleSkillDataModel } = await import("../../../scripts/data/item/style-skill.mjs");

describe("StyleSkillDataModel.defineSchema()", () => {
  const schema = StyleSkillDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  // ------------------------------------------------------------------
  // mixin 合成確認
  // ------------------------------------------------------------------

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("UsageTemplate のフィールドが含まれる", () => {
    it("schema.actions が ArrayField で存在する", () => {
      expect(schema.actions).toBeInstanceOf(MockArrayField);
    });
  });

  describe("SkillBaseTemplate のフィールドが含まれる", () => {
    it("schema.level が NumberField で initial が 0", () => {
      expect(schema.level).toBeInstanceOf(MockNumberField);
      expect(schema.level.options.initial).toBe(0);
    });

    it("schema.suits が SchemaField で存在する", () => {
      expect(schema.suits).toBeInstanceOf(MockSchemaField);
    });

    it("suits に spade / heart / diamond / club が含まれる", () => {
      expect(schema.suits.fields).toHaveProperty("spade");
      expect(schema.suits.fields).toHaveProperty("heart");
      expect(schema.suits.fields).toHaveProperty("diamond");
      expect(schema.suits.fields).toHaveProperty("club");
    });

    it("schema.isAction が BooleanField で initial が false", () => {
      expect(schema.isAction).toBeInstanceOf(MockBooleanField);
      expect(schema.isAction.options.initial).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // スカラーフィールド
  // ------------------------------------------------------------------

  describe("カテゴリ・分類フィールド", () => {
    it("styleSkillCategory は StringField で initial が 'special'", () => {
      expect(schema.styleSkillCategory).toBeInstanceOf(MockStringField);
      expect(schema.styleSkillCategory.options.initial).toBe("special");
    });

    it("unique は StringField で initial が 'none'(template.json の '' は誤り)", () => {
      expect(schema.unique).toBeInstanceOf(MockStringField);
      expect(schema.unique.options.initial).toBe("none");
    });

    it("style は StringField で initial が '-'", () => {
      expect(schema.style).toBeInstanceOf(MockStringField);
      expect(schema.style.options.initial).toBe("-");
    });
  });

  describe("上限レベルフィールド", () => {
    it("maxLevel は StringField で initial が 'blank'", () => {
      expect(schema.maxLevel).toBeInstanceOf(MockStringField);
      expect(schema.maxLevel.options.initial).toBe("blank");
    });
  });

  describe("対象・射程・目標値フィールド", () => {
    it("target は StringField で initial が 'blank'", () => {
      expect(schema.target).toBeInstanceOf(MockStringField);
      expect(schema.target.options.initial).toBe("blank");
    });

    it("range は StringField で initial が 'blank'", () => {
      expect(schema.range).toBeInstanceOf(MockStringField);
      expect(schema.range.options.initial).toBe("blank");
    });

    it("targetValue は StringField で initial が 'blank'", () => {
      expect(schema.targetValue).toBeInstanceOf(MockStringField);
      expect(schema.targetValue.options.initial).toBe("blank");
    });
  });

  describe("Boolean フラグフィールド", () => {
    it("isFixedRange は BooleanField で initial が false", () => {
      expect(schema.isFixedRange).toBeInstanceOf(MockBooleanField);
      expect(schema.isFixedRange.options.initial).toBe(false);
    });

    it("isFixedTarget は BooleanField で initial が false", () => {
      expect(schema.isFixedTarget).toBeInstanceOf(MockBooleanField);
      expect(schema.isFixedTarget.options.initial).toBe(false);
    });

    it("isEssentialSkill は BooleanField で initial が false", () => {
      expect(schema.isEssentialSkill).toBeInstanceOf(MockBooleanField);
      expect(schema.isEssentialSkill.options.initial).toBe(false);
    });

    it("isSubstitute は BooleanField で initial が false", () => {
      expect(schema.isSubstitute).toBeInstanceOf(MockBooleanField);
      expect(schema.isSubstitute.options.initial).toBe(false);
    });
  });

  describe("書き換え神業関連フィールド(typo・命名揺れ維持)", () => {
    it("RewritedTarget は StringField で initial が ''", () => {
      expect(schema.RewritedTarget).toBeInstanceOf(MockStringField);
      expect(schema.RewritedTarget.options.initial).toBe("");
    });

    it("rewritingMiracleName は StringField で initial が ''", () => {
      expect(schema.rewritingMiracleName).toBeInstanceOf(MockStringField);
      expect(schema.rewritingMiracleName.options.initial).toBe("");
    });

    it("RewritingMiracle_ID は StringField で initial が ''", () => {
      expect(schema.RewritingMiracle_ID).toBeInstanceOf(MockStringField);
      expect(schema.RewritingMiracle_ID.options.initial).toBe("");
    });
  });

  // ------------------------------------------------------------------
  // ★ template.json 未定義・シート参照フィールド(8 個)
  // ------------------------------------------------------------------

  describe("★ template.json 未定義・シートが参照する追加フィールド", () => {
    it("maxLevelNumber が NumberField で initial が 0", () => {
      expect(schema.maxLevelNumber).toBeInstanceOf(MockNumberField);
      expect(schema.maxLevelNumber.options.initial).toBe(0);
    });

    it("maxLevelOther が StringField で initial が ''", () => {
      expect(schema.maxLevelOther).toBeInstanceOf(MockStringField);
      expect(schema.maxLevelOther.options.initial).toBe("");
    });

    it("targetOther が StringField で initial が ''", () => {
      expect(schema.targetOther).toBeInstanceOf(MockStringField);
      expect(schema.targetOther.options.initial).toBe("");
    });

    it("rangeOther が StringField で initial が ''", () => {
      expect(schema.rangeOther).toBeInstanceOf(MockStringField);
      expect(schema.rangeOther.options.initial).toBe("");
    });

    it("targetValueNumber が NumberField で initial が 0", () => {
      expect(schema.targetValueNumber).toBeInstanceOf(MockNumberField);
      expect(schema.targetValueNumber.options.initial).toBe(0);
    });

    it("targetValueOther が StringField で initial が ''", () => {
      expect(schema.targetValueOther).toBeInstanceOf(MockStringField);
      expect(schema.targetValueOther.options.initial).toBe("");
    });

    it("comboSkillOther が StringField で initial が ''(ensureArray 互換フィールド)", () => {
      expect(schema.comboSkillOther).toBeInstanceOf(MockStringField);
      expect(schema.comboSkillOther.options.initial).toBe("");
    });

    it("confrontationOther が StringField で initial が ''(ensureArray 互換フィールド)", () => {
      expect(schema.confrontationOther).toBeInstanceOf(MockStringField);
      expect(schema.confrontationOther.options.initial).toBe("");
    });
  });

  // ------------------------------------------------------------------
  // 配列フィールド
  // ------------------------------------------------------------------

  describe("comboSkill 配列フィールド", () => {
    it("schema.comboSkill が ArrayField で存在する", () => {
      expect(schema.comboSkill).toBeInstanceOf(MockArrayField);
    });

    it("comboSkill 要素は SchemaField(value / name / isMandatory)", () => {
      expect(schema.comboSkill.element).toBeInstanceOf(MockSchemaField);
      expect(schema.comboSkill.element.fields).toHaveProperty("value");
      expect(schema.comboSkill.element.fields).toHaveProperty("name");
      expect(schema.comboSkill.element.fields).toHaveProperty("isMandatory");
    });

    it("comboSkill 要素の value は StringField で initial が 'blank'", () => {
      expect(schema.comboSkill.element.fields.value).toBeInstanceOf(MockStringField);
      expect(schema.comboSkill.element.fields.value.options.initial).toBe("blank");
    });

    it("comboSkill 要素の name は StringField で initial が ''", () => {
      expect(schema.comboSkill.element.fields.name).toBeInstanceOf(MockStringField);
      expect(schema.comboSkill.element.fields.name.options.initial).toBe("");
    });

    it("comboSkill 要素の isMandatory は BooleanField で initial が false", () => {
      expect(schema.comboSkill.element.fields.isMandatory).toBeInstanceOf(MockBooleanField);
      expect(schema.comboSkill.element.fields.isMandatory.options.initial).toBe(false);
    });
  });

  describe("confrontation 配列フィールド", () => {
    it("schema.confrontation が ArrayField で存在する", () => {
      expect(schema.confrontation).toBeInstanceOf(MockArrayField);
    });

    it("confrontation 要素は SchemaField(value / name)", () => {
      expect(schema.confrontation.element).toBeInstanceOf(MockSchemaField);
      expect(schema.confrontation.element.fields).toHaveProperty("value");
      expect(schema.confrontation.element.fields).toHaveProperty("name");
    });

    it("confrontation 要素の value は StringField で initial が 'blank'", () => {
      expect(schema.confrontation.element.fields.value).toBeInstanceOf(MockStringField);
      expect(schema.confrontation.element.fields.value.options.initial).toBe("blank");
    });

    it("confrontation 要素の name は StringField で initial が ''", () => {
      expect(schema.confrontation.element.fields.name).toBeInstanceOf(MockStringField);
      expect(schema.confrontation.element.fields.name.options.initial).toBe("");
    });
  });

  describe("timing 配列フィールド", () => {
    it("schema.timing が ArrayField で存在する", () => {
      expect(schema.timing).toBeInstanceOf(MockArrayField);
    });

    it("timing 要素は SchemaField(value / actionName / processName / timingOther)", () => {
      expect(schema.timing.element).toBeInstanceOf(MockSchemaField);
      expect(schema.timing.element.fields).toHaveProperty("value");
      expect(schema.timing.element.fields).toHaveProperty("actionName");
      expect(schema.timing.element.fields).toHaveProperty("processName");
      expect(schema.timing.element.fields).toHaveProperty("timingOther");
    });

    it("timing 要素の value は StringField で initial が 'blank'", () => {
      expect(schema.timing.element.fields.value).toBeInstanceOf(MockStringField);
      expect(schema.timing.element.fields.value.options.initial).toBe("blank");
    });

    it("timing 要素の actionName は StringField で initial が 'blank'", () => {
      expect(schema.timing.element.fields.actionName).toBeInstanceOf(MockStringField);
      expect(schema.timing.element.fields.actionName.options.initial).toBe("blank");
    });

    it("timing 要素の processName は StringField で initial が 'blank'", () => {
      expect(schema.timing.element.fields.processName).toBeInstanceOf(MockStringField);
      expect(schema.timing.element.fields.processName.options.initial).toBe("blank");
    });

    it("timing 要素の timingOther は StringField で initial が ''", () => {
      expect(schema.timing.element.fields.timingOther).toBeInstanceOf(MockStringField);
      expect(schema.timing.element.fields.timingOther.options.initial).toBe("");
    });
  });

  describe("substituteTarget 配列フィールド", () => {
    it("schema.substituteTarget が ArrayField で存在する", () => {
      expect(schema.substituteTarget).toBeInstanceOf(MockArrayField);
    });

    it("substituteTarget 要素は StringField(単純な文字列配列)", () => {
      expect(schema.substituteTarget.element).toBeInstanceOf(MockStringField);
    });
  });

  // ------------------------------------------------------------------
  // ネスト SchemaField
  // ------------------------------------------------------------------

  describe("uses SchemaField", () => {
    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });

    it("uses.isLimit は BooleanField で initial が false", () => {
      expect(schema.uses.fields.isLimit).toBeInstanceOf(MockBooleanField);
      expect(schema.uses.fields.isLimit.options.initial).toBe(false);
    });

    it("uses.value は NumberField で initial が 0", () => {
      expect(schema.uses.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.value.options.initial).toBe(0);
    });

    it("uses.max は NumberField で initial が 0", () => {
      expect(schema.uses.fields.max).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.max.options.initial).toBe(0);
    });
  });

  describe("special SchemaField", () => {
    it("schema.special が SchemaField で存在する", () => {
      expect(schema.special).toBeInstanceOf(MockSchemaField);
    });

    it("special.expCost は NumberField で initial が 10", () => {
      expect(schema.special.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.special.fields.expCost.options.initial).toBe(10);
    });

    it("special.works は SchemaField で存在する", () => {
      expect(schema.special.fields.works).toBeInstanceOf(MockSchemaField);
    });

    it("special.works.organization は StringField で initial が '-'", () => {
      expect(schema.special.fields.works.fields.organization).toBeInstanceOf(MockStringField);
      expect(schema.special.fields.works.fields.organization.options.initial).toBe("-");
    });
  });

  describe("performance / secret / mystery SchemaField", () => {
    it("schema.performance が SchemaField で存在し expCost の initial が 2", () => {
      expect(schema.performance).toBeInstanceOf(MockSchemaField);
      expect(schema.performance.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.performance.fields.expCost.options.initial).toBe(2);
    });

    it("schema.secret が SchemaField で存在し expCost の initial が 20", () => {
      expect(schema.secret).toBeInstanceOf(MockSchemaField);
      expect(schema.secret.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.secret.fields.expCost.options.initial).toBe(20);
    });

    it("schema.mystery が SchemaField で存在し expCost の initial が 50", () => {
      expect(schema.mystery).toBeInstanceOf(MockSchemaField);
      expect(schema.mystery.fields.expCost).toBeInstanceOf(MockNumberField);
      expect(schema.mystery.fields.expCost.options.initial).toBe(50);
    });
  });

  // ------------------------------------------------------------------
  // styleSkill に含まれないフィールド
  // ------------------------------------------------------------------

  describe("styleSkill に含まれないフィールド", () => {
    it("outfitBase 由来の isPrepared が含まれない", () => {
      expect(schema).not.toHaveProperty("isPrepared");
    });

    it("outfitBase 由来の isCyber が含まれない", () => {
      expect(schema).not.toHaveProperty("isCyber");
    });
  });
});
