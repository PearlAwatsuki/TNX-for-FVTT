import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { ResidenceDataModel } = await import("../../../scripts/data/item/residence.mjs");

describe("ResidenceDataModel.defineSchema()", () => {
  const schema = ResidenceDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が BooleanField で存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema.uses.fields).toHaveProperty("isLimit");
    });
  });

  describe("ExtensibleTemplate のフィールドが含まれる", () => {
    it("schema.slots が ArrayField で存在する", () => {
      expect(schema.slots).toBeInstanceOf(MockArrayField);
    });
  });

  describe("拠点情報フィールド", () => {
    it("schema.appearanceTarget は NumberField で initial が 0", () => {
      expect(schema.appearanceTarget).toBeInstanceOf(MockNumberField);
      expect(schema.appearanceTarget.options.initial).toBe(0);
    });

    it("schema.cyberSecurity は NumberField で initial が 0", () => {
      expect(schema.cyberSecurity).toBeInstanceOf(MockNumberField);
      expect(schema.cyberSecurity.options.initial).toBe(0);
    });

    it("schema.analogSecurity は NumberField で initial が 0", () => {
      expect(schema.analogSecurity).toBeInstanceOf(MockNumberField);
      expect(schema.analogSecurity.options.initial).toBe(0);
    });

    it("schema.housingArea は StringField で initial が ''", () => {
      expect(schema.housingArea).toBeInstanceOf(MockStringField);
      expect(schema.housingArea.options.initial).toBe("");
    });
  });

  describe("修正値フィールド(*Mod)", () => {
    const modFields = [
      "buyRatingMod",
      "preserveExpMod",
      "appearanceTargetMod",
      "cyberSecurityMod",
      "analogSecurityMod",
    ];

    for (const key of modFields) {
      it(`schema.${key} は NumberField で initial が 0`, () => {
        expect(schema[key]).toBeInstanceOf(MockNumberField);
        expect(schema[key].options.initial).toBe(0);
      });
    }
  });

  it("attack フィールドは含まれない(weapon 固有)", () => {
    expect(schema).not.toHaveProperty("attack");
  });
});

describe("ResidenceDataModel identificationKey (フェーズ6-0)", () => {
  const schema = ResidenceDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("ResidenceDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = ResidenceDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
