import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { OtherDataModel } = await import("../../../scripts/data/card/other.mjs");

describe("OtherDataModel.defineSchema()", () => {
  const schema = OtherDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("CardBaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  it("other 固有フィールドは存在しない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });

  it("other 固有フィールドは存在しない(suit が含まれない)", () => {
    expect(schema).not.toHaveProperty("suit");
  });
});
