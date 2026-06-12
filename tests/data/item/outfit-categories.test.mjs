import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { OUTFIT_CATEGORIES, getMajorCategoryChoices, getMinorCategoryChoices } =
  await import("../../../scripts/data/item/outfit-categories.mjs");

describe("OUTFIT_CATEGORIES", () => {
  it("大分類は 8 つ(武器/防具/サイバーウェア/トロン/ヴィークル/住宅/アイテム/サービス)", () => {
    expect(getMajorCategoryChoices()).toEqual([
      "武器", "防具", "サイバーウェア", "トロン",
      "ヴィークル", "住宅", "アイテム", "サービス",
    ]);
  });

  it("小分類名は全体で一意である", () => {
    const minors = getMinorCategoryChoices();
    expect(new Set(minors).size).toBe(minors.length);
  });

  it("小分類の対応 type はすべて outfit 系 Item type である", () => {
    const validTypes = ["weapon", "armor", "ianus", "cyborg", "tron", "tap",
      "vehicle", "residence", "combiner", "general"];
    for (const minors of Object.values(OUTFIT_CATEGORIES)) {
      for (const [minor, types] of Object.entries(minors)) {
        expect(Array.isArray(types), `${minor} の型対応が配列でない`).toBe(true);
        for (const type of types) {
          expect(validTypes, `${minor} の type が不正`).toContain(type);
        }
      }
    }
  });

  it("代表的な対応が正しい(白兵武器→weapon / 全身義体→cyborg / コンバイナー→combiner)", () => {
    expect(OUTFIT_CATEGORIES["武器"]["白兵武器"]).toEqual(["weapon"]);
    expect(OUTFIT_CATEGORIES["サイバーウェア"]["全身義体"]).toEqual(["cyborg"]);
    expect(OUTFIT_CATEGORIES["サービス"]["コンバイナー"]).toEqual(["combiner"]);
  });

  it("生体装備は単一の小分類で general/weapon/armor にまたがる(2026-06-13 統合)", () => {
    expect(OUTFIT_CATEGORIES["アイテム"]["生体装備"]).toEqual(["general", "weapon", "armor"]);
    expect(OUTFIT_CATEGORIES["アイテム"]).not.toHaveProperty("生体装備：武器");
    expect(OUTFIT_CATEGORIES["アイテム"]).not.toHaveProperty("生体装備：防具");
  });

  it("OUTFIT_CATEGORIES は凍結されている", () => {
    expect(Object.isFrozen(OUTFIT_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(OUTFIT_CATEGORIES["武器"])).toBe(true);
  });
});
