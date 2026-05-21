import { describe, it, expect } from "vitest";
import { MockStringField } from "../../../setup.mjs";

const { BaseTemplate } = await import("../../../../scripts/data/item/common/base.mjs");

describe("BaseTemplate.defineSchema()", () => {
  const schema = BaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("description フィールドが存在する", () => {
    expect(schema).toHaveProperty("description");
  });

  it("description は StringField で initial が空文字", () => {
    expect(schema.description).toBeInstanceOf(MockStringField);
    expect(schema.description.options.initial).toBe("");
  });

  it("フィールドは description のみ(他のフィールドを持たない)", () => {
    expect(Object.keys(schema)).toHaveLength(1);
  });
});
