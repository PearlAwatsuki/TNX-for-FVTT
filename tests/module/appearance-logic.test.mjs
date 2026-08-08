import { describe, it, expect } from "vitest";
import {
  appearanceCheckParams,
  hasNegativeDangerOutfit,
  isAppearanceSkillKey,
} from "../../scripts/module/appearance-logic.mjs";

describe("appearanceCheckParams()（エリア別 TN と危険値修正・Appearance_Check 正本）", () => {
  it("レッド8・イエロー10は危険値ペナルティなし", () => {
    expect(appearanceCheckParams({ area: "red", appearanceModifier: -4 }))
      .toEqual({ blocked: false, targetValue: 8, modifier: 0 });
    expect(appearanceCheckParams({ area: "yellow", appearanceModifier: -4 }))
      .toEqual({ blocked: false, targetValue: 10, modifier: 0 });
  });

  it("グリーン10は危険値合計×1・ホワイト12は×2を達成値への修正とする（2026-08-07 裁定＝達成値に加算）", () => {
    expect(appearanceCheckParams({ area: "green", appearanceModifier: -3 }))
      .toEqual({ blocked: false, targetValue: 10, modifier: -3 });
    expect(appearanceCheckParams({ area: "white", appearanceModifier: -3 }))
      .toEqual({ blocked: false, targetValue: 12, modifier: -6 });
  });

  it("サンクチュアリ12は危険値ペナルティ装備の携帯で登場不可", () => {
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: true }))
      .toEqual({ blocked: true, targetValue: 12, modifier: 0 });
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: false }))
      .toEqual({ blocked: false, targetValue: 12, modifier: 0 });
  });

  it("エリア未設定は目標値なし・修正なし（判定は出せる・成否は卓）", () => {
    expect(appearanceCheckParams({ area: "", appearanceModifier: -2 }))
      .toEqual({ blocked: false, targetValue: null, modifier: 0 });
  });

  it("危険値0なら修正0", () => {
    expect(appearanceCheckParams({ area: "white", appearanceModifier: 0 }))
      .toEqual({ blocked: false, targetValue: 12, modifier: 0 });
  });
});

describe("hasNegativeDangerOutfit()（サンクチュアリの装備チェック＝合計でなく個別）", () => {
  const carriedWeapon = (value) => ({
    type: "weapon",
    system: { isCarrying: true, appearancePenalty: { mode: "value", value } },
  });

  it("携帯中の危険値マイナス装備が1つでもあれば true（合計が0以上でも）", () => {
    const items = [carriedWeapon(-2), carriedWeapon(3)];
    expect(hasNegativeDangerOutfit(items)).toBe(true);
  });

  it("携帯していない・危険値なし・非アウトフィットは数えない", () => {
    expect(hasNegativeDangerOutfit([
      { type: "weapon", system: { isCarrying: false, appearancePenalty: { mode: "value", value: -2 } } },
      { type: "weapon", system: { isCarrying: true, appearancePenalty: { mode: "none" } } },
      { type: "generalSkill", system: {} },
    ])).toBe(false);
  });
});

describe("isAppearanceSkillKey()（登場判定の既定候補＝社会/コネ分類）", () => {
  it("society/contact プレフィックスの識別キーを社会/コネと判定する", () => {
    expect(isAppearanceSkillKey("society")).toBe(true);
    expect(isAppearanceSkillKey("society_nova")).toBe(true);
    expect(isAppearanceSkillKey("contact_father")).toBe(true);
    expect(isAppearanceSkillKey("melee")).toBe(false);
    expect(isAppearanceSkillKey("")).toBe(false);
  });
});
