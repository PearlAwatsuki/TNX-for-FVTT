import { describe, it, expect } from "vitest";
import { idKeyPrefix, hasDuplicateStyleWeapon } from "../../scripts/module/style-skill-acquisition.mjs";

describe("idKeyPrefix()", () => {
  it("区切り「_」までをプレフィックスとして返す", () => {
    expect(idKeyPrefix("elementalPowers_melee")).toBe("elementalPowers");
    expect(idKeyPrefix("elementalPowers_ranged")).toBe("elementalPowers");
  });

  it("区切りが無ければキー全体", () => {
    expect(idKeyPrefix("assaultNerve")).toBe("assaultNerve");
  });

  it("最初の「_」で切る(複数あっても先頭セグメント)", () => {
    expect(idKeyPrefix("a_b_c")).toBe("a");
  });

  it("空・null は空文字", () => {
    expect(idKeyPrefix("")).toBe("");
    expect(idKeyPrefix(null)).toBe("");
    expect(idKeyPrefix(undefined)).toBe("");
  });

  it("前後の空白は除去", () => {
    expect(idKeyPrefix("  elementalPowers_melee  ")).toBe("elementalPowers");
  });
});

describe("hasDuplicateStyleWeapon()", () => {
  const styleWeapon = (identificationKey) => ({ fromStyleSkillKey: "elementalPowers", identificationKey });

  it("同種(プレフィックス一致)の由来武器を既取得なら true", () => {
    const existing = [styleWeapon("elementalPowers_melee")];
    expect(hasDuplicateStyleWeapon("elementalPowers_ranged", existing)).toBe(true);
  });

  it("プレフィックスが違えば false(別種)", () => {
    const existing = [styleWeapon("elementalPowers_melee")];
    expect(hasDuplicateStyleWeapon("bloodline_demon", existing)).toBe(false);
  });

  it("由来マーク(fromStyleSkillKey)が無い武器は母数に数えない", () => {
    const existing = [{ fromStyleSkillKey: "", identificationKey: "elementalPowers_melee" }];
    expect(hasDuplicateStyleWeapon("elementalPowers_ranged", existing)).toBe(false);
  });

  it("新キーが空・プレフィックス無しなら false", () => {
    const existing = [styleWeapon("elementalPowers_melee")];
    expect(hasDuplicateStyleWeapon("", existing)).toBe(false);
  });

  it("既存が空配列なら false", () => {
    expect(hasDuplicateStyleWeapon("elementalPowers_melee", [])).toBe(false);
    expect(hasDuplicateStyleWeapon("elementalPowers_melee", null)).toBe(false);
  });
});
