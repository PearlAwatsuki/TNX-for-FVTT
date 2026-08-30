import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const {
  OUTFIT_CATEGORIES, getMajorCategoryChoices, getMinorCategoryChoices,
  getMajorCategoryLabel, getMinorCategoryLabel, LEGACY_CATEGORY_MAP,
  majorOfMinor, outfitClassifications, hasClassification, buildCategoryKeyGroups,
} = await import("../../../scripts/data/item/outfit-categories.mjs");

describe("OUTFIT_CATEGORIES", () => {
  it("大分類は 8 つ（キー：weapon/armor/cyberware/tron/vehicle/housing/item/service）", () => {
    expect(Object.keys(OUTFIT_CATEGORIES)).toEqual([
      "weapon", "armor", "cyberware", "tron",
      "vehicle", "housing", "item", "service",
    ]);
  });

  it("getMajorCategoryChoices は {キー: label} を返す", () => {
    const choices = getMajorCategoryChoices();
    expect(choices.weapon).toBe("武器");
    expect(choices.cyberware).toBe("サイバーウェア");
    expect(choices.housing).toBe("住宅");
  });

  it("小分類キーは全体で一意である", () => {
    const keys = Object.keys(getMinorCategoryChoices());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("小分類キーは大分類キーと重複しない（repairableCategories が両者を1配列に混在保存する）", () => {
    const majorKeys = new Set(Object.keys(OUTFIT_CATEGORIES));
    for (const minorKey of Object.keys(getMinorCategoryChoices())) {
      expect(majorKeys.has(minorKey), `${minorKey} が大分類キーと衝突`).toBe(false);
    }
  });

  it("getMinorCategoryChoices は {キー: label} を返す", () => {
    const choices = getMinorCategoryChoices();
    expect(choices.melee).toBe("白兵武器");
    expect(choices.fullCyborg).toBe("全身義体");
    expect(choices.combiner).toBe("コンバイナー");
  });

  it("小分類の対応 type はすべて outfit 系 Item type である", () => {
    const validTypes = ["weapon", "armor", "ianus", "cyborg", "tron", "tap",
      "vehicle", "residence", "combiner", "general"];
    for (const major of Object.values(OUTFIT_CATEGORIES)) {
      for (const [minorKey, def] of Object.entries(major.minors)) {
        expect(Array.isArray(def.types), `${minorKey} の型対応が配列でない`).toBe(true);
        for (const type of def.types) {
          expect(validTypes, `${minorKey} の type が不正`).toContain(type);
        }
      }
    }
  });

  it("代表的な対応が正しい(melee→weapon / fullCyborg→cyborg / combiner→combiner)", () => {
    expect(OUTFIT_CATEGORIES.weapon.minors.melee.types).toEqual(["weapon"]);
    expect(OUTFIT_CATEGORIES.cyberware.minors.fullCyborg.types).toEqual(["cyborg"]);
    expect(OUTFIT_CATEGORIES.service.minors.combiner.types).toEqual(["combiner"]);
  });

  it("生体装備(biotech)は単一の小分類で general/weapon/armor にまたがる", () => {
    expect(OUTFIT_CATEGORIES.item.minors.biotech.types).toEqual(["general", "weapon", "armor"]);
  });

  it("label 引きヘルパーが正しい", () => {
    expect(getMajorCategoryLabel("weapon")).toBe("武器");
    expect(getMinorCategoryLabel("melee")).toBe("白兵武器");
    expect(getMajorCategoryLabel("unknown")).toBe("");
    expect(getMinorCategoryLabel("unknown")).toBe("");
  });

  it("LEGACY_CATEGORY_MAP が 旧日本語名→キー を写像する", () => {
    expect(LEGACY_CATEGORY_MAP["武器"]).toBe("weapon");
    expect(LEGACY_CATEGORY_MAP["白兵武器"]).toBe("melee");
    expect(LEGACY_CATEGORY_MAP["サイバーウェア"]).toBe("cyberware");
    expect(LEGACY_CATEGORY_MAP["全身義体"]).toBe("fullCyborg");
  });

  it("OUTFIT_CATEGORIES は凍結されている", () => {
    expect(Object.isFrozen(OUTFIT_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(OUTFIT_CATEGORIES.weapon.minors)).toBe(true);
  });
});

describe("分類集合(フェーズ16-1・複数分類)", () => {
  it("majorOfMinor: 小分類キーから大分類キーを引く(未知は空文字)", () => {
    expect(majorOfMinor("melee")).toBe("weapon");
    expect(majorOfMinor("biotech")).toBe("item");
    expect(majorOfMinor("unknown")).toBe("");
  });

  it("outfitClassifications: 主分類のみ", () => {
    expect(outfitClassifications({ majorCategory: "weapon", minorCategory: "melee" }))
      .toEqual([{ major: "weapon", minor: "melee" }]);
  });

  it("outfitClassifications: 副分類を平坦に列挙する", () => {
    const sys = {
      majorCategory: "item", minorCategory: "biotech",
      additionalCategories: [{ major: "weapon", minor: "melee" }],
    };
    expect(outfitClassifications(sys)).toEqual([
      { major: "item", minor: "biotech" },
      { major: "weapon", minor: "melee" },
    ]);
  });

  it("outfitClassifications: minor だけの副分類行は大分類を樹から補完する", () => {
    const sys = { majorCategory: "weapon", minorCategory: "melee",
      additionalCategories: [{ major: "", minor: "biotech" }] };
    expect(outfitClassifications(sys)).toContainEqual({ major: "item", minor: "biotech" });
  });

  it("outfitClassifications: 旧 isCyber=true(未移行の生データ)はサイバーウェア副分類として包摂する", () => {
    const sys = { majorCategory: "weapon", minorCategory: "melee", isCyber: true };
    expect(outfitClassifications(sys)).toContainEqual({ major: "cyberware", minor: "" });
  });

  it("outfitClassifications: 重複行は1つに畳む・空行は除く", () => {
    const sys = {
      majorCategory: "weapon", minorCategory: "melee",
      additionalCategories: [{ major: "weapon", minor: "melee" }, { major: "", minor: "" }],
    };
    expect(outfitClassifications(sys)).toEqual([{ major: "weapon", minor: "melee" }]);
  });

  it("hasClassification: 大分類キー・小分類キーのどちらでも該当する(副分類含む)", () => {
    const sys = {
      majorCategory: "item", minorCategory: "biotech",
      additionalCategories: [{ major: "weapon", minor: "melee" }],
    };
    expect(hasClassification(sys, "item")).toBe(true);
    expect(hasClassification(sys, "biotech")).toBe(true);
    expect(hasClassification(sys, "weapon")).toBe(true);
    expect(hasClassification(sys, "melee")).toBe(true);
    expect(hasClassification(sys, "armor")).toBe(false);
    expect(hasClassification(sys, "")).toBe(false);
  });
});

describe("buildCategoryKeyGroups(修理対応分類・製作技能対応分類の共用ビルダー)", () => {
  it("サービス大分類とその配下を既定で除外する", () => {
    const groups = buildCategoryKeyGroups();
    expect(groups.some((g) => g.label === "サービス")).toBe(false);
    const values = groups.flatMap((g) => g.minors.map((o) => o.value));
    expect(values).not.toContain("service");
    expect(values).not.toContain("background");
  });

  it("各グループは（大分類全体）＋小分類の option を持つ", () => {
    const groups = buildCategoryKeyGroups();
    const weapon = groups.find((g) => g.label === "武器");
    expect(weapon.minors[0]).toEqual({ value: "weapon", label: "（大分類全体）" });
    expect(weapon.minors.map((o) => o.value)).toContain("melee");
  });

  it("excludeKeys で選択済みキーを除外する(大分類キー・小分類キーの両方)", () => {
    const groups = buildCategoryKeyGroups({ excludeKeys: new Set(["weapon", "melee"]) });
    const weapon = groups.find((g) => g.label === "武器");
    const values = weapon.minors.map((o) => o.value);
    expect(values).not.toContain("weapon");
    expect(values).not.toContain("melee");
    expect(values).toContain("ranged");
  });
});
