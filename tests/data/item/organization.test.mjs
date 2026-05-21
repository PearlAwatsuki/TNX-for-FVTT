import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { OrganizationDataModel } = await import("../../../scripts/data/item/organization.mjs");

describe("OrganizationDataModel.defineSchema()", () => {
  const schema = OrganizationDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  it("organization 固有フィールドは存在しない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });

  it("organization 固有フィールドは存在しない(buyRatingMod が含まれない)", () => {
    expect(schema).not.toHaveProperty("buyRatingMod");
  });
});
