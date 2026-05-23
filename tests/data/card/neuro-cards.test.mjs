import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { NeuroCardsDataModel } = await import("../../../scripts/data/card/neuro-cards.mjs");

describe("NeuroCardsDataModel.defineSchema()", () => {
  const schema = NeuroCardsDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("CardBaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  it("neuroCards 固有フィールドは存在しない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });

  it("neuroCards 固有フィールドは存在しない(suit が含まれない)", () => {
    expect(schema).not.toHaveProperty("suit");
  });
});
