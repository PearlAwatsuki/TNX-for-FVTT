import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { PlayingCardsDataModel } = await import("../../../scripts/data/card/playing-cards.mjs");

describe("PlayingCardsDataModel.defineSchema()", () => {
  const schema = PlayingCardsDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("CardBaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  it("playingCards 固有フィールドは存在しない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });

  it("playingCards 固有フィールドは存在しない(suit が含まれない)", () => {
    expect(schema).not.toHaveProperty("suit");
  });
});
