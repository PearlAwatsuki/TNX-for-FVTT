/**
 * @fileoverview cast-ownership.mjs の純粋関数ユニットテスト
 *
 * pickFirstOwnerUserId / resolveOwnerUserIdAction は Foundry 不要の純粋関数のため
 * setup.mjs の mock なしでテストできる。
 */

import { describe, it, expect } from "vitest";
import {
  pickFirstOwnerUserId,
  resolveOwnerUserIdAction,
} from "../../scripts/module/cast-ownership.mjs";

// ─── pickFirstOwnerUserId ────────────────────────────────────────────────────

describe("pickFirstOwnerUserId()", () => {
  const NONE     = 0;
  const LIMITED  = 1;
  const OBSERVER = 2;
  const OWNER    = 3;

  it("ownership が空オブジェクトの場合 null を返す", () => {
    expect(pickFirstOwnerUserId({}, [])).toBeNull();
  });

  it("ownership が null/undefined の場合 null を返す", () => {
    expect(pickFirstOwnerUserId(null, [])).toBeNull();
    expect(pickFirstOwnerUserId(undefined, [])).toBeNull();
  });

  it('"default" キーはスキップする', () => {
    const ownership = { default: OWNER };
    expect(pickFirstOwnerUserId(ownership, [])).toBeNull();
  });

  it("NONE(0) レベルのユーザーはスキップする", () => {
    const ownership = { u1: NONE };
    expect(pickFirstOwnerUserId(ownership, [])).toBeNull();
  });

  it("LIMITED(1) レベルのユーザーはスキップする", () => {
    const ownership = { u1: LIMITED };
    expect(pickFirstOwnerUserId(ownership, [])).toBeNull();
  });

  it("OBSERVER(2) レベルのユーザーを拾う", () => {
    const ownership = { u1: OBSERVER };
    expect(pickFirstOwnerUserId(ownership, [])).toBe("u1");
  });

  it("OWNER(3) レベルのユーザーを拾う", () => {
    const ownership = { u1: OWNER };
    expect(pickFirstOwnerUserId(ownership, [])).toBe("u1");
  });

  it("GM ユーザーはスキップする", () => {
    const ownership = { gm1: OWNER };
    expect(pickFirstOwnerUserId(ownership, ["gm1"])).toBeNull();
  });

  it("GM を除いた最初の一般ユーザーを返す", () => {
    const ownership = { gm1: OWNER, u1: OWNER, u2: OWNER };
    expect(pickFirstOwnerUserId(ownership, ["gm1"])).toBe("u1");
  });

  it("複数の一般ユーザーがいる場合、最初の一人だけ返す", () => {
    const ownership = { u1: OWNER, u2: OWNER };
    const result = pickFirstOwnerUserId(ownership, []);
    expect(result).toBe("u1");
  });

  it("gmUserIds に配列を渡してもセットとして扱う(重複なし)", () => {
    const ownership = { gm1: OWNER };
    expect(pickFirstOwnerUserId(ownership, ["gm1", "gm1"])).toBeNull();
  });

  it("GM のみの場合 null を返す", () => {
    const ownership = { gm1: OWNER, gm2: OBSERVER };
    expect(pickFirstOwnerUserId(ownership, ["gm1", "gm2"])).toBeNull();
  });
});

// ─── resolveOwnerUserIdAction ────────────────────────────────────────────────

describe("resolveOwnerUserIdAction()", () => {
  it("newUserUuid が null の場合 action: none を返す", () => {
    const result = resolveOwnerUserIdAction(null, "");
    expect(result.action).toBe("none");
  });

  it('newUserUuid が空文字の場合 action: "none" を返す', () => {
    const result = resolveOwnerUserIdAction("", "");
    expect(result.action).toBe("none");
  });

  it("currentOwnerUuid が空の場合 action: set を返す", () => {
    const result = resolveOwnerUserIdAction("user://uuid-1", "");
    expect(result.action).toBe("set");
    expect(result.newUserUuid).toBe("user://uuid-1");
  });

  it("currentOwnerUuid が null の場合も action: set を返す", () => {
    const result = resolveOwnerUserIdAction("user://uuid-1", null);
    expect(result.action).toBe("set");
  });

  it("新旧が同じ UUID の場合 action: none を返す", () => {
    const result = resolveOwnerUserIdAction("user://same", "user://same");
    expect(result.action).toBe("none");
  });

  it("別の UUID が来た場合 action: confirm-overwrite を返す", () => {
    const result = resolveOwnerUserIdAction("user://new", "user://old");
    expect(result.action).toBe("confirm-overwrite");
    expect(result.newUserUuid).toBe("user://new");
  });

  it("none の場合 newUserUuid は null", () => {
    const r1 = resolveOwnerUserIdAction(null, "");
    expect(r1.newUserUuid).toBeNull();
    const r2 = resolveOwnerUserIdAction("user://x", "user://x");
    expect(r2.newUserUuid).toBeNull();
  });
});

// ─── 連続呼び出し安全性(ループなし) ─────────────────────────────────────────────
// updateActor フックで diff.ownership によらず recordCastOwnerUser を呼ぶ設計において、
// ownerUserId 設定後の再評価が "none" を返すことを検証する。
// これにより update → updateActor → recordCastOwnerUser のループが 2 呼び出しで自己終端する。

describe("pickFirstOwnerUserId + resolveOwnerUserIdAction 連続呼び出し安全性", () => {
  const OWNER = 3;

  it("ownerUserId 設定前後で連続評価しても 2 呼び出し以内で none に収束する", () => {
    const ownership = { gm1: OWNER, u1: OWNER };
    const gmUserIds = ["gm1"];

    // 1 回目(ownerUserId 未設定): "set"
    const picked1 = pickFirstOwnerUserId(ownership, gmUserIds);
    const fakeUuid = `User.${picked1}`;
    const result1 = resolveOwnerUserIdAction(fakeUuid, "");
    expect(result1.action).toBe("set");
    expect(result1.newUserUuid).toBe(fakeUuid);

    // 2 回目(ownerUserId = fakeUuid 設定済): "none" → ループ自己終端
    const picked2 = pickFirstOwnerUserId(ownership, gmUserIds);
    const fakeUuid2 = `User.${picked2}`;
    const result2 = resolveOwnerUserIdAction(fakeUuid2, fakeUuid);
    expect(result2.action).toBe("none");
  });

  it("diff.ownership がなくても ownership を直接読めば正しく所有者を特定できる", () => {
    // Foundry v13 では diff.ownership が設定されないケースがある。
    // recordCastOwnerUser は castActor.ownership を直接読むため diff に依存しない。
    const ownership = { default: 0, gm1: OWNER, u1: OWNER };
    const gmUserIds = ["gm1"];
    const picked = pickFirstOwnerUserId(ownership, gmUserIds);
    expect(picked).toBe("u1"); // default と GM を除いた最初の一般 User
    const resolution = resolveOwnerUserIdAction(`User.${picked}`, "");
    expect(resolution.action).toBe("set");
  });

  it("full ownership マップ(Foundry が送る形式)から正しく所有者を拾える", () => {
    // Foundry は ownership 更新時に全ユーザーを含む完全マップを送ることがある
    const fullOwnershipMap = { default: 0, gm1: OWNER, u1: 0, u2: OWNER, u3: 1 };
    const gmUserIds = ["gm1"];
    // u1 は NONE(0) → スキップ, u2 は OWNER(3) → 拾う
    expect(pickFirstOwnerUserId(fullOwnershipMap, gmUserIds)).toBe("u2");
  });
});
