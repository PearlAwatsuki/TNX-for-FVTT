import { describe, it, expect } from "vitest";
import { selectedPartRows, partIsOptional, formatPartDesignation, computePartOccupancy } from "../../scripts/data/item/part-helpers.mjs";
import { attackLabel, formatWeaponRangeLabel } from "../../scripts/ui/outfit-view.mjs";
import { getMajorCategoryLabel, getMinorCategoryLabel } from "../../scripts/data/item/outfit-categories.mjs";
import { displayGroupKey, computeColValue, optionConsumption } from "../../scripts/actor/outfit-tab.mjs";
import { groupOutfitEntries } from "../../scripts/dictionary/dictionary-browser-data.mjs";
import { buildOutfitCard } from "../../scripts/dictionary/dictionary-cards.mjs";

const parts = [
  { kind: "bodyPart", value: "生身", slots: 1, requirement: "and" },
  { kind: "bodyPart", value: "片腕", slots: 1, requirement: "or" },
  { kind: "bodyPart", value: "片脚", slots: 1, requirement: "or" },
];

describe("部位行ごとの必須／選択候補", () => {
  it("複数の任意候補を一つの括弧にまとめる", () => {
    expect(formatPartDesignation(parts.map((p, i) => ({ ...p, optional: i > 0 })))).toBe("生身+任意(片腕か片脚)");
  });
  it("必須行にある複数の任意指定もまとめる", () => {
    expect(formatPartDesignation(parts.map((p, i) => ({ ...p, requirement: "and", optional: i > 0 })))).toBe("生身+任意(片腕+片脚)");
  });
  it.each(["and", "or"])("全行任意なら%s指定でも従来の列挙表記にする", requirement => {
    expect(formatPartDesignation(parts.map(p => ({ ...p, requirement, optional: true })))).toBe("任意(生身、片腕、片脚)");
    expect(formatPartDesignation(parts.slice(1).map(p => ({ ...p, requirement, optional: true })))).toBe("任意(片腕、片脚)");
  });
  it("任意でない候補は括弧に巻き込まない", () => {
    const part = parts.map((p, i) => ({ ...p, requirement: "or", optional: i !== 1 }));
    expect(formatPartDesignation(part)).toBe("任意(生身か片脚)か片腕");
  });
  it("任意にした行だけを非消費として扱う", () => {
    const part = parts.map((p, i) => ({ ...p, requirement: "and", optional: i === 1 }));
    const { slots } = computePartOccupancy(parts.map(p => ({ value: p.value, count: 1 })), [{ part, isPrepared: true }]);
    expect(slots.map(s => s.used)).toEqual([1, 0, 1]);
    expect(formatPartDesignation(part)).toBe("生身+任意(片腕)+片脚");
  });
  it("選択候補の任意行を選んでも必須部位は消費する", () => {
    const part = parts.map((p, i) => ({ ...p, optional: i === 1 }));
    const counts = choice => computePartOccupancy(parts.map(p => ({ value: p.value, count: 1 })), [{ part, isPrepared: true, partOrChoice: choice }]).slots.map(s => s.used);
    expect(counts(1)).toEqual([1, 0, 0]);
    expect(counts(2)).toEqual([1, 0, 1]);
  });
  it("旧全体任意に対して行falseが優先する", () => {
    expect(partIsOptional({ optional: null }, true)).toBe(true);
    expect(partIsOptional({ optional: false }, true)).toBe(false);
    const part = [{ ...parts[0], optional: false }, { ...parts[1], requirement: "and", optional: null }];
    const { slots } = computePartOccupancy(parts.map(p => ({ value: p.value, count: 1 })), [{ part, isPrepared: true, partOptional: true }]);
    expect(slots.map(s => s.used)).toEqual([1, 0, 0]);
  });
  it("任意のオプションはホストのスロットを消費しない", () => {
    expect(optionConsumption({ part: [{ kind: "option", optional: true, slots: 2 }] })).toBe(0);
    expect(optionConsumption({ partOptional: true, part: [{ kind: "option", optional: false, slots: 2 }] })).toBe(2);
    expect(formatPartDesignation([{ kind: "bodyPart", optional: true, value: "" }])).toBe("任意");
  });
  it.each([1, 2])("必須行と指定した候補%dだけを占有する", choice => {
    const system = { part: parts, partOrChoice: choice, isPrepared: true };
    expect(selectedPartRows(system)).toEqual([parts[0], parts[choice]]);
    const { slots } = computePartOccupancy(parts.map(p => ({ value: p.value, count: 1 })), [system]);
    expect(slots.map(s => s.used)).toEqual(choice === 1 ? [1, 1, 0] : [1, 0, 1]);
  });
  it("削除等で選択が無効になった場合は最初の候補を採る", () => {
    expect(selectedPartRows({ part: parts, partOrChoice: 99 })).toEqual([parts[0], parts[1]]);
  });
  it("旧データの全体指定を読み、新しい行指定を優先する", () => {
    const legacy = parts.map(({ requirement: _requirement, ...row }) => row);
    expect(selectedPartRows({ part: legacy, partRelation: "or", partOrChoice: 2 })).toEqual([legacy[2]]);
    expect(selectedPartRows({ part: parts, partRelation: "or", partOrChoice: 2 })).toEqual([parts[0], parts[2]]);
  });
  it("2行と3行以上の選択表記を区別する", () => {
    expect(formatPartDesignation(parts)).toBe("生身+片腕か片脚");
    expect(formatPartDesignation(parts.slice(1))).toBe("片腕、もしくは片脚");
    expect(formatPartDesignation(parts.map(p => ({ ...p, requirement: "or" })))).toBe("生身か片腕か片脚");
  });
});

describe("解説参照と自由分類の表示", () => {
  it("攻撃力・射程・受け値・防御力を0や欠落として表示しない", () => {
    expect(attackLabel({ damageType: "reference", value: 0 })).toBe("解説参照");
    expect(formatWeaponRangeLabel({ min: "reference", max: "none" })).toBe("解説参照");
    expect(computeColValue("guard", { guardValue: { mode: "reference", value: 0 } })).toBe("解説参照");
    expect(computeColValue("defence", { defence: { mode: "reference" } })).toBe("解説参照");
  });
  it("AEで確定した攻撃属性と数値を優先する", () => {
    expect(attackLabel({ damageType: "reference", damageTypeTotal: "S", total: 6 })).toBe("S+6");
  });
  it("自由分類を表示し、未定義分類でも一覧から消えない", () => {
    expect(getMajorCategoryLabel("other", "独自分類")).toBe("独自分類");
    expect(getMinorCategoryLabel("reference")).toBe("解説参照");
    expect(displayGroupKey("reference")).toBe("other");
    expect(displayGroupKey("other")).toBe("other");
  });
  it("辞典でも解説参照・自由分類のItemを保持する", () => {
    const items = ["reference", "other"].map(minorCategory => ({ name: minorCategory, type: "weapon",
      system: { buy: { mode: "none" }, majorCategory: "other", majorCategoryOther: "独自大分類", minorCategory, minorCategoryOther: "独自小分類" } }));
    expect(groupOutfitEntries(items).flatMap(g => g.minors.flatMap(m => m.entries))).toEqual(items);
    expect(JSON.stringify(buildOutfitCard(items[1]))).toContain("独自大分類／独自小分類");
  });
});
