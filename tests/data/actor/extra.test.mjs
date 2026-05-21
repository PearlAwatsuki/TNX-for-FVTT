import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { ExtraDataModel } = await import("../../../scripts/data/actor/extra.mjs");

describe("ExtraDataModel.defineSchema()", () => {
  const schema = ExtraDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BiographyTemplate のフィールドが含まれる", () => {
    const biographyKeys = [
      "charaname_ruby", "handle", "handle_ruby", "post",
      "citizenRank", "age", "gender", "birthday",
      "height", "weight", "eyes", "hair", "skin", "description",
    ];
    for (const key of biographyKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("attributes / actorBase template のフィールドは含まれない", () => {
    const excludedKeys = ["reason", "handMaxSize", "trumpCardPileId"];
    for (const key of excludedKeys) {
      it(`schema.${key} が存在しない`, () => {
        expect(schema).not.toHaveProperty(key);
      });
    }
  });

  it("extra 固有フィールドは存在しない(memo が含まれない)", () => {
    expect(schema).not.toHaveProperty("memo");
  });
});
