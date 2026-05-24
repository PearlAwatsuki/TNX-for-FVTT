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
