import { describe, it, expect } from "vitest";
import { MockStringField } from "../../setup.mjs";

const { HousingAreaDataModel } = await import("../../../scripts/data/item/housing-area.mjs");

describe("HousingAreaDataModel.defineSchema()", () => {
  const schema = HousingAreaDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("修正値フィールドが存在し initial が 0 (フェーズ6-4 で hideMod/slotMod 追加)", () => {
    const ownFields = [
      "buyRatingMod",
      "preserveExpMod",
      "hideMod",
      "appearanceTargetMod",
      "cyberSecurityMod",
      "analogSecurityMod",
      "slotMod",
    ];
    for (const key of ownFields) {
      it(`schema.${key} が存在し initial が 0`, () => {
        expect(schema).toHaveProperty(key);
        expect(schema[key].options.initial).toBe(0);
      });
    }
  });

  it("housingArea に存在しないフィールドは含まれない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });
});

describe("HousingAreaDataModel identificationKey (フェーズ6-0)", () => {
  const schema = HousingAreaDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});
