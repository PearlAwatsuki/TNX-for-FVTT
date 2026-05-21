import { describe, it, expect } from "vitest";
import "../../setup.mjs";

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

  describe("固有フィールドが存在する", () => {
    const ownFields = [
      "buyRatingMod",
      "preserveExpMod",
      "appearanceTargetMod",
      "cyberSecurityMod",
      "analogSecurityMod",
    ];
    for (const key of ownFields) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("固有フィールドの初期値が 0 である", () => {
    const ownFields = [
      "buyRatingMod",
      "preserveExpMod",
      "appearanceTargetMod",
      "cyberSecurityMod",
      "analogSecurityMod",
    ];
    for (const key of ownFields) {
      it(`schema.${key}.options.initial === 0`, () => {
        expect(schema[key].options.initial).toBe(0);
      });
    }
  });

  it("housingArea に存在しないフィールドは含まれない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });
});
