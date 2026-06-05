/**
 * @fileoverview TnxUserFlag スキーマヘルパーのユニットテスト
 * Foundry 環境不要(純粋な JS 関数テスト)。
 */

import { vi, describe, it, expect } from "vitest";
import {
  getUserFlagData,
  getUserFlagHistorySorted,
  calcHistoryExpTotal,
  historyAdd,
  historyUpdate,
  historyRemove,
  saveUserFlagHistory,
  deleteUserFlagHistoryEntry,
  saveUserFlagCards,
  resolveEffectiveHandMaxSize,
  TNX_FLAG_SCOPE,
} from "../../scripts/module/user-flag-schema.mjs";

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

// ─── 純粋関数: history 変換 ────────────────────────────────────────────────

describe("calcHistoryExpTotal()", () => {
  it("空マップは 0 を返す", () => {
    expect(calcHistoryExpTotal({})).toBe(0);
  });

  it("null/undefined は 0 を返す", () => {
    expect(calcHistoryExpTotal(null)).toBe(0);
    expect(calcHistoryExpTotal(undefined)).toBe(0);
  });

  it("各エントリの exp を合計する", () => {
    expect(calcHistoryExpTotal({
      a: { exp: 3 },
      b: { exp: 5 },
      c: { exp: 2 },
    })).toBe(10);
  });

  it("exp が文字列の場合も数値として扱う", () => {
    expect(calcHistoryExpTotal({ a: { exp: "4" } })).toBe(4);
  });

  it("exp が欠落しているエントリは 0 として扱う", () => {
    expect(calcHistoryExpTotal({ a: {}, b: { exp: 3 } })).toBe(3);
  });
});

describe("historyAdd()", () => {
  const entry = { id: "n1", date: "2026-01-01", title: "T", exp: 3, rl: "", players: "" };

  it("新規エントリが追加されたマップを返す", () => {
    const result = historyAdd({}, entry);
    expect(result.n1).toEqual(entry);
  });

  it("既存エントリは保持される", () => {
    const existing = { a1: { id: "a1", date: "", title: "A", exp: 1, rl: "", players: "" } };
    const result = historyAdd(existing, entry);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.a1).toEqual(existing.a1);
  });

  it("元のマップを変更しない", () => {
    const original = {};
    historyAdd(original, entry);
    expect(Object.keys(original)).toHaveLength(0);
  });

  it("エントリはシャローコピーされる", () => {
    const result = historyAdd({}, entry);
    expect(result.n1).not.toBe(entry); // 別参照
    expect(result.n1).toEqual(entry);  // 内容は同じ
  });
});

describe("historyUpdate()", () => {
  const base = {
    a1: { id: "a1", date: "2026-01-01", title: "Old", exp: 2, rl: "", players: "" },
  };

  it("指定フィールドを更新したマップを返す", () => {
    const result = historyUpdate(base, "a1", { title: "New", exp: 5 });
    expect(result.a1.title).toBe("New");
    expect(result.a1.exp).toBe(5);
  });

  it("指定外フィールドは保持される", () => {
    const result = historyUpdate(base, "a1", { title: "New" });
    expect(result.a1.date).toBe("2026-01-01");
    expect(result.a1.exp).toBe(2);
  });

  it("存在しない entryId の場合、元のマップをそのまま返す", () => {
    const result = historyUpdate(base, "nonexistent", { title: "X" });
    expect(result).toBe(base); // 同一参照
  });

  it("元のマップを変更しない", () => {
    historyUpdate(base, "a1", { title: "Changed" });
    expect(base.a1.title).toBe("Old");
  });
});

describe("historyRemove()", () => {
  const base = {
    a1: { id: "a1", date: "", title: "A", exp: 1, rl: "", players: "" },
    b2: { id: "b2", date: "", title: "B", exp: 2, rl: "", players: "" },
  };

  it("指定エントリを除いたマップを返す", () => {
    const result = historyRemove(base, "a1");
    expect(result).not.toHaveProperty("a1");
    expect(result).toHaveProperty("b2");
  });

  it("存在しない entryId の場合、元のマップをそのまま返す", () => {
    const result = historyRemove(base, "nonexistent");
    expect(result).toBe(base);
  });

  it("元のマップを変更しない", () => {
    historyRemove(base, "a1");
    expect(base).toHaveProperty("a1");
  });
});

// ─── Foundry 依存: saveUserFlagHistory ─────────────────────────────────────

describe("saveUserFlagHistory()", () => {
  const makeUser = (flags = {}) => ({
    id: "user-test",
    flags: { [TNX_FLAG_SCOPE]: flags },
    update: vi.fn().mockResolvedValue(undefined),
  });

  it("history と exp.total を user.update() に渡す", async () => {
    const user = makeUser({ exp: { total: 0, value: 0, spent: 0 } });
    const entry = { id: "x1", date: "2026-01-01", title: "T", exp: 5, rl: "", players: "" };
    const newHistory = historyAdd({}, entry);

    await saveUserFlagHistory(user, newHistory);

    expect(user.update).toHaveBeenCalledOnce();
    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.history`]).toEqual(newHistory);
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(5);
  });

  it("複数エントリの exp 合計が exp.total に反映される", async () => {
    const user = makeUser();
    const newHistory = {
      a: { id: "a", exp: 3 },
      b: { id: "b", exp: 7 },
    };

    await saveUserFlagHistory(user, newHistory);

    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(10);
  });

  it("空 history では exp.total が 0 になる", async () => {
    const user = makeUser();
    await saveUserFlagHistory(user, {});

    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(0);
  });

  it("user.update() の戻り値を返す", async () => {
    const mockReturn = { id: "updated" };
    const user = makeUser();
    user.update.mockResolvedValue(mockReturn);

    const result = await saveUserFlagHistory(user, {});
    expect(result).toBe(mockReturn);
  });
});

// ─── Foundry 依存: deleteUserFlagHistoryEntry ──────────────────────────────

describe("deleteUserFlagHistoryEntry()", () => {
  const makeUser = (history = {}) => ({
    id: "user-test",
    flags: { [TNX_FLAG_SCOPE]: { history } },
    update: vi.fn().mockResolvedValue(undefined),
  });

  it("-= 削除パスと残存エントリの exp.total を user.update() に渡す", async () => {
    const user = makeUser({
      a1: { id: "a1", date: "", title: "A", exp: 3, rl: "", players: "" },
      b2: { id: "b2", date: "", title: "B", exp: 7, rl: "", players: "" },
    });
    await deleteUserFlagHistoryEntry(user, "a1");

    expect(user.update).toHaveBeenCalledOnce();
    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.history.-=a1`]).toBeNull();
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(7);
  });

  it("削除後の残存エントリ exp の合計が exp.total に反映される", async () => {
    const user = makeUser({
      x: { id: "x", date: "", title: "X", exp: 5, rl: "", players: "" },
      y: { id: "y", date: "", title: "Y", exp: 10, rl: "", players: "" },
    });
    await deleteUserFlagHistoryEntry(user, "x");

    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(10);
  });

  it("最後のエントリを削除すると exp.total が 0 になる", async () => {
    const user = makeUser({
      a1: { id: "a1", date: "", title: "A", exp: 5, rl: "", players: "" },
    });
    await deleteUserFlagHistoryEntry(user, "a1");

    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.history.-=a1`]).toBeNull();
    expect(arg[`flags.${TNX_FLAG_SCOPE}.exp.total`]).toBe(0);
  });

  it("user.update() の戻り値を返す", async () => {
    const mockReturn = { id: "deleted" };
    const user = makeUser({ a1: { id: "a1", date: "", title: "A", exp: 1, rl: "", players: "" } });
    user.update.mockResolvedValue(mockReturn);

    const result = await deleteUserFlagHistoryEntry(user, "a1");
    expect(result).toBe(mockReturn);
  });
});

// ─── Foundry 依存: saveUserFlagCards ───────────────────────────────────────

describe("saveUserFlagCards()", () => {
  const makeUser = () => ({
    id: "user-test",
    flags: {},
    update: vi.fn().mockResolvedValue(undefined),
  });

  it("handPileId と trumpCardPileId を user.update() に渡す", async () => {
    const user = makeUser();
    await saveUserFlagCards(user, "uuid-hand-123", "uuid-trump-456");

    expect(user.update).toHaveBeenCalledOnce();
    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.handPileId`]).toBe("uuid-hand-123");
    expect(arg[`flags.${TNX_FLAG_SCOPE}.trumpCardPileId`]).toBe("uuid-trump-456");
  });

  it("空文字も正しく保存される", async () => {
    const user = makeUser();
    await saveUserFlagCards(user, "", "");

    const arg = user.update.mock.calls[0][0];
    expect(arg[`flags.${TNX_FLAG_SCOPE}.handPileId`]).toBe("");
    expect(arg[`flags.${TNX_FLAG_SCOPE}.trumpCardPileId`]).toBe("");
  });

  it("user.update() の戻り値を返す", async () => {
    const mockReturn = { id: "updated_cards" };
    const user = makeUser();
    user.update.mockResolvedValue(mockReturn);

    const result = await saveUserFlagCards(user, "h", "t");
    expect(result).toBe(mockReturn);
  });
});

// ─── Foundry 依存(同期): resolveEffectiveHandMaxSize ──────────────────────

describe("resolveEffectiveHandMaxSize()", () => {
  const makeUser = (flags = {}) => ({
    flags: { [TNX_FLAG_SCOPE]: flags },
  });

  const withGameSettings = (settingValue, fn) => {
    const original = globalThis.game;
    globalThis.game = {
      settings: { get: vi.fn().mockReturnValue(settingValue) },
    };
    try { fn(); } finally { globalThis.game = original; }
  };

  it("User flag に handMaxSize が明示設定されている場合、その値を返す", () => {
    withGameSettings(4, () => {
      const user = makeUser({ handMaxSize: 6 });
      expect(resolveEffectiveHandMaxSize(user)).toBe(6);
    });
  });

  it("User flag が未設定の場合、ゲーム設定 defaultHandMaxSize を返す", () => {
    withGameSettings(5, () => {
      const user = makeUser({});
      expect(resolveEffectiveHandMaxSize(user)).toBe(5);
    });
  });

  it("ゲーム設定値を変えると実効上限が追随する(連携が生きていることの検証)", () => {
    const user = makeUser({});
    withGameSettings(3, () => {
      expect(resolveEffectiveHandMaxSize(user)).toBe(3);
    });
    withGameSettings(7, () => {
      expect(resolveEffectiveHandMaxSize(user)).toBe(7);
    });
  });

  it("user が null の場合、ゲーム設定を返す", () => {
    withGameSettings(4, () => {
      expect(resolveEffectiveHandMaxSize(null)).toBe(4);
    });
  });

  it("User flag に handMaxSize が 0 と明示設定されている場合、0 を返す(falsy 値の区別)", () => {
    withGameSettings(4, () => {
      const user = makeUser({ handMaxSize: 0 });
      expect(resolveEffectiveHandMaxSize(user)).toBe(0);
    });
  });

  it("FLAG_DEFAULTS のハードコード値(4)ではなくゲーム設定を返す", () => {
    withGameSettings(8, () => {
      const user = makeUser({});
      const result = resolveEffectiveHandMaxSize(user);
      expect(result).toBe(8);
      expect(result).not.toBe(4);
    });
  });
});

