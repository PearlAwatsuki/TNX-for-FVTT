import { describe, it, expect } from "vitest";
import "../../../setup.mjs"; // 評価時に globalThis.foundry をモックする（副作用）

const { ActorBaseTemplate } = await import("../../../../scripts/data/actor/common/actor-base.mjs");

describe("ActorBaseTemplate.defineSchema()", () => {
  const schema = ActorBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("カード管理フィールド(handPileId / trumpCardPileId)を持たない(User flag の権威へ一本化済み)", () => {
    expect(schema).not.toHaveProperty("handPileId");
    expect(schema).not.toHaveProperty("trumpCardPileId");
  });

  it("handMaxSize フィールドを持たない(手札上限は User flag の権威)", () => {
    expect(schema).not.toHaveProperty("handMaxSize");
  });
});
