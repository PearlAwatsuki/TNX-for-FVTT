import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { findOwnedTroops, computeAcquisitionOutcome } =
  await import("../../scripts/module/npc-acquisition-logic.mjs");

const troop = (id, mode, ownerUuid) => ({
  id, type: "troop",
  system: { troopMode: mode, ownerActorRef: { uuid: ownerUuid, name: "" } },
});

describe("findOwnedTroops()（所有者逆引き・Troops.md「事前作成と所有者記録」）", () => {
  const owner = "Actor.cast1";
  const actors = [
    troop("t1", "troop",   owner),
    troop("t2", "enigma",  owner),
    troop("t3", "bunshin", owner),
    troop("t4", "troop",   "Actor.other"),
    troop("t5", "troop",   ""),
    { id: "c1", type: "cast", system: {} },
  ];

  it("所有者一致かつモード一致のトループ級のみ返す", () => {
    expect(findOwnedTroops(actors, owner, "troop").map(a => a.id)).toEqual(["t1"]);
    expect(findOwnedTroops(actors, owner, "enigma").map(a => a.id)).toEqual(["t2"]);
    expect(findOwnedTroops(actors, owner, "bunshin").map(a => a.id)).toEqual(["t3"]);
  });

  it("所有者未設定(敵対トループ等)・他者所有・troop 以外は対象外", () => {
    expect(findOwnedTroops(actors, "Actor.nobody", "troop")).toEqual([]);
  });
});

describe("computeAcquisitionOutcome()（取得の帰結・Troops.md「NPC取得」）", () => {
  it("トループ/エニグマ: 達成値がそのまま人数/エニグマポイント", () => {
    expect(computeAcquisitionOutcome("troop",  { achievement: 14 })).toEqual({ acquired: true, heads: 14 });
    expect(computeAcquisitionOutcome("enigma", { achievement: 9 })).toEqual({ acquired: true, heads: 9 });
  });

  it("トループ/エニグマ: 達成値 0 以下・非数は取得不成立", () => {
    expect(computeAcquisitionOutcome("troop", { achievement: 0 }).acquired).toBe(false);
    expect(computeAcquisitionOutcome("troop", { achievement: null }).acquired).toBe(false);
  });

  it("分身: 判定成功(達成値10以上=目標値の一般規約・判定側で算出)のときのみ取得", () => {
    expect(computeAcquisitionOutcome("bunshin", { achievement: 12, success: true }).acquired).toBe(true);
    expect(computeAcquisitionOutcome("bunshin", { achievement: 9, success: false })).toEqual({ acquired: false, reason: "failed" });
  });

  it("ファンブルは全モードで取得不成立", () => {
    expect(computeAcquisitionOutcome("troop",   { fumble: true, achievement: null })).toEqual({ acquired: false, reason: "fumble" });
    expect(computeAcquisitionOutcome("bunshin", { fumble: true, achievement: null })).toEqual({ acquired: false, reason: "fumble" });
  });
});
