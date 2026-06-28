import { describe, it, expect } from "vitest";
import {
  mandatoryComboNames,
  alternativeComboNames,
  singleComboSkillName,
  resolveSkillChain,
  resolveUsageSkills,
  comboLockAnalysis,
  isComboRequired,
} from "../../scripts/module/skill-chain-resolution.mjs";

describe("mandatoryComboNames()", () => {
  it("単一の具体技能名 → [X]", () => {
    expect(mandatoryComboNames([{ value: "skillName", name: "psychology" }])).toEqual(["psychology"]);
  });
  it("& 結合(2件目以降が全て isMandatory) → 全メンバー", () => {
    expect(mandatoryComboNames([
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: true },
    ])).toEqual(["x", "y"]);
  });
  it("「、」結合(isMandatory でない複数) → []", () => {
    expect(mandatoryComboNames([
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: false },
    ])).toEqual([]);
  });
  it("カテゴリ全体・任意・なし・空 → []", () => {
    expect(mandatoryComboNames([{ value: "skillName", name: "@element" }])).toEqual([]);
    expect(mandatoryComboNames([{ value: "any" }])).toEqual([]);
    expect(mandatoryComboNames([{ value: "none" }])).toEqual([]);
    expect(mandatoryComboNames([])).toEqual([]);
  });
});

describe("alternativeComboNames()", () => {
  it("「、」結合(非mandatoryの複数具体技能名) → 候補キー", () => {
    expect(alternativeComboNames([
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: false },
    ])).toEqual(["x", "y"]);
  });
  it("単一・& 結合・カテゴリ → [](候補制限の対象でない)", () => {
    expect(alternativeComboNames([{ value: "skillName", name: "x" }])).toEqual([]);
    expect(alternativeComboNames([
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: true },
    ])).toEqual([]);
    expect(alternativeComboNames([{ value: "skillName", name: "@element" }])).toEqual([]);
  });
});

describe("singleComboSkillName()", () => {
  it("具体技能名がちょうど1つのときキーを返す", () => {
    expect(singleComboSkillName([{ value: "skillName", name: "psychology" }])).toBe("psychology");
  });
  it("複数・カテゴリ・なし は null", () => {
    expect(singleComboSkillName([{ value: "skillName", name: "a" }, { value: "skillName", name: "b", isMandatory: true }])).toBeNull();
    expect(singleComboSkillName([{ value: "skillName", name: "@element" }])).toBeNull();
    expect(singleComboSkillName([{ value: "none" }])).toBeNull();
  });
});

describe("resolveSkillChain()", () => {
  const mk = (key, comboSkill, isAction = false) => ({ key, isAction, comboSkill });
  const own = (map) => (key) => map[key] ?? null;
  const noSub = () => null;

  const S          = mk("S", [{ value: "skillName", name: "guardian" }]);
  const guardian   = mk("guardian", [{ value: "skillName", name: "psychology" }]);
  const psychology = mk("psychology", [{ value: "none" }]);

  it("線形チェーンを辿り末端(一般技能)をベースに、全参加技能を mandatoryKeys に", () => {
    const r = resolveSkillChain(S, own({ S, guardian, psychology }), noSub);
    expect(r.baseKey).toBe("psychology");
    expect(r.comboKeys).toEqual(["S", "guardian"]);
    expect(r.mandatoryKeys).toEqual(["S", "guardian", "psychology"]);
    expect(r.manual).toBe(false);
    expect(r.baseLocked).toBe(false);
    expect(r.defect).toBeNull();
  });

  it("チェーン中のアクション技能をベースにし、その先の組み合わせ相手もコンボに含める", () => {
    const guardianAction = mk("guardian", [{ value: "skillName", name: "psychology" }], true);
    const r = resolveSkillChain(S, own({ S, guardian: guardianAction, psychology }), noSub);
    expect(r.baseKey).toBe("guardian");
    expect(r.comboKeys).toEqual(["S", "psychology"]);
    expect(r.mandatoryKeys).toEqual(["S", "guardian", "psychology"]);
  });

  it("本体が無く代用があれば代用で解決する", () => {
    const subGuardian = mk("sub_guardian", [{ value: "none" }]);
    const r = resolveSkillChain(S, own({ S }), (key) => (key === "guardian" ? subGuardian : null));
    expect(r.baseKey).toBe("sub_guardian");
    expect(r.comboKeys).toEqual(["S"]);
  });

  it("本体と代用が両方あれば本体を優先する", () => {
    const r = resolveSkillChain(S, own({ S, guardian, psychology }), () => mk("sub_guardian", [{ value: "none" }]));
    expect(r.mandatoryKeys).toContain("guardian");
    expect(r.mandatoryKeys).not.toContain("sub_guardian");
  });

  it("単一技能名でない(任意)起点は自身がベース", () => {
    const r = resolveSkillChain(mk("X", [{ value: "any" }]), own({}), noSub);
    expect(r.baseKey).toBe("X");
    expect(r.comboKeys).toEqual([]);
    expect(r.mandatoryKeys).toEqual(["X"]);
  });

  it("アクション技能の起点はベースだが、その組み合わせ相手はコンボに含める", () => {
    const A = mk("A", [{ value: "skillName", name: "assault" }], true);
    const assault = mk("assault", [{ value: "none" }]);
    const r = resolveSkillChain(A, own({ A, assault }), noSub);
    expect(r.baseKey).toBe("A");
    expect(r.comboKeys).toEqual(["assault"]);
    expect(r.mandatoryKeys).toEqual(["A", "assault"]);
    expect(r.baseLocked).toBe(true);
  });

  it("辿る先が本体も代用も無ければ不備(不足キーを返す)", () => {
    const r = resolveSkillChain(S, own({ S }), noSub);
    expect(r.defect).toBe("guardian");
    expect(r.baseKey).toBeNull();
  });

  it("& グループにアクション技能があればベースに、起点と他メンバーをコンボに", () => {
    const Samp = mk("S", [
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: true },
    ]);
    const x = mk("x", [{ value: "none" }]);
    const yAction = mk("y", [{ value: "none" }], true);
    const r = resolveSkillChain(Samp, own({ S: Samp, x, y: yAction }), noSub);
    expect(r.baseKey).toBe("y");
    expect(r.comboKeys).toEqual(["S", "x"]);
    expect(r.mandatoryKeys).toEqual(["S", "x", "y"]);
  });

  it("& グループ全員が非アクション → ベース未確定(manual)・mandatoryKeys は全参加", () => {
    const Samp = mk("S", [
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: true },
    ]);
    const x = mk("x", [{ value: "none" }]);
    const y = mk("y", [{ value: "none" }]);
    const r = resolveSkillChain(Samp, own({ S: Samp, x, y }), noSub);
    expect(r.manual).toBe(true);
    expect(r.baseKey).toBeNull();
    expect(r.comboKeys).toEqual([]);
    expect(r.mandatoryKeys).toEqual(["S", "x", "y"]);
  });

  it("循環は再訪で停止し、不備にしない", () => {
    const a = mk("a", [{ value: "skillName", name: "b" }]);
    const b = mk("b", [{ value: "skillName", name: "a" }]);
    const r = resolveSkillChain(a, own({ a, b }), noSub);
    expect(r.defect).toBeNull();
    expect(r.mandatoryKeys).toEqual(["a", "b"]);
    expect(["a", "b"]).toContain(r.baseKey);
  });
});

describe("resolveUsageSkills() (actor アイテム橋渡し)", () => {
  const item = (id, key, comboSkill, extra = {}) => ({ id, identificationKey: key, isAction: false, isSubstitute: false, substituteTarget: [], comboSkill, ...extra });

  it("線形チェーンを actor アイテム id に解決する", () => {
    const root = item("i1", "S", [{ value: "skillName", name: "guardian" }]);
    const guardian = item("i2", "guardian", [{ value: "skillName", name: "psychology" }]);
    const psychology = item("i3", "psychology", [{ value: "none" }]);
    const r = resolveUsageSkills(root, [root, guardian, psychology]);
    expect(r.baseItemId).toBe("i3");
    expect(r.comboItemIds).toEqual(["i1", "i2"]);
    expect(r.mandatoryItemIds).toEqual(["i1", "i2", "i3"]);
    expect(r.manual).toBe(false);
  });

  it("本体が無く代用アイテムがあれば代用の id で解決する", () => {
    const root = item("i1", "S", [{ value: "skillName", name: "assault" }]);
    const sub = item("i9", "sub_assault", [{ value: "none" }], { isSubstitute: true, substituteTarget: ["assault"] });
    const r = resolveUsageSkills(root, [root, sub]);
    expect(r.baseItemId).toBe("i9");
    expect(r.comboItemIds).toEqual(["i1"]);
  });

  it("「、」候補は指定技能(＋その代用)の id を返す", () => {
    const root = item("i1", "S", [
      { value: "skillName", name: "x" },
      { value: "skillName", name: "y", isMandatory: false },
    ]);
    const x = item("i2", "x", [{ value: "none" }]);
    const y = item("i3", "y", [{ value: "none" }]);
    const r = resolveUsageSkills(root, [root, x, y]);
    expect(r.alternativeItemIds.sort()).toEqual(["i2", "i3"]);
  });

  it("指定技能がアクション技能のとき、ベース候補に本体＋その代用を含める(本体優先)", () => {
    const root = item("i1", "S", [{ value: "skillName", name: "assault" }]);
    const assault = item("i2", "assault", [{ value: "none" }], { isAction: true });
    const sub = item("i9", "sub_assault", [{ value: "none" }], { isSubstitute: true, substituteTarget: ["assault"] });
    const r = resolveUsageSkills(root, [root, assault, sub]);
    expect(r.baseItemId).toBe("i2");                       // 本体優先
    expect(r.baseLocked).toBe(true);
    expect(r.baseCandidateItemIds.sort()).toEqual(["i2", "i9"]);
  });

  it("本体が無く代用がアクション技能を代用するとき、代用がベース・候補にも入る", () => {
    const root = item("i1", "S", [{ value: "skillName", name: "assault" }]);
    const sub = item("i9", "sub_assault", [{ value: "none" }], { isSubstitute: true, substituteTarget: ["assault"], isAction: true });
    const r = resolveUsageSkills(root, [root, sub]);
    expect(r.baseItemId).toBe("i9");
    expect(r.baseLocked).toBe(true);
    expect(r.baseCandidateItemIds).toContain("i9");
  });

  it("組み合わせ技能(seed)の「技能」連鎖も推移的に必須へ含める", () => {
    // 起点 A(技能:白兵)に B(技能:電脳) を組み合わせ → 電脳も必須コンボに入る
    const root = item("i1", "A", [{ value: "skillName", name: "assault" }]);
    const assault = item("i2", "assault", [{ value: "none" }]);
    const b = item("i3", "B", [{ value: "skillName", name: "cyber" }]);
    const cyber = item("i4", "cyber", [{ value: "none" }]);
    const r = resolveUsageSkills(root, [root, assault, b, cyber], ["i3"]);
    expect(r.mandatoryItemIds).toContain("i4"); // 電脳(cyber)
    expect(r.mandatoryItemIds).toContain("i3"); // B 自身
  });

  it("組み合わせに足した技能がアクション技能を連れ込むと、ベースがそのアクションに入れ替わる", () => {
    const root = item("i1", "A", [{ value: "none" }]);                       // 起点は連鎖なし
    const b = item("i3", "B", [{ value: "skillName", name: "assault" }]);     // B の技能=白兵(アクション)
    const assaultAction = item("i2", "assault", [{ value: "none" }], { isAction: true });
    const r = resolveUsageSkills(root, [root, b, assaultAction], ["i3"]);
    expect(r.baseItemId).toBe("i2");   // 白兵(アクション)が新ベース
    expect(r.baseLocked).toBe(true);
  });
});

describe("comboLockAnalysis() / isComboRequired() (トリムダイアログ)", () => {
  const item = (id, key, comboSkill) => ({ id, identificationKey: key, isAction: false, isSubstitute: false, substituteTarget: [], comboSkill });

  it("ベース連鎖の必須 id と各コンボの連鎖を返す", () => {
    const root = item("i1", "A", [{ value: "skillName", name: "assault" }]);
    const assault = item("i2", "assault", [{ value: "none" }]);
    const b = item("i3", "B", [{ value: "skillName", name: "cyber" }]);
    const cyber = item("i4", "cyber", [{ value: "none" }]);
    const a = comboLockAnalysis(root, [root, assault, b, cyber], ["i1", "i2", "i3", "i4"]);
    expect(a.rootMandatoryIds.sort()).toEqual(["i1", "i2"]);
    expect(a.comboChains.i3.sort()).toEqual(["i3", "i4"]);
  });

  it("残す技能が要求する間はロック、外すと解除。ベース連鎖は常にロック", () => {
    const rootMandatoryIds = ["i1", "i2"];
    const comboChains = { i3: ["i3", "i4"], i4: ["i4"] };
    expect(isComboRequired("i4", ["i3", "i4"], rootMandatoryIds, comboChains)).toBe(true);  // B を残す→電脳ロック
    expect(isComboRequired("i4", ["i4"], rootMandatoryIds, comboChains)).toBe(false);        // B を外す→電脳解除
    expect(isComboRequired("i2", [], rootMandatoryIds, comboChains)).toBe(true);             // ベース連鎖は常にロック
  });
});
