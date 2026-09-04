import { describe, it, expect } from "vitest";
import { MockStringField, MockNumberField, MockSchemaField, MockArrayField, MockBooleanField } from "../../setup.mjs";

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

    it("行は type(initial 'item') / itemId / resource(initial 'uses') / amount(initial 1・整数・負値可=回復) を持つ", () => {
      const row = entry.consumeTargets.element.fields;
      expect(row.type).toBeInstanceOf(MockStringField);
      expect(row.type.options.initial).toBe("item");
      expect(row.itemId).toBeInstanceOf(MockStringField);
      expect(row.itemId.options.initial).toBe("");
      expect(row.resource).toBeInstanceOf(MockStringField);
      expect(row.resource.options.initial).toBe("uses");
      expect(row.amount).toBeInstanceOf(MockNumberField);
      expect(row.amount.options.initial).toBe(1);
      // 負値=回復(リロードの表現)のため min は設けない
      expect(row.amount.options.min).toBeUndefined();
      expect(row.amount.options.integer).toBe(true);
    });

    it("migrateData: 旧 type(parent/itemUses/miracleUses/actionRank) → item/resource へ移行（旧 ammo 行は破棄）", () => {
      const src = UsageTemplate.migrateData({ actions: [{ _id: "a", type: "check", consumeTargets: [
        { type: "parent", itemId: "", amount: 1 },
        { type: "itemUses", itemId: "s1", amount: 2 },
        { type: "miracleUses", itemId: "m1", amount: 1 },
        { type: "ammo", itemId: "w1", amount: -3 },
        { type: "actionRank", itemId: "", amount: 1 },
      ] }] });
      expect(src.actions[0].consumeTargets).toEqual([
        { type: "item", itemId: "", resource: "uses", amount: 1 },
        { type: "item", itemId: "s1", resource: "uses", amount: 2 },
        { type: "item", itemId: "m1", resource: "uses", amount: 1 },
        { type: "actionRank", itemId: "", resource: "uses", amount: 1 },
      ]);
    });

    it("migrateData: 残弾の廃止(2026-07-19)=resource 'ammo' の行は移行せず行ごと破棄する", () => {
      const src = UsageTemplate.migrateData({ actions: [{ _id: "a", type: "check", consumeTargets: [
        { type: "item", itemId: "w1", resource: "ammo", amount: 1 },
        { type: "item", itemId: "s1", resource: "uses", amount: 2 },
      ] }] });
      expect(src.actions[0].consumeTargets).toEqual([
        { type: "item", itemId: "s1", resource: "uses", amount: 2 },
      ]);
    });
  });

  describe("ヴィークル準備時 requiresVehicle（2026-07-18 一般化）", () => {
    it("requiresVehicle は BooleanField で initial false", () => {
      expect(entry.requiresVehicle).toBeInstanceOf(MockBooleanField);
      expect(entry.requiresVehicle.options.initial).toBe(false);
    });

    it("migrateData: 移動/リアクション（移動妨害）で未設定なら既定オン・他タイプはオフのまま", () => {
      const src = UsageTemplate.migrateData({ actions: [
        { _id: "a", type: "move" },
        { _id: "b", type: "moveBlockReaction" },
        { _id: "c", type: "check" },
      ] });
      expect(src.actions[0].requiresVehicle).toBe(true);
      expect(src.actions[1].requiresVehicle).toBe(true);
      expect(src.actions[2].requiresVehicle).toBeUndefined();
    });

    it("migrateData: 既に requiresVehicle を持つ用途は変更しない", () => {
      const src = UsageTemplate.migrateData({ actions: [{ _id: "a", type: "move", requiresVehicle: false }] });
      expect(src.actions[0].requiresVehicle).toBe(false);
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

describe("UsageTemplate.migrateData()（消費先設定・2026-07-17 親×1互換既定の全廃）", () => {
  it("consumeTargets を持たない用途にも既定行を足さない（旧・親×1 明示化はユーザー指示で全廃）", () => {
    const source = UsageTemplate.migrateData({
      actions: [{ _id: "a1", type: "check" }, { _id: "a2", type: "declaration" }],
    });
    expect(source.actions[0].consumeTargets).toBeUndefined();
    expect(source.actions[1].consumeTargets).toBeUndefined();
  });

    it("新スキーマ(resource つき)の consumeTargets は変更しない", () => {
    const source = UsageTemplate.migrateData({
      actions: [{ _id: "a1", type: "check", consumeTargets: [{ type: "item", itemId: "", resource: "uses", amount: 1 }] }],
    });
    expect(source.actions[0].consumeTargets).toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
  });
});

// ─── 防御タイプ(フェーズ17-2)の設定 ───────────────────────────────────────────────
// 正本: Miracle_Rules「打ち消しの範囲」「防御神業」・Phase_17_Tasks_Detail 17-2。
// 動作は4つ: 打ち消し(negate)/適用前に防ぐ(prevent)/回避(evade)/受けた後に消す(cure)。
describe("UsageTemplate.defineSchema()（防御タイプの設定・17-2）", () => {
  const entry = UsageTemplate.defineSchema().actions.element.fields;

  it("defenceAction は StringField・既定 prevent（適用前に防ぐ）", () => {
    expect(entry.defenceAction).toBeInstanceOf(MockStringField);
    expect(entry.defenceAction.options.initial).toBe("prevent");
  });

  it("defenceScope は StringField・既定 all（一回の攻撃・神業まるごと。one=選んだ1人）", () => {
    expect(entry.defenceScope).toBeInstanceOf(MockStringField);
    expect(entry.defenceScope.options.initial).toBe("all");
  });

  it("defenceCategories は ArrayField(StringField)・既定は3系統すべて（《難攻不落》は社会を外す）", () => {
    expect(entry.defenceCategories).toBeInstanceOf(MockArrayField);
    expect(entry.defenceCategories.element).toBeInstanceOf(MockStringField);
    expect(entry.defenceCategories.options.initial).toEqual(["physical", "mental", "social"]);
  });

  it("recoveryEffects は BooleanField・既定 false（《人命救助》＝スタイル技能の効果も解除できる）", () => {
    expect(entry.recoveryEffects).toBeInstanceOf(MockBooleanField);
    expect(entry.recoveryEffects.options.initial).toBe(false);
  });

  it("recoverySceneLimit は StringField・既定 none（terminal=終端状態のみそのシーン／all=すべてそのシーン）", () => {
    expect(entry.recoverySceneLimit).toBeInstanceOf(MockStringField);
    expect(entry.recoverySceneLimit.options.initial).toBe("none");
  });
});

// ─── 即死・社会戦タイプ(フェーズ17-3)の設定 ────────────────────────────────────
describe("UsageTemplate.defineSchema()（即死・社会戦タイプの設定・17-3）", () => {
  const entry = UsageTemplate.defineSchema().actions.element.fields;

  it("killCategory は StringField・既定 physical（即死の系統: 肉体/精神）", () => {
    expect(entry.killCategory).toBeInstanceOf(MockStringField);
    expect(entry.killCategory.options.initial).toBe("physical");
  });

  it("socialDecide は StringField・既定 choose（社会戦の結果の決め方: choose=使用者がチャートの行を選ぶ／rl=RL が決める）", () => {
    expect(entry.socialDecide).toBeInstanceOf(MockStringField);
    expect(entry.socialDecide.options.initial).toBe("choose");
  });

  it("miracleInterference は StringField・既定 空（他の神業への干渉: addUse=対象の神業の使用回数を+1／requestUse=対象に神業を使わせる）", () => {
    expect(entry.miracleInterference).toBeInstanceOf(MockStringField);
    expect(entry.miracleInterference.options.initial).toBe("");
  });
});
