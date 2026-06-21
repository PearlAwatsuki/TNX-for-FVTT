import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const {
  OUTFIT_CATEGORIES, getMajorCategoryChoices, getMinorCategoryChoices,
  getMajorCategoryLabel, getMinorCategoryLabel, LEGACY_CATEGORY_MAP,
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
