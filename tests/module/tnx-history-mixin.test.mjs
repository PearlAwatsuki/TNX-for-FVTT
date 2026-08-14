/**
 * @fileoverview tnx-history-mixin.mjs の純粋関数ユニットテスト
 *
 * _prepareHistoryForDisplay / _calculateTotalExp は引数のみに依存するため
 * Foundry の mock なしでテストできる。
 */

import { describe, it, expect } from "vitest";
import { TnxHistoryMixin } from "../../scripts/module/tnx-history-mixin.mjs";

const CAST_A = "Actor.aaaaaaaaaaaaaaaa";
const CAST_B = "Actor.bbbbbbbbbbbbbbbb";

/** そのキャストで出たセッション・別キャストのセッション・紐づけ無しの3種が混ざった履歴 */
const MIXED = {
  h1: { id: "h1", date: "2026-01-02", title: "第1話", exp: 3, castUuid: CAST_A },
  h2: { id: "h2", date: "2026-01-03", title: "第2話", exp: 4, castUuid: CAST_B },
  h3: { id: "h3", date: "2026-01-01", title: "旧データ", exp: 5 },
  h4: { id: "h4", date: "2026-01-04", title: "第3話", exp: 6, castUuid: CAST_A },
};

describe("_prepareHistoryForDisplay()", () => {
  it("日付昇順に並べる(日付なしは末尾)", () => {
    const map = {
      a: { id: "a", date: "2026-03-01" },
      b: { id: "b", date: "" },
      c: { id: "c", date: "2026-01-01" },
    };
    expect(TnxHistoryMixin._prepareHistoryForDisplay(map).map(e => e.id)).toEqual(["c", "a", "b"]);
  });

  it("キャストの指定がなければ全件返す(同期していないキャスト＝履歴が元々そのキャスト固有)", () => {
    expect(TnxHistoryMixin._prepareHistoryForDisplay(MIXED).map(e => e.id))
      .toEqual(["h3", "h1", "h2", "h4"]);
  });

  it("キャストを指定すると、そのキャストで出たセッションだけを返す", () => {
    expect(TnxHistoryMixin._prepareHistoryForDisplay(MIXED, CAST_A).map(e => e.id))
      .toEqual(["h1", "h4"]);
  });

  it("紐づけの無い行は、どのキャストを指定しても出さない(既存データ・レコードシートで足した行)", () => {
    const ids = TnxHistoryMixin._prepareHistoryForDisplay(MIXED, CAST_B).map(e => e.id);
    expect(ids).toEqual(["h2"]);
    expect(ids).not.toContain("h3");
  });

  it("絞り込み後も日付昇順を保つ", () => {
    const map = {
      x: { id: "x", date: "2026-05-05", castUuid: CAST_A },
      y: { id: "y", date: "2026-02-02", castUuid: CAST_A },
      z: { id: "z", date: "", castUuid: CAST_A },
    };
    expect(TnxHistoryMixin._prepareHistoryForDisplay(map, CAST_A).map(e => e.id))
      .toEqual(["y", "x", "z"]);
  });

  it("該当が無ければ空配列を返す", () => {
    expect(TnxHistoryMixin._prepareHistoryForDisplay(MIXED, "Actor.zzzzzzzzzzzzzzzz")).toEqual([]);
  });

  it("履歴が空/未定義でも落ちない", () => {
    expect(TnxHistoryMixin._prepareHistoryForDisplay({}, CAST_A)).toEqual([]);
    expect(TnxHistoryMixin._prepareHistoryForDisplay(undefined, CAST_A)).toEqual([]);
    expect(TnxHistoryMixin._prepareHistoryForDisplay(null)).toEqual([]);
  });
});

describe("_calculateTotalExp()", () => {
  it("絞り込みとは無関係に全件を合計する(総経験点はプレイヤー付与のため)", () => {
    expect(TnxHistoryMixin._calculateTotalExp(MIXED)).toBe(18);
  });

  it("空/未定義は 0", () => {
    expect(TnxHistoryMixin._calculateTotalExp({})).toBe(0);
    expect(TnxHistoryMixin._calculateTotalExp(undefined)).toBe(0);
  });
});
