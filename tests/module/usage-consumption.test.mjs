import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveConsumeRows, buildConsumptionPlan } =
  await import("../../scripts/module/usage-consumption.mjs");

const skill = (id, { isLimit = true, max = 3, spent = 1, name = "技能" } = {}) => ({
  id, type: "styleSkill", name, system: { uses: { isLimit, max, spent } },
});
const miracle = (id, { value = 1, total = 1, mod = 0, name = "神業" } = {}) => ({
  id, type: "miracle", name, system: { usageCount: { value, total, mod } },
});

describe("resolveConsumeRows()（消費先設定の解決・11-6）", () => {
  it("parent(uses 制限あり): kind uses・残量 = max - spent", () => {
    const [row] = resolveConsumeRows(
      [{ type: "parent", amount: 1 }],
      { parentItem: skill("p1", { max: 3, spent: 1 }), getItem: () => null },
    );
    expect(row.kind).toBe("uses");
    expect(row.remaining).toBe(2);
    expect(row.maxDisplay).toBe(3);
    expect(row.itemId).toBe("p1");
  });

  it("parent(制限なし): inert（親×1 互換行が従来同一=無消費になる）", () => {
    const [row] = resolveConsumeRows(
      [{ type: "parent", amount: 1 }],
      { parentItem: skill("p1", { isLimit: false }), getItem: () => null },
    );
    expect(row.inert).toBe(true);
    expect(row.kind).toBeUndefined();
  });

  it("parent が神業: kind miracleUses・残量 = usageCount.value・表示分母 = total + mod", () => {
    const [row] = resolveConsumeRows(
      [{ type: "parent", amount: 1 }],
      { parentItem: miracle("m1", { value: 1, total: 1, mod: 1 }), getItem: () => null },
    );
    expect(row.kind).toBe("miracleUses");
    expect(row.remaining).toBe(1);
    expect(row.maxDisplay).toBe(2);
  });

  it("itemUses: getItem で解決し、見つからなければ problem notFound", () => {
    const items = { s2: skill("s2", { max: 2, spent: 0, name: "別技能" }) };
    const rows = resolveConsumeRows(
      [{ type: "itemUses", itemId: "s2", amount: 2 }, { type: "itemUses", itemId: "zz", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(rows[0].kind).toBe("uses");
    expect(rows[0].remaining).toBe(2);
    expect(rows[0].amount).toBe(2);
    expect(rows[1].problem).toBe("notFound");
  });

  it("miracleUses が神業以外を指すと problem notMiracle", () => {
    const items = { s2: skill("s2") };
    const [row] = resolveConsumeRows(
      [{ type: "miracleUses", itemId: "s2" }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(row.problem).toBe("notMiracle");
  });

  it("消費量は 1 未満・未設定を 1 に丸める", () => {
    const rows = resolveConsumeRows(
      [{ type: "parent" }, { type: "parent", amount: 0 }],
      { parentItem: skill("p1"), getItem: () => null },
    );
    expect(rows[0].amount).toBe(1);
    expect(rows[1].amount).toBe(1);
  });
});

describe("buildConsumptionPlan()（消費プランの構築）", () => {
  const rows = [
    { kind: "uses", itemId: "a", amount: 1, remaining: 2, label: "A" },
    { kind: "miracleUses", itemId: "b", amount: 1, remaining: 1, label: "B" },
    { inert: true, itemId: "c", amount: 1 },
    { problem: "notFound", itemId: "d", amount: 1 },
  ];

  it("チェック済みの消費可能行のみプラン化し、fallbackActorId を付与する", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["a", "b", "c", "d"]), "actor1");
    expect(plan).toEqual([
      { actorId: "actor1", itemId: "a", kind: "uses", amount: 1 },
      { actorId: "actor1", itemId: "b", kind: "miracleUses", amount: 1 },
    ]);
  });

  it("チェックを外した行は消費しない", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["b"]), "actor1");
    expect(plan).toEqual([{ actorId: "actor1", itemId: "b", kind: "miracleUses", amount: 1 }]);
  });

  it("残量不足の行がチェック済みなら shortage を返す（原則ブロック）", () => {
    const short = [{ kind: "uses", itemId: "a", amount: 3, remaining: 2, label: "A" }];
    const result = buildConsumptionPlan(short, new Set(["a"]), "actor1");
    expect(result.shortage).toBeDefined();
    expect(result.plan).toBeUndefined();
  });

  it("行の targetActorId が fallbackActorId より優先される（分身共有=本体差し替え用）", () => {
    const shared = [{ kind: "uses", itemId: "a", amount: 1, remaining: 2, targetActorId: "honntai" }];
    const { plan } = buildConsumptionPlan(shared, new Set(["a"]), "bunshin");
    expect(plan[0].actorId).toBe("honntai");
  });
});
