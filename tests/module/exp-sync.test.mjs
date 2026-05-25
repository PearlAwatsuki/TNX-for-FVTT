/**
 * @fileoverview exp-sync.mjs の純粋関数ユニットテスト
 *
 * calcSharedSpent は Foundry 不要の純粋関数のため
 * setup.mjs の mock なしでテストできる。
 */

import { describe, it, expect } from "vitest";
import { calcSharedSpent, buildCastHistorySyncUpdate } from "../../scripts/module/exp-sync.mjs";

describe("calcSharedSpent()", () => {
  it("空配列の場合 0 を返す", () => {
    expect(calcSharedSpent([])).toBe(0);
  });

  it("cast が1つで spent <= additional の場合 0 を返す(溢れなし)", () => {
    expect(calcSharedSpent([{ spent: 100, additional: 100 }])).toBe(0);
    expect(calcSharedSpent([{ spent: 50, additional: 100 }])).toBe(0);
  });

  it("cast が1つで spent > additional の場合 overflow を返す", () => {
    expect(calcSharedSpent([{ spent: 170, additional: 0 }])).toBe(170);
    expect(calcSharedSpent([{ spent: 200, additional: 50 }])).toBe(150);
  });

  it("複数 cast の overflow を合計する", () => {
    const list = [
      { spent: 200, additional: 50 },  // overflow: 150
      { spent: 100, additional: 30 },  // overflow: 70
    ];
    expect(calcSharedSpent(list)).toBe(220);
  });

  it("overflow が負にならない(additional が spent より大きい場合)", () => {
    const list = [
      { spent: 50, additional: 200 },  // overflow: 0(負にならない)
      { spent: 80, additional: 10 },   // overflow: 70
    ];
    expect(calcSharedSpent(list)).toBe(70);
  });

  it("文字列数値を正しく Number に変換する", () => {
    expect(calcSharedSpent([{ spent: "150", additional: "50" }])).toBe(100);
  });

  it("NaN / undefined / null のフィールドは 0 扱い", () => {
    expect(calcSharedSpent([{ spent: undefined, additional: undefined }])).toBe(0);
    expect(calcSharedSpent([{ spent: null, additional: null }])).toBe(0);
    expect(calcSharedSpent([{ spent: NaN, additional: NaN }])).toBe(0);
  });

  it("小数点を含む値は正しく計算する", () => {
    expect(calcSharedSpent([{ spent: 100.5, additional: 50.5 }])).toBe(50);
  });
});

describe("buildCastHistorySyncUpdate()", () => {
  it("両マップが空の場合は空オブジェクトを返す", () => {
    expect(buildCastHistorySyncUpdate({}, {})).toEqual({});
  });

  it("null/undefined は空マップとして扱う", () => {
    expect(buildCastHistorySyncUpdate(null, null)).toEqual({});
    expect(buildCastHistorySyncUpdate(undefined, undefined)).toEqual({});
  });

  it("新規エントリは追加される", () => {
    const result = buildCastHistorySyncUpdate({}, { "id1": { exp: 10, memo: "test" } });
    expect(result).toEqual({ "system.history.id1": { exp: 10, memo: "test" } });
  });

  it("既存エントリは上書きされる", () => {
    const old = { "id1": { exp: 10 } };
    const newMap = { "id1": { exp: 20 } };
    const result = buildCastHistorySyncUpdate(old, newMap);
    expect(result).toEqual({ "system.history.id1": { exp: 20 } });
  });

  it("旧にあって新にないエントリは -= 構文で削除される", () => {
    const old = { "id1": { exp: 10 }, "id2": { exp: 5 } };
    const newMap = { "id1": { exp: 10 } };
    const result = buildCastHistorySyncUpdate(old, newMap);
    expect(result).toEqual({
      "system.history.-=id2": null,
      "system.history.id1": { exp: 10 },
    });
  });

  it("全エントリ削除の場合は全て -= キーになる", () => {
    const old = { "id1": { exp: 10 } };
    const result = buildCastHistorySyncUpdate(old, {});
    expect(result).toEqual({ "system.history.-=id1": null });
  });

  it("追加・削除・上書きが混在する場合を正しく処理する", () => {
    const old = { "keep": { exp: 5 }, "del": { exp: 3 } };
    const newMap = { "keep": { exp: 99 }, "add": { exp: 1 } };
    const result = buildCastHistorySyncUpdate(old, newMap);
    expect(result).toEqual({
      "system.history.-=del": null,
      "system.history.keep": { exp: 99 },
      "system.history.add": { exp: 1 },
    });
  });
});
