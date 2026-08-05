import { describe, it, expect } from "vitest";
import { resolveTurnOrder, nextActiveMain, confirmMain, firstSpotId, nextSpotId, isMajorActionTiming } from "../../scripts/module/combat-turn-order.mjs";

// 参加者の素データ(Foundry 非依存)。Combatant 側でこの形へ写像する。
const P = (over = {}) => ({
  id: "x", csCurrent: 0, csBase: 0, actorType: "cast", userOrder: 0, ar: 1, ...over,
});

describe("resolveTurnOrder()（手番順＝CSカレント降順＋同値時優先順位・Combat_Flow §3）", () => {
  it("CSカレントの高い順を主キーにする（先頭＝先に手番）", () => {
    const order = resolveTurnOrder([
      P({ id: "a", csCurrent: 5 }),
      P({ id: "b", csCurrent: 9 }),
      P({ id: "c", csCurrent: 7 }),
    ]);
    expect(order.map(p => p.id)).toEqual(["b", "c", "a"]);
  });

  it("CSカレント同値なら CSベースの高い順（優先順位①）", () => {
    const order = resolveTurnOrder([
      P({ id: "a", csCurrent: 8, csBase: 3 }),
      P({ id: "b", csCurrent: 8, csBase: 6 }),
    ]);
    expect(order.map(p => p.id)).toEqual(["b", "a"]);
  });

  it("CS両方同値なら種別順 ゲスト→キャスト→トループ（優先順位②）。エキストラは行動できないため手番順に含めない", () => {
    const order = resolveTurnOrder([
      P({ id: "t", actorType: "troop" }),
      P({ id: "e", actorType: "extra" }),
      P({ id: "g", actorType: "guest" }),
      P({ id: "c", actorType: "cast" }),
    ]);
    expect(order.map(p => p.id)).toEqual(["g", "c", "t"]);
  });

  it("エキストラは CS/AR に関わらず手番順から除外する（巻き込まれても行動しない存在）", () => {
    const order = resolveTurnOrder([
      P({ id: "e", actorType: "extra", csCurrent: 99, ar: 5 }),
      P({ id: "c", actorType: "cast", csCurrent: 3 }),
    ]);
    expect(order.map(p => p.id)).toEqual(["c"]);
  });

  it("種別まで同値ならユーザー順の昇順（優先順位④＝RL の左隣から右回りの代替）", () => {
    const order = resolveTurnOrder([
      P({ id: "a", userOrder: 2 }),
      P({ id: "b", userOrder: 1 }),
      P({ id: "c", userOrder: 0 }),
    ]);
    expect(order.map(p => p.id)).toEqual(["c", "b", "a"]);
  });

  it("全要素同値なら id の昇順で安定・決定的に並べる（最終タイブレーク）", () => {
    const order = resolveTurnOrder([P({ id: "b" }), P({ id: "a" }), P({ id: "c" })]);
    expect(order.map(p => p.id)).toEqual(["a", "b", "c"]);
  });

  it("入力配列を破壊しない（新しい配列を返す）", () => {
    const input = [P({ id: "a", csCurrent: 1 }), P({ id: "b", csCurrent: 2 })];
    const snapshot = input.map(p => p.id);
    resolveTurnOrder(input);
    expect(input.map(p => p.id)).toEqual(snapshot);
  });

  it("空配列は空配列を返す", () => {
    expect(resolveTurnOrder([])).toEqual([]);
  });
});

describe("nextActiveMain()（次の手番＝CSカレント最大かつ AR≥1 の1体・Combat_Flow §4）", () => {
  it("手番順で最上位かつ AR≥1 の1体を返す", () => {
    const p = nextActiveMain([
      P({ id: "a", csCurrent: 5, ar: 1 }),
      P({ id: "b", csCurrent: 9, ar: 1 }),
    ]);
    expect(p.id).toBe("b");
  });

  it("最上位が AR0 なら飛ばして次の AR≥1 を返す（行動不能の確認は別途）", () => {
    const p = nextActiveMain([
      P({ id: "a", csCurrent: 9, ar: 0 }),
      P({ id: "b", csCurrent: 7, ar: 1 }),
      P({ id: "c", csCurrent: 5, ar: 2 }),
    ]);
    expect(p.id).toBe("b");
  });

  it("全員 AR0 なら null（メインプロセスを行える者がいない）", () => {
    const p = nextActiveMain([
      P({ id: "a", csCurrent: 9, ar: 0 }),
      P({ id: "b", csCurrent: 7, ar: 0 }),
    ]);
    expect(p).toBeNull();
  });

  it("エキストラは最上位で AR≥1 でも手番にならない（行動できない）", () => {
    const p = nextActiveMain([
      P({ id: "e", actorType: "extra", csCurrent: 99, ar: 3 }),
      P({ id: "c", actorType: "cast", csCurrent: 5, ar: 1 }),
    ]);
    expect(p.id).toBe("c");
  });

  it("空配列は null", () => {
    expect(nextActiveMain([])).toBeNull();
  });

  it("行動できない者（戦闘不能タグ/脱落マーク＝cantAct）は候補にならない", () => {
    const p = nextActiveMain([
      P({ id: "a", csCurrent: 9, ar: 2, cantAct: true }),
      P({ id: "b", csCurrent: 7, ar: 1 }),
    ]);
    expect(p.id).toBe("b");
  });
});

describe("confirmMain()（イニシアチブの確認＝行動不能の AR−1 を伴う・Combat_Flow §4）", () => {
  it("最上位が行動可能ならそのままメインへ・ペナルティなし", () => {
    expect(confirmMain([
      P({ id: "a", csCurrent: 9, ar: 1 }),
      P({ id: "b", csCurrent: 7, ar: 1 }),
    ])).toEqual({ mainId: "a", penalizedIds: [] });
  });

  it("行動できない最上位（AR≥1）は AR−1 の対象になり、確認は次点へ進む", () => {
    expect(confirmMain([
      P({ id: "a", csCurrent: 9, ar: 2, cantAct: true }),
      P({ id: "b", csCurrent: 7, ar: 1 }),
    ])).toEqual({ mainId: "b", penalizedIds: ["a"] });
  });

  it("行動できない者が複数上位にいれば各1回ずつ AR−1", () => {
    expect(confirmMain([
      P({ id: "a", csCurrent: 9, ar: 1, cantAct: true }),
      P({ id: "b", csCurrent: 8, ar: 2, cantAct: true }),
      P({ id: "c", csCurrent: 5, ar: 1 }),
    ])).toEqual({ mainId: "c", penalizedIds: ["a", "b"] });
  });

  it("メインより下位の行動不能者・AR0 の行動不能者はペナルティを受けない", () => {
    expect(confirmMain([
      P({ id: "a", csCurrent: 9, ar: 1 }),
      P({ id: "b", csCurrent: 7, ar: 1, cantAct: true }),  // 下位=最上位になっていない
      P({ id: "c", csCurrent: 8, ar: 0, cantAct: true }),  // AR0=そもそも対象外
    ])).toEqual({ mainId: "a", penalizedIds: [] });
  });

  it("行動可能者がいなければ mainId null（→クリンナップ）・上位の行動不能者は AR−1", () => {
    expect(confirmMain([
      P({ id: "a", csCurrent: 9, ar: 1, cantAct: true }),
      P({ id: "b", csCurrent: 7, ar: 0 }),
    ])).toEqual({ mainId: null, penalizedIds: ["a"] });
  });
});

describe("firstSpotId() / nextSpotId()（サブターン内のスポット走査＝プロセスごとの行動権を CS順に渡す）", () => {
  const list = [
    P({ id: "a", csCurrent: 9 }),
    P({ id: "b", csCurrent: 7 }),
    P({ id: "e", actorType: "extra", csCurrent: 99 }), // 行動できない=走査に含めない
    P({ id: "c", csCurrent: 5 }),
  ];

  it("firstSpotId は CS順の先頭（エキストラ除外）", () => {
    expect(firstSpotId(list)).toBe("a");
    expect(firstSpotId([])).toBeNull();
    expect(firstSpotId([P({ id: "e", actorType: "extra" })])).toBeNull();
  });

  it("nextSpotId は現スポットの次（CS順）・最後なら null（＝フェーズ送り）", () => {
    expect(nextSpotId(list, "a")).toBe("b");
    expect(nextSpotId(list, "b")).toBe("c");
    expect(nextSpotId(list, "c")).toBeNull();
  });

  it("現スポットが不明・不在なら先頭へ（途中離脱に頑健）", () => {
    expect(nextSpotId(list, "zzz")).toBe("a");
    expect(nextSpotId(list, null)).toBe("a");
  });

  it("AR 0 でも走査には含まれる（スポットはメイン資格と別＝プロセスの行動権）", () => {
    const l = [P({ id: "a", csCurrent: 9, ar: 0 }), P({ id: "b", csCurrent: 7, ar: 1 })];
    expect(firstSpotId(l)).toBe("a");
    expect(nextSpotId(l, "a")).toBe("b");
  });

  it("行動できない者（戦闘不能タグ/脱落マーク）は走査から除外する（脱落扱い・2026-07-22）", () => {
    const l = [
      P({ id: "a", csCurrent: 9, cantAct: true }),
      P({ id: "b", csCurrent: 7 }),
      P({ id: "c", csCurrent: 5, cantAct: true }),
      P({ id: "d", csCurrent: 3 }),
    ];
    expect(firstSpotId(l)).toBe("b");
    expect(nextSpotId(l, "b")).toBe("d");
    expect(nextSpotId(l, "d")).toBeNull();
    expect(firstSpotId([P({ id: "a", cantAct: true })])).toBeNull();
  });

  it("eligibleIds を渡すと、その集合に含まれる参加者だけにスポットが止まる（用途のあるプロセス・13-6準備）", () => {
    // a(CS9)/b(CS7)/c(CS5) のうち、そのプロセスに使える用途を持つのは b と c だけ
    const eligible = new Set(["b", "c"]);
    expect(firstSpotId(list, eligible)).toBe("b");     // a は該当なしで飛ばす
    expect(nextSpotId(list, "b", eligible)).toBe("c");
    expect(nextSpotId(list, "c", eligible)).toBeNull(); // 末尾＝フェーズ送り
  });

  it("eligibleIds が空集合なら誰も止まらない（＝全員スキップ＝既定処理だけ）", () => {
    expect(firstSpotId(list, new Set())).toBeNull();
  });

  it("eligibleIds 省略/ null は従来どおり全員（絞り込みなし）", () => {
    expect(firstSpotId(list, null)).toBe("a");
    expect(firstSpotId(list)).toBe("a");
  });
});

describe("isMajorActionTiming()（用途タイミング→メジャーアクション判定・2026-07-26 一般則）", () => {
  it("timing.value==='action' かつ actionName==='major' はメジャー（プロセス終了時 AR−1）", () => {
    expect(isMajorActionTiming({ value: "action", actionName: "major" })).toBe(true);
  });

  it("timing.value==='initiativeMajor'（イニシアチブ（メジャー）＝支援判定）もメジャー", () => {
    expect(isMajorActionTiming({ value: "initiativeMajor", actionName: "blank" })).toBe(true);
  });

  it("ムーブ／マイナー／リアクション／オートはメジャーでない", () => {
    expect(isMajorActionTiming({ value: "action", actionName: "move" })).toBe(false);
    expect(isMajorActionTiming({ value: "action", actionName: "minor" })).toBe(false);
    expect(isMajorActionTiming({ value: "action", actionName: "reaction" })).toBe(false);
    expect(isMajorActionTiming({ value: "action", actionName: "auto" })).toBe(false);
  });

  it("プロセス既定処理・常時・神業・ダメージ算出系はメジャーでない", () => {
    expect(isMajorActionTiming({ value: "process", processName: "setup" })).toBe(false);
    expect(isMajorActionTiming({ value: "always", actionName: "blank" })).toBe(false);
    expect(isMajorActionTiming({ value: "miracle", actionName: "blank" })).toBe(false);
    expect(isMajorActionTiming({ value: "onCalcDmage", actionName: "blank" })).toBe(false);
  });

  it("未設定/空/blank は安全に false", () => {
    expect(isMajorActionTiming(null)).toBe(false);
    expect(isMajorActionTiming(undefined)).toBe(false);
    expect(isMajorActionTiming({})).toBe(false);
    expect(isMajorActionTiming({ value: "blank", actionName: "blank" })).toBe(false);
  });
});
