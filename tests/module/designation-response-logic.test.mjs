import { describe, it, expect } from "vitest";
import {
  buildDesignationOptions,
  standInMatchesKey,
} from "../../scripts/module/designation-response-logic.mjs";

// 辞典由来の区分マップ(識別キー→{type: 区分, societyClass: 社会下位区分})
const classByKey = new Map([
  ["society_street", { type: "society", societyClass: "industry" }],
  ["society_nova",   { type: "society", societyClass: "" }],
  ["cybertech",      { type: "",        societyClass: "" }],
]);

const SKILLS = [
  { id: "sA", name: "社会：ストリート", identificationKey: "society_street",
    isSubstitute: false, substituteTarget: [], designationStandIn: [] },
  { id: "sB", name: "守護天使", identificationKey: "style_guardian",
    isSubstitute: true, substituteTarget: ["society_nova"], designationStandIn: [] },
  { id: "sC", name: "メディアの寵児", identificationKey: "style_media",
    isSubstitute: false, substituteTarget: [],
    designationStandIn: [{ kinds: ["infoGathering"], condition: "industry" }] },
  { id: "sD", name: "社交界の華", identificationKey: "style_social",
    isSubstitute: false, substituteTarget: [],
    designationStandIn: [{ kinds: ["infoGathering", "appearance"], condition: "society" }] },
];

const ROWS = [
  { keys: ["society_street", "society_nova"], tn: 5, label: "〈社会：ストリート、N◎VA〉" },
  { keys: ["cybertech"], tn: 21, label: "〈電脳〉" },
];

describe("standInMatchesKey()（指定充足の条件照合）", () => {
  it("「あらゆる社会」は社会区分の指定キー全てに合致", () => {
    expect(standInMatchesKey("society", "society_street", classByKey)).toBe(true);
    expect(standInMatchesKey("society", "society_nova", classByKey)).toBe(true);
    expect(standInMatchesKey("society", "cybertech", classByKey)).toBe(false);
  });

  it("下位区分は辞典の societyClass が一致するキーのみ", () => {
    expect(standInMatchesKey("industry", "society_street", classByKey)).toBe(true);
    expect(standInMatchesKey("industry", "society_nova", classByKey)).toBe(false);
  });

  it("辞典に無いキーはプレフィックス導出＝「あらゆる社会」のみ拾い、下位区分は拾わない", () => {
    expect(standInMatchesKey("society", "society_unknown", classByKey)).toBe(true);
    expect(standInMatchesKey("industry", "society_unknown", classByKey)).toBe(false);
  });
});

describe("buildDesignationOptions()（応答選択肢の4系統・2026-08-26 設計）", () => {
  const opts = buildDesignationOptions({
    rows: ROWS, actorSkills: SKILLS, classByKey, checkKind: "infoGathering",
  });

  it("指定技能: 所持は itemId 付き・未所持は disabled", () => {
    const street = opts.find(o => o.kind === "designated" && o.key === "society_street");
    expect(street).toMatchObject({ rowIndex: 0, tn: 5, itemId: "sA", disabled: false });
    const nova = opts.find(o => o.kind === "designated" && o.key === "society_nova");
    expect(nova).toMatchObject({ rowIndex: 0, itemId: null, disabled: true });
    const cyber = opts.find(o => o.kind === "designated" && o.key === "cybertech");
    expect(cyber).toMatchObject({ rowIndex: 1, tn: 21, disabled: true });
  });

  it("代用技能: substituteTarget が指定キーに交差する行にだけ並ぶ（ペナルティなしの正規選択肢）", () => {
    const subs = opts.filter(o => o.kind === "skill" && o.source === "substitute");
    expect(subs).toEqual([
      expect.objectContaining({ rowIndex: 0, tn: 5, itemId: "sB", name: "守護天使" }),
    ]);
  });

  it("指定充足: 判定種別が一致し条件を満たす行にだけ並ぶ", () => {
    const stands = opts.filter(o => o.kind === "skill" && o.source === "standIn");
    expect(stands.map(o => o.itemId).sort()).toEqual(["sC", "sD"]);
    expect(stands.every(o => o.rowIndex === 0)).toBe(true);
  });

  it("判定種別が合わなければ指定充足は並ばない（判定要求=checkKind null を含む）", () => {
    const none = buildDesignationOptions({ rows: ROWS, actorSkills: SKILLS, classByKey, checkKind: null });
    expect(none.some(o => o.source === "standIn")).toBe(false);
    const appearance = buildDesignationOptions({ rows: ROWS, actorSkills: SKILLS, classByKey, checkKind: "appearance" });
    expect(appearance.filter(o => o.source === "standIn").map(o => o.itemId)).toEqual(["sD"]);
  });

  it("代用判定は行（目標値）ごとに常設", () => {
    const subs = opts.filter(o => o.kind === "substitution");
    expect(subs).toEqual([
      expect.objectContaining({ rowIndex: 0, tn: 5, label: "〈社会：ストリート、N◎VA〉" }),
      expect.objectContaining({ rowIndex: 1, tn: 21, label: "〈電脳〉" }),
    ]);
  });

  it("重複排除: 指定技能として並んだアイテムは代用技能・指定充足として再掲しない", () => {
    const withOwnStand = [
      { ...SKILLS[0], designationStandIn: [{ kinds: ["infoGathering"], condition: "society" }] },
      ...SKILLS.slice(1),
    ];
    const res = buildDesignationOptions({ rows: ROWS, actorSkills: withOwnStand, classByKey, checkKind: "infoGathering" });
    expect(res.filter(o => o.itemId === "sA")).toHaveLength(1);
    expect(res.find(o => o.itemId === "sA").kind).toBe("designated");
  });

  it("識別キーの無いラベルのみの行は直接オープンの選択肢＋代用判定", () => {
    const res = buildDesignationOptions({
      rows: [{ keys: [], tn: 10, label: "自由記述技能" }],
      actorSkills: SKILLS, classByKey, checkKind: "infoGathering",
    });
    expect(res).toEqual([
      expect.objectContaining({ kind: "direct", rowIndex: 0, tn: 10, label: "自由記述技能" }),
      expect.objectContaining({ kind: "substitution", rowIndex: 0, tn: 10 }),
    ]);
  });

  it("空入力は安全に空", () => {
    expect(buildDesignationOptions({ rows: [], actorSkills: [], classByKey, checkKind: null })).toEqual([]);
    expect(buildDesignationOptions({})).toEqual([]);
  });
});
