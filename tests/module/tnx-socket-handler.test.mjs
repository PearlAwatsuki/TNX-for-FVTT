/**
 * @fileoverview 委譲ソケットの受理条件のテスト(2026-09-07)。
 *
 * 背景: Foundry のソケットは接続中の任意のクライアントが任意のペイロードを投げられる。
 * 委譲ハンドラのうち cutAdvance / interruptGrant / markMajor / teamExit 等は要求者を
 * 検証していたが、treatmentApply / repairApply / modificationApply / miracleSwap は
 * **何も検証していなかった**(userId すら送っていなかった)ため、任意のアクターの状態・
 * 装備を書き換えられる経路になっていた。
 *
 * 何を検証できるか: 委譲は「**対象**の所有権が無い」から起きるので、対象側の所有権は
 * 検証条件にできない(検証すると機能そのものが成立しない)。検証できるのは**行為者側**
 * ——修理する人・治療する人・宣言した人——を要求者が操作できるか、である。
 *
 * tnx-socket-handler.mjs は静的 import を持たない(全て動的 import)ため、Foundry 実行環境
 * なしでそのまま読み込める。
 */

import { describe, it, expect, afterEach } from "vitest";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";

const origGame = globalThis.game;
const origFromUuid = globalThis.fromUuid;
afterEach(() => {
  globalThis.game = origGame;
  globalThis.fromUuid = origFromUuid;
});

/** 指定 id のユーザーだけを OWNER と認めるアクターの模造。 */
const actorOwnedBy = (...ownerIds) => ({
  testUserPermission: (user, level) => level === "OWNER" && ownerIds.includes(user?.id),
});

/**
 * ワールドの模造を用意する。
 * @param {object} o
 * @param {?string} o.activeGm  現在の activeGM の id(null=GM 不在)
 * @param {string}  o.me        このクライアントのユーザー id
 * @param {object}  o.users     id → user
 * @param {object}  o.docs      uuid → ドキュメント
 */
function world({ activeGm = "gm1", me = "gm1", users = {}, docs = {} } = {}) {
  globalThis.game = {
    user:  { id: me },
    users: { activeGM: activeGm ? { id: activeGm } : null, get: (id) => users[id] ?? null },
  };
  globalThis.fromUuid = async (uuid) => {
    if (uuid === "throws") throw new Error("参照切れ");
    return docs[uuid] ?? null;
  };
}

const pc = { id: "pc1" };

describe("TnxSocketHandler._authorizeDelegation()", () => {
  it("要求者が行為者アクターの所有者なら受理する", async () => {
    world({ users: { pc1: pc }, docs: { "Actor.a": actorOwnedBy("pc1") } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.a" }))
      .resolves.toBe(true);
  });

  it("要求者が行為者アクターの所有者でなければ受理しない", async () => {
    world({ users: { pc1: pc }, docs: { "Actor.a": actorOwnedBy("pc2") } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.a" }))
      .resolves.toBe(false);
  });

  it("activeGM でない GM は代行しない(複数 GM 接続時の二重適用を防ぐ)", async () => {
    world({ activeGm: "gm1", me: "gm2", users: { pc1: pc }, docs: { "Actor.a": actorOwnedBy("pc1") } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.a" }))
      .resolves.toBe(false);
  });

  it("GM が不在なら受理しない", async () => {
    world({ activeGm: null, users: { pc1: pc }, docs: { "Actor.a": actorOwnedBy("pc1") } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.a" }))
      .resolves.toBe(false);
  });

  it("userId が未知なら受理しない", async () => {
    world({ users: {}, docs: { "Actor.a": actorOwnedBy("pc1") } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.a" }))
      .resolves.toBe(false);
  });

  it("actorUuid が無いペイロードは受理しない(旧形式の要求を弾く)", async () => {
    world({ users: { pc1: pc } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1" })).resolves.toBe(false);
  });

  it("行為者が見つからなければ受理しない", async () => {
    world({ users: { pc1: pc }, docs: {} });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Actor.x" }))
      .resolves.toBe(false);
  });

  it("uuid の解決が投げても例外を漏らさず受理しない", async () => {
    world({ users: { pc1: pc } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "throws" }))
      .resolves.toBe(false);
  });

  it("actorUuid がアイテムを指す場合は親アクターの所有権で判定する", async () => {
    // 行為者は「技能アイテムを使った人」なので、アイテム uuid で渡ってくる余地がある
    world({ users: { pc1: pc }, docs: { "Item.i": { actor: actorOwnedBy("pc1") } } });
    await expect(TnxSocketHandler._authorizeDelegation({ userId: "pc1", actorUuid: "Item.i" }))
      .resolves.toBe(true);
  });

  it("ペイロードが空でも落ちない", async () => {
    world();
    await expect(TnxSocketHandler._authorizeDelegation()).resolves.toBe(false);
    await expect(TnxSocketHandler._authorizeDelegation(null)).resolves.toBe(false);
  });
});

describe("委譲ハンドラは検証を経てから実処理へ入る", () => {
  // 検証を通らない要求で動的 import(実処理)へ進まないこと。進めば Foundry 依存の
  // モジュールを読み込もうとして落ちるため、「静かに戻る」ことが確認になる。
  const handlers = ["_onTreatmentApply", "_onRepairApply", "_onModificationApply", "_onMiracleSwap"];

  it.each(handlers)("%s は未検証の要求を無視する", async (name) => {
    world({ users: {}, docs: {} });
    await expect(TnxSocketHandler[name]({ userId: "pc1", actorUuid: "Actor.a" })).resolves.toBeUndefined();
  });

  it.each(handlers)("%s は activeGM でないクライアントでは何もしない", async (name) => {
    world({ activeGm: "gm1", me: "gm2", users: { pc1: pc }, docs: { "Actor.a": actorOwnedBy("pc1") } });
    await expect(TnxSocketHandler[name]({ userId: "pc1", actorUuid: "Actor.a" })).resolves.toBeUndefined();
  });
});
