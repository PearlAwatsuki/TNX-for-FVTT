/**
 * @fileoverview TnxUserFlag スキーマヘルパーのユニットテスト
 * Foundry 環境不要(純粋な JS 関数テスト)。
 */

import { describe, it, expect } from "vitest";
import { getUserFlagData, getUserFlagHistorySorted, TNX_FLAG_SCOPE } from "../../scripts/module/user-flag-schema.mjs";

describe("getUserFlagData()", () => {
  describe("フラグ未設定時の初期値", () => {
    it("flags プロパティ自体がない場合、全フィールドに初期値を返す", () => {
      const data = getUserFlagData({});
      expect(data.history).toEqual({});
      expect(data.exp).toEqual({ total: 0, value: 0, spent: 0 });
      expect(data.handPileId).toBe("");
      expect(data.trumpCardPileId).toBe("");
      expect(data.handMaxSize).toBe(4);
    });

    it("flags が空オブジェクトの場合、全フィールドに初期値を返す", () => {
      const data = getUserFlagData({ flags: {} });
      expect(data.history).toEqual({});
      expect(data.exp.total).toBe(0);
      expect(data.handMaxSize).toBe(4);
    });

    it("スコープキーが存在しない場合、全フィールドに初期値を返す", () => {
      const data = getUserFlagData({ flags: { "other-system": { foo: 1 } } });
      expect(data.handMaxSize).toBe(4);
      expect(data.handPileId).toBe("");
    });

    it("user が null/undefined の場合、全フィールドに初期値を返す", () => {
      expect(getUserFlagData(null).handMaxSize).toBe(4);
      expect(getUserFlagData(undefined).exp.total).toBe(0);
    });
  });

  describe("フラグ設定済みの場合", () => {
    const makeUser = (flags) => ({
      flags: { [TNX_FLAG_SCOPE]: flags },
    });

    it("handMaxSize が設定されている場合、その値を返す", () => {
      const data = getUserFlagData(makeUser({ handMaxSize: 6 }));
      expect(data.handMaxSize).toBe(6);
    });

    it("handPileId と trumpCardPileId を返す", () => {
      const data = getUserFlagData(makeUser({
        handPileId: "uuid-hand",
        trumpCardPileId: "uuid-trump",
      }));
      expect(data.handPileId).toBe("uuid-hand");
      expect(data.trumpCardPileId).toBe("uuid-trump");
    });

    it("exp の各フィールドを返す", () => {
      const data = getUserFlagData(makeUser({
        exp: { total: 15, value: 8, spent: 7 },
      }));
      expect(data.exp.total).toBe(15);
      expect(data.exp.value).toBe(8);
      expect(data.exp.spent).toBe(7);
    });

    it("exp が部分的に設定されている場合、未設定キーは初期値を返す", () => {
      const data = getUserFlagData(makeUser({ exp: { total: 10 } }));
      expect(data.exp.total).toBe(10);
      expect(data.exp.value).toBe(0);
      expect(data.exp.spent).toBe(0);
    });

    it("history オブジェクトを返す", () => {
      const entry = { id: "abc", date: "2026-01-01", title: "テスト", exp: 3, rl: "RL1", players: "P1" };
      const data = getUserFlagData(makeUser({ history: { abc: entry } }));
      expect(data.history.abc).toEqual(entry);
    });

    it("設定済みフラグと未設定フラグが混在する場合、それぞれ正しく返す", () => {
      const data = getUserFlagData(makeUser({ handMaxSize: 5 }));
      expect(data.handMaxSize).toBe(5);
      expect(data.handPileId).toBe("");   // 未設定 → 初期値
      expect(data.exp.total).toBe(0);    // 未設定 → 初期値
    });
  });
});

describe("getUserFlagHistorySorted()", () => {
  const makeUser = (history) => ({
    flags: { [TNX_FLAG_SCOPE]: { history } },
  });

  it("history が空の場合、空配列を返す", () => {
    expect(getUserFlagHistorySorted({})).toEqual([]);
  });

  it("history が未設定の場合、空配列を返す", () => {
    expect(getUserFlagHistorySorted({ flags: {} })).toEqual([]);
  });

  it("日付昇順で並ぶ", () => {
    const result = getUserFlagHistorySorted(makeUser({
      c: { id: "c", date: "2026-03-01", title: "C", exp: 1, rl: "", players: "" },
      a: { id: "a", date: "2026-01-01", title: "A", exp: 2, rl: "", players: "" },
      b: { id: "b", date: "2026-02-01", title: "B", exp: 3, rl: "", players: "" },
    }));
    expect(result.map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("日付なし行は末尾に並ぶ", () => {
    const result = getUserFlagHistorySorted(makeUser({
      x: { id: "x", date: "",           title: "X", exp: 0, rl: "", players: "" },
      y: { id: "y", date: "2026-01-01", title: "Y", exp: 1, rl: "", players: "" },
    }));
    expect(result[0].id).toBe("y");
    expect(result[1].id).toBe("x");
  });

  it("返す配列は Object.values のコピー(元の history オブジェクトを変更しない)", () => {
    const history = {
      a: { id: "a", date: "2026-06-01", title: "A", exp: 1, rl: "", players: "" },
    };
    getUserFlagHistorySorted(makeUser(history));
    expect(Object.keys(history)).toEqual(["a"]); // 元の順序は保持
  });
});
