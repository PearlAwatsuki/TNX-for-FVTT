import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveConsumeRows, buildConsumptionPlan, matchSharedItem, deriveConsumeTargets } =
  await import("../../scripts/module/usage-consumption.mjs");

const skill = (id, { isLimit = true, max = 3, spent = 1, name = "技能" } = {}) => ({
  id, type: "styleSkill", name, system: { uses: { isLimit, max, spent } },
});
// 神業も汎用 uses に一本化(2026-07-18)
const miracle = (id, { isLimit = true, max = 2, spent = 1, name = "神業" } = {}) => ({
  id, type: "miracle", name, system: { uses: { isLimit, max, spent } },
});
const weapon = (id, { value = 6, current = null, name = "武器" } = {}) => ({
  id, type: "weapon", name, system: { ammo: { mode: "value", value, current } },
});

describe("resolveConsumeRows()（消費先設定の解決・2026-07-18 再編）", () => {
  it("item/self/uses(制限あり): kind uses・残量 = max - spent・itemId は親", () => {
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "", resource: "uses", amount: 1 }],
      { parentItem: skill("p1", { max: 3, spent: 1 }), getItem: () => null },
    );
    expect(row.kind).toBe("uses");
    expect(row.remaining).toBe(2);
    expect(row.maxDisplay).toBe(3);
    expect(row.itemId).toBe("p1");
  });

  it("item/self/uses(制限なし): inert(無消費)", () => {
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "", resource: "uses", amount: 1 }],
      { parentItem: skill("p1", { isLimit: false }), getItem: () => null },
    );
    expect(row.inert).toBe(true);
    expect(row.kind).toBeUndefined();
  });

  it("item/self/uses が神業: 特例なし=汎用 uses と同じ kind uses(残量=max−spent)", () => {
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "", resource: "uses", amount: 1 }],
      { parentItem: miracle("m1", { max: 2, spent: 1 }), getItem: () => null },
    );
    expect(row.kind).toBe("uses");
    expect(row.remaining).toBe(1);
    expect(row.maxDisplay).toBe(2);
  });

  it("item/itemId/uses: getItem で解決し、見つからなければ problem notFound", () => {
    const items = { s2: skill("s2", { max: 2, spent: 0, name: "別技能" }) };
    const rows = resolveConsumeRows(
      [{ type: "item", itemId: "s2", resource: "uses", amount: 2 }, { type: "item", itemId: "zz", resource: "uses", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(rows[0].kind).toBe("uses");
    expect(rows[0].remaining).toBe(2);
    expect(rows[0].amount).toBe(2);
    expect(rows[1].problem).toBe("notFound");
  });

  it("item/itemId/ammo: kind ammo・残量=残弾・maxDisplay=装弾数・負値=回復を許容", () => {
    const items = { w1: weapon("w1", { value: 6, current: 4 }) };
    const rows = resolveConsumeRows(
      [{ type: "item", itemId: "w1", resource: "ammo", amount: 1 }, { type: "item", itemId: "w1", resource: "ammo", amount: -3 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(rows[0].kind).toBe("ammo");
    expect(rows[0].remaining).toBe(4);
    expect(rows[0].maxDisplay).toBe(6);
    expect(rows[1].amount).toBe(-3); // 回復
  });

  it("ammo が残弾管理のない対象を指すと problem noAmmo", () => {
    const items = { s2: skill("s2") };
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "s2", resource: "ammo", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(row.problem).toBe("noAmmo");
  });

  it("消費量は 1 未満・未設定を 1 に丸める(残弾以外)", () => {
    const rows = resolveConsumeRows(
      [{ type: "item", itemId: "", resource: "uses" }, { type: "item", itemId: "", resource: "uses", amount: 0 }],
      { parentItem: skill("p1"), getItem: () => null },
    );
    expect(rows[0].amount).toBe(1);
    expect(rows[1].amount).toBe(1);
  });

  describe("actionRank（AR の消費・2026-07-12＝パリー専用自動化の置換）", () => {
    it("カット進行中: kind ar・残量 = actionRank.value・itemId はセンチネル @ar", () => {
      const [row] = resolveConsumeRows(
        [{ type: "actionRank", amount: 1 }],
        { parentItem: skill("p1"), getItem: () => null, actionRank: { value: 2, maxTotal: 3, inCombat: true } },
      );
      expect(row.kind).toBe("ar");
      expect(row.remaining).toBe(2);
      expect(row.maxDisplay).toBe(3);
      expect(row.itemId).toBe("@ar");
      expect(row.label).toBe("AR");
    });

    it("カット進行外: 消費不可＝残量 0 扱いで原則ブロック（AR を消費する能力は進行外では使えない・2026-07-12 ユーザー訂正）", () => {
      const [row] = resolveConsumeRows(
        [{ type: "actionRank", amount: 1 }],
        { parentItem: skill("p1"), getItem: () => null, actionRank: { value: 3, maxTotal: 3, inCombat: false } },
      );
      expect(row.kind).toBe("ar");
      expect(row.remaining).toBe(0);
      expect(row.outOfCombat).toBe(true);
      const result = buildConsumptionPlan([row], new Set(["@ar"]), "actor1");
      expect(result.shortage).toBeDefined();
    });

    it("actionRank コンテキスト無し（アクター無し等）も消費不可扱い", () => {
      const [row] = resolveConsumeRows(
        [{ type: "actionRank", amount: 1 }],
        { parentItem: skill("p1"), getItem: () => null },
      );
      expect(row.kind).toBe("ar");
      expect(row.remaining).toBe(0);
      expect(row.outOfCombat).toBe(true);
    });

    it("AR 0 でチェック済みなら shortage（原則ブロック・チェックを外せば実行可）", () => {
      const [row] = resolveConsumeRows(
        [{ type: "actionRank", amount: 1 }],
        { parentItem: skill("p1"), getItem: () => null, actionRank: { value: 0, maxTotal: 3, inCombat: true } },
      );
      const result = buildConsumptionPlan([row], new Set(["@ar"]), "actor1");
      expect(result.shortage).toBeDefined();
    });

    it("プラン化: kind ar・実行アクターに帰属（分身でも本体へ差し替えない）", () => {
      const [row] = resolveConsumeRows(
        [{ type: "actionRank", amount: 2 }],
        { parentItem: skill("p1"), getItem: () => null, actionRank: { value: 3, maxTotal: 3, inCombat: true } },
      );
      const { plan } = buildConsumptionPlan([row], new Set(["@ar"]), "actor1");
      expect(plan).toEqual([{ actorId: "actor1", itemId: "@ar", kind: "ar", amount: 2 }]);
    });
  });
});

describe("buildConsumptionPlan()（消費プランの構築）", () => {
  const rows = [
    { kind: "uses", itemId: "a", amount: 1, remaining: 2, label: "A" },
    { kind: "ammo", itemId: "b", amount: 1, remaining: 1, label: "B" },
    { inert: true, itemId: "c", amount: 1 },
    { problem: "notFound", itemId: "d", amount: 1 },
  ];

  it("チェック済みの消費可能行のみプラン化し、fallbackActorId を付与する", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["a", "b", "c", "d"]), "actor1");
    expect(plan).toEqual([
      { actorId: "actor1", itemId: "a", kind: "uses", amount: 1 },
      { actorId: "actor1", itemId: "b", kind: "ammo", amount: 1 },
    ]);
  });

  it("チェックを外した行は消費しない", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["b"]), "actor1");
    expect(plan).toEqual([{ actorId: "actor1", itemId: "b", kind: "ammo", amount: 1 }]);
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

describe("deriveConsumeTargets()（自動入力の消費行導出・2026-07-18 item/resource へ）", () => {
  it("isLimit つき参加技能×1 のみ導出する（親は itemId 空=このアイテム自身）", () => {
    const skills = [
      skill("parent1", { isLimit: true }),
      skill("s1", { isLimit: true }),
      skill("s2", { isLimit: false }),
      skill("s3", { isLimit: true }),
    ];
    expect(deriveConsumeTargets("parent1", skills)).toEqual([
      { type: "item", itemId: "", resource: "uses", amount: 1 },
      { type: "item", itemId: "s1", resource: "uses", amount: 1 },
      { type: "item", itemId: "s3", resource: "uses", amount: 1 },
    ]);
  });

  it("制限つきが1つも無ければ空（旧・親×1 既定はユーザー指示で全廃）", () => {
    expect(deriveConsumeTargets("p", [skill("p", { isLimit: false }), skill("a", { isLimit: false })]))
      .toEqual([]);
  });

  it("親自身は itemId 空（このアイテム自身）で1行・二重消費防止", () => {
    const rows = deriveConsumeTargets("p", [skill("p", { isLimit: true })]);
    expect(rows).toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
  });
});

describe("matchSharedItem()（分身→本体の同一能力照合・Troops.md 使用回数共有）", () => {
  const mk = (id, type, name, key) => ({ id, type, name, system: { identificationKey: key ?? "" } });
  const owner = [
    mk("o1", "styleSkill", "旧名の技能", "fireArts"),
    mk("o2", "styleSkill", "同名の技能", ""),
    mk("o3", "weapon",     "同名の技能", ""),
  ];

  it("識別キー一致（同タイプ）を最優先で返す（名前が違っても結ぶ）", () => {
    const hit = matchSharedItem(owner, mk("b1", "styleSkill", "新名の技能", "fireArts"));
    expect(hit?.id).toBe("o1");
  });

  it("キーが無ければ名前一致（同タイプ）にフォールバックする", () => {
    const hit = matchSharedItem(owner, mk("b2", "styleSkill", "同名の技能", ""));
    expect(hit?.id).toBe("o2");
  });

  it("タイプが違えば同名でも結ばない", () => {
    const hit = matchSharedItem(owner, mk("b3", "tap", "同名の技能", ""));
    expect(hit).toBeNull();
  });

  it("一致なしは null（呼び出し側でローカル消費にフォールバック）", () => {
    const hit = matchSharedItem(owner, mk("b4", "styleSkill", "存在しない", "noKey"));
    expect(hit).toBeNull();
  });
});
