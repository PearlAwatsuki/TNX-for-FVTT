import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { novaDamageCardValue, resolveNoReaction, resolveOpposed, attackReactionModes } =
  await import("../../scripts/module/attack-flow-logic.mjs");

describe("novaDamageCardValue()（ダメージカード=命中判定のカード数字・Damage_Rules）", () => {
  it("数値はそのまま（絵札=10 は判定値の時点で反映済み）", () => {
    expect(novaDamageCardValue(7)).toBe(7);
    expect(novaDamageCardValue(10)).toBe(10);
  });

  it("A の 21固定は達成値側の選択であり、ダメージカードとしては 11", () => {
    expect(novaDamageCardValue("FIXED_21")).toBe(11);
  });

  it("ファンブルは null（命中しないため未使用）", () => {
    expect(novaDamageCardValue("FUMBLE")).toBeNull();
  });
});

describe("resolveNoReaction()（リアクションなし=目標値に対象の制御値）", () => {
  it("達成値≥制御値で命中・差分値=達成値−制御値", () => {
    expect(resolveNoReaction(15, 12)).toEqual({ hit: true, diff: 3, targetValue: 12 });
    expect(resolveNoReaction(12, 12)).toEqual({ hit: true, diff: 0, targetValue: 12 });
  });

  it("未達は失敗・差分値は算出されない（勝利時のみ=Check_Rules 2026-07-09 訂正）", () => {
    expect(resolveNoReaction(10, 12)).toEqual({ hit: false, diff: null, targetValue: 12 });
  });
});

describe("resolveOpposed()（対決=相手の達成値を目標値として扱う・Check_Rules/Combat_Flow）", () => {
  it("攻撃達成値≥リアクション達成値で命中（達成値≥目標値の一般規約との合成）", () => {
    expect(resolveOpposed(18, 15)).toEqual({ hit: true, diff: 3, targetValue: 15 });
    expect(resolveOpposed(15, 15)).toEqual({ hit: true, diff: 0, targetValue: 15 });
  });

  it("未満は攻撃側敗北=攻撃終了・差分値は算出されない（勝利時のみ）", () => {
    expect(resolveOpposed(14, 15)).toEqual({ hit: false, diff: null, targetValue: 15 });
  });

  it("リアクション不成立(達成値0扱い)なら攻撃達成値がそのまま差分値", () => {
    expect(resolveOpposed(16, 0)).toEqual({ hit: true, diff: 16, targetValue: 0 });
  });
});

describe("attackReactionModes()（系統別のリアクション導線・2026-07-08 確定）", () => {
  it("物理=ドッジ/パリー/リアクションしない", () => {
    expect(attackReactionModes("physical")).toEqual(["dodge", "parry", "none"]);
  });

  it("精神・社会=リアクション/リアクションしない の2択", () => {
    expect(attackReactionModes("mental")).toEqual(["reaction", "none"]);
    expect(attackReactionModes("social")).toEqual(["reaction", "none"]);
  });
});
