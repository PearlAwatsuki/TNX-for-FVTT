import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { buildCheckFormulaData, buildFormulaData, parsePlainNumber, evaluateFormula } =
  await import("../../scripts/module/tnx-formula.mjs");

describe("buildCheckFormulaData()（式評価用の判定結果コンテキスト・Check_Rules「差分値」）", () => {
  it("diff / achievement を数値で供給する", () => {
    expect(buildCheckFormulaData({ diff: 7, achievement: 22 })).toEqual({ diff: 7, achievement: 22 });
    expect(buildCheckFormulaData({ diff: -3, achievement: 12 })).toEqual({ diff: -3, achievement: 12 });
  });

  it("目標値なし(diff=null)・欠損は 0 として供給する", () => {
    expect(buildCheckFormulaData({ diff: null, achievement: null })).toEqual({ diff: 0, achievement: 0 });
    expect(buildCheckFormulaData(undefined)).toEqual({ diff: 0, achievement: 0 });
  });
});

describe("buildFormulaData()（AE と同じ system.* を式に供給・2026-07-10）", () => {
  // getRollData() は AE と同じ system.* パスを @system.* として公開する(initiative と同流儀)
  const actor = { getRollData: () => ({ system: { life: { total: 8 }, reason: { total: 5 } } }) };

  it("アクターのロールデータ(@system.*)を供給する", () => {
    expect(buildFormulaData(actor)).toEqual({ system: { life: { total: 8 }, reason: { total: 5 } } });
  });

  it("判定結果(@diff/@achievement)を重ねる", () => {
    expect(buildFormulaData(actor, { diff: 7, achievement: 22 })).toEqual({
      system: { life: { total: 8 }, reason: { total: 5 } },
      diff: 7, achievement: 22,
    });
  });

  it("アクターが無ければ空(＋結果のみ)", () => {
    expect(buildFormulaData(null)).toEqual({});
    expect(buildFormulaData(null, { diff: 3, achievement: 10 })).toEqual({ diff: 3, achievement: 10 });
  });
});

describe("parsePlainNumber()（純数値の速判定）", () => {
  it("整数・符号付き・小数を数値として返す", () => {
    expect(parsePlainNumber("3")).toBe(3);
    expect(parsePlainNumber("-2")).toBe(-2);
    expect(parsePlainNumber("+4")).toBe(4);
    expect(parsePlainNumber(" 1.5 ")).toBe(1.5);
  });

  it("式・自由文・空は null（式は Roll 評価へ・自由文は表示のみ扱い）", () => {
    expect(parsePlainNumber("2 + @diff")).toBeNull();
    expect(parsePlainNumber("サイクル数を加算")).toBeNull();
    expect(parsePlainNumber("")).toBeNull();
    expect(parsePlainNumber(undefined)).toBeNull();
  });
});

describe("evaluateFormula()（決定的評価・Foundry Roll 不在環境では数値のみ）", () => {
  it("純数値は Roll を介さず評価される", async () => {
    expect(await evaluateFormula("5")).toBe(5);
    expect(await evaluateFormula("-1")).toBe(-1);
  });

  it("空・評価不能は null", async () => {
    expect(await evaluateFormula("")).toBeNull();
    // テスト環境に Roll が無いため式は評価不能=null（実環境では Roll 決定的評価が解決する）
    expect(await evaluateFormula("2 + @diff", { diff: 3 })).toBeNull();
  });
});
