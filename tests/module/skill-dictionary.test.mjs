import { describe, it, expect } from "vitest";
import {
  idKeyPrefix,
  wholeCategoryToken,
  isWholeCategoryToken,
  buildSkillCascadeSteps,
  resolveComboSkillName,
} from "../../scripts/module/skill-dictionary.mjs";

describe("idKeyPrefix()", () => {
  it("区切り「_」までを返す", () => {
    expect(idKeyPrefix("element_fire")).toBe("element");
    expect(idKeyPrefix("society_police")).toBe("society");
    expect(idKeyPrefix("assault")).toBe("assault");
    expect(idKeyPrefix("")).toBe("");
    expect(idKeyPrefix(null)).toBe("");
  });
});

describe("wholeCategoryToken / isWholeCategoryToken", () => {
  it("@prefix トークンを作る/判定する", () => {
    expect(wholeCategoryToken("society")).toBe("@society");
    expect(isWholeCategoryToken("@society")).toBe(true);
    expect(isWholeCategoryToken("society_police")).toBe(false);
    expect(isWholeCategoryToken("")).toBe(false);
  });
});

describe("resolveComboSkillName()", () => {
  const skillNames = { assault: "白兵", society_police: "社会：警察" };

  it("識別キーを辞典で技能名に逆引きする", () => {
    expect(resolveComboSkillName("assault", skillNames)).toBe("白兵");
    expect(resolveComboSkillName("society_police", skillNames)).toBe("社会：警察");
  });

  it("カテゴリ全体トークンをカテゴリ名に解決する(スタイル例外/固有名詞小分類)", () => {
    expect(resolveComboSkillName("@element", skillNames)).toBe("元力");
    expect(resolveComboSkillName("@bloodline", skillNames)).toBe("血脈");
    expect(resolveComboSkillName("@society", skillNames)).toBe("社会");
  });

  it("辞典に無いキーは生値、空値は空文字(フォールバック)", () => {
    expect(resolveComboSkillName("unknown_key", skillNames)).toBe("unknown_key");
    expect(resolveComboSkillName("", skillNames)).toBe("");
    expect(resolveComboSkillName(null, skillNames)).toBe("");
  });
});

describe("buildSkillCascadeSteps()", () => {
  const data = {
    general: [
      { identificationKey: "assault",        name: "白兵",         generalSkillCategory: "initialSkill" },
      { identificationKey: "shooting",       name: "射撃",         generalSkillCategory: "initialSkill" },
      { identificationKey: "society_police", name: "社会：警察",   generalSkillCategory: "onomasticSkill" },
      { identificationKey: "society_media",  name: "社会：マスコミ", generalSkillCategory: "onomasticSkill" },
      { identificationKey: "art_music",      name: "芸術：音楽",   generalSkillCategory: "onomasticSkill" },
    ],
    style: [
      { identificationKey: "basara_a",       name: "バサラ技能A", style: "basara" },
      { identificationKey: "element_fire",   name: "元力：炎",     style: "basara" },
      { identificationKey: "element_water",  name: "元力：水",     style: "basara" },
      { identificationKey: "ayakashi_x",     name: "アヤカシX",   style: "ayakashi" },
      { identificationKey: "bloodline_oni",  name: "血脈：鬼",     style: "ayakashi" },
    ],
    works: [
      { identificationKey: "wks_a", name: "ワークス技能A", organization: "org1" },
    ],
    styleNames: { basara: "カブキ", ayakashi: "アヤカシ" },
    orgNames:   { org1: "組織1" },
  };

  it("dict 未選択なら P1 のみ", () => {
    const steps = buildSkillCascadeSteps(data, {});
    expect(steps).toHaveLength(1);
    expect(steps[0].key).toBe("dict");
  });

  it("一般・無条件取得 → 技能名は initialSkill のみ", () => {
    const steps = buildSkillCascadeSteps(data, { dict: "general", group: "initialSkill" });
    const skill = steps.find((s) => s.key === "skill");
    expect(Object.keys(skill.options)).toEqual(["", "assault", "shooting"]);
  });

  it("一般・固有名詞 → 小分類は存在するもののみ", () => {
    const steps = buildSkillCascadeSteps(data, { dict: "general", group: "onomasticSkill" });
    const sub = steps.find((s) => s.key === "sub");
    expect(Object.keys(sub.options)).toEqual(["", "society", "art"]);
  });

  it("固有名詞・社会 → 小分類リストの先頭にカテゴリ全体", () => {
    const steps = buildSkillCascadeSteps(data, { dict: "general", group: "onomasticSkill", sub: "society" });
    const keys = Object.keys(steps.find((s) => s.key === "skill").options);
    expect(keys[1]).toBe("@society");
    expect(keys).toContain("society_police");
    expect(keys).not.toContain("art_music");
  });

  it("スタイル・バサラ → 〈元力〉は element_ の並び先頭(リスト先頭ではない)", () => {
    const steps = buildSkillCascadeSteps(data, { dict: "style", group: "basara" });
    const keys = Object.keys(steps.find((s) => s.key === "skill").options);
    expect(keys).toEqual(["", "basara_a", "@element", "element_fire", "element_water"]);
  });

  it("ワークス・組織 → その組織の技能", () => {
    const steps = buildSkillCascadeSteps(data, { dict: "works", group: "org1" });
    const skill = steps.find((s) => s.key === "skill");
    expect(Object.keys(skill.options)).toEqual(["", "wks_a"]);
  });
});
