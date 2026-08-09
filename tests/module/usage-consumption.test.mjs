import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveConsumeRows, buildConsumptionPlan, matchSharedItem, deriveConsumeTargets, isConsumptionDepleted } =
  await import("../../scripts/module/usage-consumption.mjs");

describe("isConsumptionDepleted()（用途の消費リソースが枯渇＝使えない・13-6）", () => {
  it("消費設定なし（行が無い）は枯渇でない＝常に使える（ユーザー厳命）", () => {
    expect(isConsumptionDepleted([])).toBe(false);
    expect(isConsumptionDepleted(null)).toBe(false);
    expect(isConsumptionDepleted(undefined)).toBe(false);
  });

  it("限度ありの資源が残量不足なら枯渇", () => {
    expect(isConsumptionDepleted([{ kind: "uses", amount: 1, remaining: 0, maxDisplay: 3 }])).toBe(true);
    expect(isConsumptionDepleted([{ kind: "uses", amount: 2, remaining: 1, maxDisplay: 3 }])).toBe(true);
  });

  it("残量が足りていれば枯渇でない", () => {
    expect(isConsumptionDepleted([{ kind: "uses", amount: 1, remaining: 3, maxDisplay: 3 }])).toBe(false);
    expect(isConsumptionDepleted([{ kind: "uses", amount: 1, remaining: 1, maxDisplay: 1 }])).toBe(false);
  });

  it("使用回数制限なし（inert・remaining を持たない）は枯渇に含めない＝リソース設定なし扱い", () => {
    expect(isConsumptionDepleted([{ inert: true, amount: 1, label: "武器" }])).toBe(false);
  });

  it("対象が見つからない行（notFound・設定不備）は枯渇に含めない（過剰ブロックしない）", () => {
    expect(isConsumptionDepleted([{ problem: "notFound", amount: 1 }])).toBe(false);
  });

  it("消費量 0/負値（no-op・回復）は残量に関係なく枯渇でない", () => {
    expect(isConsumptionDepleted([{ kind: "uses", amount: 0, remaining: 0 }])).toBe(false);
    expect(isConsumptionDepleted([{ kind: "ammo", amount: -1, remaining: 0 }])).toBe(false);
  });

  it("複数行はどれか一つでも不足なら枯渇（AND で全部払えないと使えない）", () => {
    expect(isConsumptionDepleted([
      { kind: "uses", amount: 1, remaining: 5 },
      { kind: "ammo", amount: 1, remaining: 0 },
    ])).toBe(true);
  });
});

const skill = (id, { isLimit = true, max = 3, spent = 1, name = "技能" } = {}) => ({
  id, type: "styleSkill", name, system: { uses: { isLimit, max, spent } },
});
// 神業も汎用 uses に一本化(2026-07-18)
const miracle = (id, { isLimit = true, max = 2, spent = 1, name = "神業" } = {}) => ({
  id, type: "miracle", name, system: { uses: { isLimit, max, spent } },
});
// 射撃武器は使用回数と残弾の**2つの資源**を同時に持ちうる(2026-07-19 ユーザー裁定)。
// 残弾は uses と同型: 装弾数=ammo.max・撃った数=ammo.spent
const weapon = (id, {
  uses = { isLimit: false, max: 0, spent: 0 },
  ammo = { isLimit: true, max: 6, spent: 0 },
  name = "武器",
} = {}) => ({ id, type: "weapon", name, system: { uses, ammo } });

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

  it("item/self/uses: 最大値が式なら実効値 maxTotal から残量を出す(2026-08-09「レベル回」)", () => {
    const levelTimes = {
      id: "p1", type: "styleSkill", name: "技能",
      system: { uses: { isLimit: true, max: "@item.self.system.levelTotal", maxTotal: 3, spent: 1 } },
    };
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "", resource: "uses", amount: 1 }],
      { parentItem: levelTimes, getItem: () => null },
    );
    expect(row.remaining).toBe(2);   // 3 − 1
    expect(row.maxDisplay).toBe(3);  // 素値の式文字列ではなく実効値を表示する
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

  it("item/itemId/ammo: kind ammo・残量=装弾数−撃った数・負値=回復(リロード)を許容", () => {
    const items = { w1: weapon("w1", { ammo: { isLimit: true, max: 6, spent: 2 } }) };
    const rows = resolveConsumeRows(
      [{ type: "item", itemId: "w1", resource: "ammo", amount: 1 }, { type: "item", itemId: "w1", resource: "ammo", amount: -3 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(rows[0].kind).toBe("ammo");
    expect(rows[0].remaining).toBe(4);
    expect(rows[0].maxDisplay).toBe(6);
    expect(rows[0].resourceLabel).toBe("残弾");
    expect(rows[1].amount).toBe(-3); // 回復=リロード
  });

  it("残弾を管理しない武器(自動給弾)への ammo 消費は inert(無消費)", () => {
    const items = { w1: weapon("w1", { ammo: { isLimit: false, max: 0, spent: 0 } }) };
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "w1", resource: "ammo", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(row.inert).toBe(true);
    expect(row.kind).toBeUndefined();
  });

  it("同じ武器の使用回数と残弾は別行として独立に解決される(key で区別)", () => {
    const items = {
      w1: weapon("w1", {
        uses: { isLimit: true, max: 1, spent: 0 },
        ammo: { isLimit: true, max: 6, spent: 2 },
      }),
    };
    const rows = resolveConsumeRows(
      [{ type: "item", itemId: "w1", resource: "uses", amount: 1 }, { type: "item", itemId: "w1", resource: "ammo", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(rows[0].kind).toBe("uses");
    expect(rows[0].remaining).toBe(1);
    expect(rows[1].kind).toBe("ammo");
    expect(rows[1].remaining).toBe(4);
    // itemId は同じでも key が異なる=チェックボックスが連動しない
    expect(rows[0].itemId).toBe(rows[1].itemId);
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  it("item/itemId/quantity: kind quantity・残量=現在個数・最大=常備化個数(2026-07-19 追加)", () => {
    const items = {
      c1: { id: "c1", type: "general", name: "手榴弾", system: { isConsumption: true, quantity: { value: 2, max: 3 } } },
    };
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "c1", resource: "quantity", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(row.kind).toBe("quantity");
    expect(row.remaining).toBe(2);
    expect(row.maxDisplay).toBe(3);
    expect(row.resourceLabel).toBe("個数");
  });

  it("消費アイテムでないものへの quantity 消費は inert(無消費)", () => {
    const items = { s2: skill("s2") }; // isConsumption なし
    const [row] = resolveConsumeRows(
      [{ type: "item", itemId: "s2", resource: "quantity", amount: 1 }],
      { parentItem: skill("p1"), getItem: (id) => items[id] ?? null },
    );
    expect(row.inert).toBe(true);
  });

  it("同じアイテムの2資源はチェックを片方だけ外せる(key 照合・itemId 照合では連動していた)", () => {
    const rows = [
      { kind: "uses", key: "w1:uses", itemId: "w1", amount: 1, remaining: 1, label: "武器" },
      { kind: "ammo", key: "w1:ammo", itemId: "w1", amount: 1, remaining: 4, label: "武器" },
    ];
    const { plan } = buildConsumptionPlan(rows, new Set(["w1:ammo"]), "actor1");
    expect(plan).toEqual([{ actorId: "actor1", itemId: "w1", kind: "ammo", amount: 1 }]);
  });

  it("消費数はロックしない(2026-07-18): 未設定のみ 1・0/負値(=使用回数の回復)はそのまま", () => {
    const rows = resolveConsumeRows(
      [
        { type: "item", itemId: "", resource: "uses" },              // 未設定 → 1
        { type: "item", itemId: "", resource: "uses", amount: 0 },   // 0 は 0 のまま(no-op)
        { type: "item", itemId: "", resource: "uses", amount: -2 },  // 負値=回復
      ],
      { parentItem: skill("p1"), getItem: () => null },
    );
    expect(rows[0].amount).toBe(1);
    expect(rows[1].amount).toBe(0);
    expect(rows[2].amount).toBe(-2);
  });

  it("負の使用回数消費=回復: applyConsumptionPlan で spent が減り 0 未満にならない", async () => {
    const { applyConsumptionPlan } = await import("../../scripts/module/usage-consumption.mjs");
    // このテストは Foundry 依存(game.actors)のため、buildConsumptionPlan の shortage 判定のみ確認する
    const row = { kind: "uses", itemId: "a", amount: -2, remaining: 1, label: "A" };
    const { plan, shortage } = buildConsumptionPlan([row], new Set(["a"]), "actor1");
    expect(shortage).toBeUndefined();  // 回復(負値)は残量不足にならない
    expect(plan).toEqual([{ actorId: "actor1", itemId: "a", kind: "uses", amount: -2 }]);
    void applyConsumptionPlan; // 適用側の 0..max クランプは実機検証(game 依存)
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
    { kind: "ar", itemId: "@ar", amount: 1, remaining: 1, label: "AR" },
    { inert: true, itemId: "c", amount: 1 },
    { problem: "notFound", itemId: "d", amount: 1 },
  ];

  it("チェック済みの消費可能行のみプラン化し、fallbackActorId を付与する", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["a", "@ar", "c", "d"]), "actor1");
    expect(plan).toEqual([
      { actorId: "actor1", itemId: "a", kind: "uses", amount: 1 },
      { actorId: "actor1", itemId: "@ar", kind: "ar", amount: 1 },
    ]);
  });

  it("チェックを外した行は消費しない", () => {
    const { plan } = buildConsumptionPlan(rows, new Set(["@ar"]), "actor1");
    expect(plan).toEqual([{ actorId: "actor1", itemId: "@ar", kind: "ar", amount: 1 }]);
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
