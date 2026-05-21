import { describe, it, expect } from "vitest";
import { MockNumberField, MockStringField } from "../../../setup.mjs";

const { ActorBaseTemplate } = await import("../../../../scripts/data/actor/common/actor-base.mjs");

describe("ActorBaseTemplate.defineSchema()", () => {
  const schema = ActorBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("トップレベルフィールドがすべて存在する", () => {
    for (const key of ["handMaxSize", "handPileId", "trumpCardPileId"]) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  it("handMaxSize は NumberField で initial が 4 (template.json 準拠)", () => {
    expect(schema.handMaxSize).toBeInstanceOf(MockNumberField);
    expect(schema.handMaxSize.options.initial).toBe(4);
  });

  it("handPileId は StringField で initial が空文字", () => {
    expect(schema.handPileId).toBeInstanceOf(MockStringField);
    expect(schema.handPileId.options.initial).toBe("");
  });

  it("trumpCardPileId は StringField で initial が空文字", () => {
    expect(schema.trumpCardPileId).toBeInstanceOf(MockStringField);
    expect(schema.trumpCardPileId.options.initial).toBe("");
  });
});
