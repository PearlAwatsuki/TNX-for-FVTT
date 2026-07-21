import { describe, it, expect } from "vitest";
import { resolveTurnOrder, nextActiveMain } from "../../scripts/module/combat-turn-order.mjs";

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
});
