import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { GuestDataModel } = await import("../../../scripts/data/actor/guest.mjs");

describe("GuestDataModel.defineSchema()", () => {
  const schema = GuestDataModel.defineSchema();

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

  describe("AttributesTemplate のフィールドが含まれる", () => {
    const attributeKeys = [
      "reason", "passion", "life", "mundane",
      "combatSpeed", "physicalDamage", "mentalDamage", "socialDamage",
    ];
    for (const key of attributeKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("ActorBaseTemplate（カード管理フィールドは User flag へ一本化済み）", () => {
    const actorBaseKeys = ["handPileId", "trumpCardPileId"];
    for (const key of actorBaseKeys) {
      it(`schema.${key} を持たない`, () => {
        expect(schema).not.toHaveProperty(key);
      });
    }

    it("handMaxSize フィールドを持たない(手札上限は User flag の権威)", () => {
      expect(schema).not.toHaveProperty("handMaxSize");
    });
  });

  it("guest 固有フィールドは存在しない(memo が含まれない)", () => {
    expect(schema).not.toHaveProperty("memo");
  });
});
