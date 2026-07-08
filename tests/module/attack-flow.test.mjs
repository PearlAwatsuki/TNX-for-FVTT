import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveNoReaction, resolveOpposed, attackReactionModes, formatAttackLabel } =
  await import("../../scripts/module/attack-flow-logic.mjs");

// ダメージカードは命中判定のカードとは別に出す(Damage_Rules 2026-07-08 訂正)ため、
// 命中判定値からの導出(novaDamageCardValue)は廃止された

describe("formatAttackLabel()（攻撃力表記=アウトフィットの表示を踏襲・2026-07-09）", () => {
  it("種別+符号つき数値（連結表記 I0/S5 にしない）", () => {
    expect(formatAttackLabel("I", 4)).toBe("I+4");
    expect(formatAttackLabel("S", 0)).toBe("S+0");
    expect(formatAttackLabel("I", 0)).toBe("I+0");
  });

  it("種別なしは符号つき数値のみ", () => {
    expect(formatAttackLabel("", 3)).toBe("+3");
    expect(formatAttackLabel(undefined, 0)).toBe("+0");
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
