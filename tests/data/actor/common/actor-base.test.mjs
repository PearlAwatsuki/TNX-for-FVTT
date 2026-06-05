import { describe, it, expect } from "vitest";
import { MockStringField } from "../../../setup.mjs";

const { ActorBaseTemplate } = await import("../../../../scripts/data/actor/common/actor-base.mjs");

describe("ActorBaseTemplate.defineSchema()", () => {
  const schema = ActorBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("トップレベルフィールドがすべて存在する", () => {
    for (const key of ["handPileId", "trumpCardPileId"]) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  it("handMaxSize フィールドを持たない(手札上限は User flag の権威)", () => {
    expect(schema).not.toHaveProperty("handMaxSize");
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
