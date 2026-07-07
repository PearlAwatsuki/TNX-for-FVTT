import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { computeAcquisitionOutcome } =
  await import("../../scripts/module/npc-acquisition-logic.mjs");

// 旧 findOwnedTroops(所有者逆引き)は 2026-07-07 廃止——対象は用途側の取得アクター参照で明示設定

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
