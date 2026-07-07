import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { computeAcquisitionOutcome, buildBunshinAbilityMods } =
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

describe("buildBunshinAbilityMods()（分身再同期の成長焼き込み・2026-07-07 確定）", () => {
  it("修正値=本体の修正値+成長 / 制御修正値=本体の制御修正値+制御成長", () => {
    const owner = {
      reason:  { mod: 1, growth: 2, controlMod: 0, controlGrowth: 3 },
      passion: { mod: 0, growth: 0, controlMod: -1, controlGrowth: 1 },
      life:    { mod: -2, growth: 4, controlMod: 2, controlGrowth: 0 },
      mundane: { mod: 0, growth: 1, controlMod: 0, controlGrowth: 0 },
    };
    expect(buildBunshinAbilityMods(owner)).toEqual({
      "system.reason.mod": 3,  "system.reason.controlMod": 3,
      "system.passion.mod": 0, "system.passion.controlMod": 0,
      "system.life.mod": 2,    "system.life.controlMod": 2,
      "system.mundane.mod": 1, "system.mundane.controlMod": 0,
    });
  });

  it("欠損値・非数は 0 として畳み込む", () => {
    const mods = buildBunshinAbilityMods({ reason: { mod: "x" } });
    expect(mods["system.reason.mod"]).toBe(0);
    expect(mods["system.passion.mod"]).toBe(0);
    expect(mods["system.mundane.controlMod"]).toBe(0);
  });
});
