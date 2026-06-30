import { describe, it, expect } from "vitest";
import {
  idKeyPrefix,
  hasDuplicateStyleWeapon,
  resolveLevelRef,
  groupStyleSkillsByStyle,
} from "../../scripts/module/style-skill-acquisition.mjs";

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

describe("resolveLevelRef()", () => {
  const siblings = [
    { identificationKey: "bloodline", level: 3 },
    { identificationKey: "forgery", level: 0 },
  ];

  it("識別キー一致の技能のレベルを返す", () => {
    expect(resolveLevelRef("bloodline", siblings)).toBe(3);
  });

  it("レベル0も数値として返す(null と区別)", () => {
    expect(resolveLevelRef("forgery", siblings)).toBe(0);
  });

  it("一致が無ければ null(上書きしない)", () => {
    expect(resolveLevelRef("unknown", siblings)).toBeNull();
  });

  it("キーが空・null なら null", () => {
    expect(resolveLevelRef("", siblings)).toBeNull();
    expect(resolveLevelRef(null, siblings)).toBeNull();
  });

  it("前後の空白を除去して照合", () => {
    expect(resolveLevelRef("  bloodline  ", siblings)).toBe(3);
  });

  it("siblings が空・null でも安全(null)", () => {
    expect(resolveLevelRef("bloodline", [])).toBeNull();
    expect(resolveLevelRef("bloodline", null)).toBeNull();
  });

  it("非数値レベルは 0 に丸める", () => {
    expect(resolveLevelRef("x", [{ identificationKey: "x", level: "foo" }])).toBe(0);
  });
});

describe("groupStyleSkillsByStyle()", () => {
  const styles = [
    { key: "crow", name: "鴉", level: 2 },
    { key: "karasu", name: "業", level: 1 },
  ];

  it("スタイル単位でグループ化し秘技/奥義の取得数＋上限(秘=Lv×2/奥=Lv)を付す", () => {
    const skills = [
      { id: "a", style: "crow", category: "secret" },
      { id: "b", style: "crow", category: "secret" },
      { id: "c", style: "crow", category: "mystery" },
      { id: "d", style: "karasu", category: "mystery" },
    ];
    const groups = groupStyleSkillsByStyle(skills, styles);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: "style:crow", label: "鴉", isStyle: true,
      secret: 2, secretLimit: 4, mystery: 1, mysteryLimit: 2,
      skillIds: ["a", "b", "c"],
    });
    expect(groups[1]).toMatchObject({
      key: "style:karasu", label: "業", isStyle: true,
      secret: 0, secretLimit: 2, mystery: 1, mysteryLimit: 1,
      skillIds: ["d"],
    });
  });

  it("グループはスタイルの表示順に並ぶ(技能の出現順でなく)", () => {
    const skills = [
      { id: "x", style: "karasu", category: "special" },
      { id: "y", style: "crow", category: "special" },
    ];
    const groups = groupStyleSkillsByStyle(skills, styles);
    expect(groups.map(g => g.key)).toEqual(["style:crow", "style:karasu"]);
  });

  it("取得数に含まない・レベル自動参照は数えない(リストには載る)", () => {
    const skills = [
      { id: "a", style: "crow", category: "secret" },
      { id: "b", style: "crow", category: "secret", excludeFromCount: true },
      { id: "c", style: "crow", category: "mystery", levelRefEnabled: true },
    ];
    const [g] = groupStyleSkillsByStyle(skills, styles);
    expect(g.secret).toBe(1);
    expect(g.mystery).toBe(0);
    expect(g.skillIds).toEqual(["a", "b", "c"]); // 除外でもリストには残す
  });

  it("スタイル未一致(ワークス等)は末尾「その他」群へ・上限なし・isStyle=false", () => {
    const skills = [
      { id: "a", style: "crow", category: "secret" },
      { id: "w", style: "-", category: "special" },
      { id: "u", category: "special" },
    ];
    const groups = groupStyleSkillsByStyle(skills, styles);
    expect(groups[groups.length - 1]).toMatchObject({
      label: "その他", isStyle: false, secretLimit: 0, mysteryLimit: 0,
      skillIds: ["w", "u"],
    });
  });

  it("空・null は空配列", () => {
    expect(groupStyleSkillsByStyle([], styles)).toEqual([]);
    expect(groupStyleSkillsByStyle(null, null)).toEqual([]);
  });
});
