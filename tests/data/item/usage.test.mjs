import { describe, it, expect } from "vitest";
import { MockStringField, MockNumberField, MockSchemaField, MockArrayField } from "../../setup.mjs";

const { UsageTemplate } = await import("../../../scripts/data/item/common/usage.mjs");

describe("UsageTemplate.defineSchema()（フェーズ11-6 追加フィールド）", () => {
  const schema = UsageTemplate.defineSchema();
  const entry = schema.actions.element.fields;

  it("actions は ArrayField(SchemaField) 構造", () => {
    expect(schema.actions).toBeInstanceOf(MockArrayField);
    expect(schema.actions.element).toBeInstanceOf(MockSchemaField);
  });

  describe("消費先設定 consumeTargets（全消費は用途設定からのみ・自動スキャン全廃）", () => {
    it("consumeTargets は ArrayField(SchemaField)", () => {
      expect(entry.consumeTargets).toBeInstanceOf(MockArrayField);
      expect(entry.consumeTargets.element).toBeInstanceOf(MockSchemaField);
    });

    it("行は type(initial 'parent') / itemId / amount(initial 1・整数・負値可=残弾回復) を持つ", () => {
      const row = entry.consumeTargets.element.fields;
      expect(row.type).toBeInstanceOf(MockStringField);
      expect(row.type.options.initial).toBe("parent");
      expect(row.itemId).toBeInstanceOf(MockStringField);
      expect(row.itemId.options.initial).toBe("");
      expect(row.amount).toBeInstanceOf(MockNumberField);
      expect(row.amount.options.initial).toBe(1);
      // 負値=回復(ammo のリロード表現・2026-07-17)のため min は設けない
      expect(row.amount.options.min).toBeUndefined();
      expect(row.amount.options.integer).toBe(true);
    });
  });

  describe("NPC取得 npcAcquire（Troops.md「NPC取得」）", () => {
    it("acquireMode は StringField で initial 'extra'（モードは明示選択・導出しない）", () => {
      expect(entry.acquireMode).toBeInstanceOf(MockStringField);
      expect(entry.acquireMode.options.initial).toBe("extra");
    });

    it("acquireItemRefs は ArrayField(SchemaField{uuid, name})", () => {
      expect(entry.acquireItemRefs).toBeInstanceOf(MockArrayField);
      const row = entry.acquireItemRefs.element.fields;
      expect(row.uuid).toBeInstanceOf(MockStringField);
      expect(row.name).toBeInstanceOf(MockStringField);
    });

    it("acquireActorRef（判定系モードの取得対象・2026-07-07=用途側で設定）は SchemaField{uuid, name}", () => {
      expect(entry.acquireActorRef).toBeInstanceOf(MockSchemaField);
      expect(entry.acquireActorRef.fields).toHaveProperty("uuid");
      expect(entry.acquireActorRef.fields).toHaveProperty("name");
    });
  });
});

describe("UsageTemplate.migrateData()（消費先設定の互換移行）", () => {
  it("consumeTargets を持たない check 用途は「親×1」を明示化する", () => {
    const source = UsageTemplate.migrateData({
      actions: [{ _id: "a1", type: "check" }],
    });
    expect(source.actions[0].consumeTargets).toEqual([{ type: "parent", itemId: "", amount: 1 }]);
  });

  it("consumeTargets を既に持つ check 用途は変更しない（空配列=消費なしの明示も保持）", () => {
    const source = UsageTemplate.migrateData({
      actions: [{ _id: "a1", type: "check", consumeTargets: [] }],
    });
    expect(source.actions[0].consumeTargets).toEqual([]);
  });

  it("check 以外の用途タイプには既定行を足さない", () => {
    const source = UsageTemplate.migrateData({
      actions: [{ _id: "a1", type: "declaration" }],
    });
    expect(source.actions[0].consumeTargets).toBeUndefined();
  });
});
