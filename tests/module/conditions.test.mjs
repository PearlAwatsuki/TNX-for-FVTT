import { describe, it, expect } from "vitest";
import { CONDITION_KINDS, readCondition, gatherConditionCheckSources, getCheckBlock, gatherConditionControlPenalty }
  from "../../scripts/module/conditions.mjs";

const SCOPE = "tokyo-nova-axleration";

/** condition の ActiveEffect モックを作る */
function condEffect({ kind, magnitude, targetAbility, targetUuid, name, id = "e1", active = true, stackable } = {}) {
  return {
    id,
    name,
    active,
    flags: { [SCOPE]: { conditionKind: kind, magnitude, targetAbility, targetUuid, stackable, effectId: id } },
  };
}

describe("readCondition()", () => {
  it("conditionKind を持たない AE は null", () => {
    expect(readCondition({ flags: {} })).toBeNull();
    expect(readCondition({ flags: { [SCOPE]: {} } })).toBeNull();
  });

  it("kind/magnitude/label を読む。magnitude 未指定は def の既定", () => {
    const c = readCondition(condEffect({ kind: "intoxMinor" }));
    expect(c.kind).toBe("intoxMinor");
    expect(c.label).toBe("酩酊(小)");
    expect(c.magnitude).toBe(2); // magnitudeDefault
    expect(c.stackable).toBe(true); // def.stackable
  });

  it("magnitude のフラグ指定が既定を上書き", () => {
    const c = readCondition(condEffect({ kind: "jamming", magnitude: 3 }));
    expect(c.magnitude).toBe(3);
  });
});

describe("CONDITION_KINDS レジストリ", () => {
  it("主要 kind が型を持つ", () => {
    expect(CONDITION_KINDS.intoxMinor.type).toBe("numeric");
    expect(CONDITION_KINDS.pressure.type).toBe("block");
    expect(CONDITION_KINDS.jamming.type).toBe("computed");
    expect(CONDITION_KINDS.poison.type).toBe("continuous");
    expect(CONDITION_KINDS.cower.type).toBe("attackTarget");
  });
});

describe("gatherConditionCheckSources()", () => {
  it("酩酊(小)は上方判定の達成値 -2", () => {
    const conds = [readCondition(condEffect({ kind: "intoxMinor", name: "酩酊(小)" }))];
    expect(gatherConditionCheckSources(conds, { upward: true })).toEqual([{ name: "酩酊(小)", value: -2 }]);
  });

  it("上方判定でなければ適用しない", () => {
    const conds = [readCondition(condEffect({ kind: "intoxMinor" }))];
    expect(gatherConditionCheckSources(conds, { upward: false })).toEqual([]);
  });

  it("酩酊(小)と酩酊(大)は別 kind で重なる(-2 と -5)", () => {
    const conds = [
      readCondition(condEffect({ kind: "intoxMinor", name: "酩酊(小)", id: "a" })),
      readCondition(condEffect({ kind: "intoxMajor", name: "酩酊(大)", id: "b" })),
    ];
    const got = gatherConditionCheckSources(conds, { upward: true });
    expect(got).toContainEqual({ name: "酩酊(小)", value: -2 });
    expect(got).toContainEqual({ name: "酩酊(大)", value: -5 });
  });

  it("萎縮(stackable)は対象一致でスタック、憎悪(非stackable)は複数でも-5一回", () => {
    const cower = [
      readCondition(condEffect({ kind: "cower", name: "萎縮A", id: "c1" })),
      readCondition(condEffect({ kind: "cower", name: "萎縮B", id: "c2" })),
    ];
    // 萎縮=include、対象一致 → 2件スタック
    expect(gatherConditionCheckSources(cower, { isAttack: true, targetMatched: true }))
      .toEqual([{ name: "萎縮A", value: -5 }, { name: "萎縮B", value: -5 }]);

    const hatred = [
      readCondition(condEffect({ kind: "hatred", name: "憎悪A", id: "h1" })),
      readCondition(condEffect({ kind: "hatred", name: "憎悪B", id: "h2" })),
    ];
    // 憎悪=exclude、対象を含まない → 非stackable・同kindで -5 一回のみ
    expect(gatherConditionCheckSources(hatred, { isAttack: true, targetMatched: false }))
      .toEqual([{ name: "憎悪A", value: -5 }]);
  });

  it("萎縮は対象を含まなければ不適用、憎悪は含めば不適用", () => {
    const cower = [readCondition(condEffect({ kind: "cower" }))];
    expect(gatherConditionCheckSources(cower, { isAttack: true, targetMatched: false })).toEqual([]);
    const hatred = [readCondition(condEffect({ kind: "hatred" }))];
    expect(gatherConditionCheckSources(hatred, { isAttack: true, targetMatched: true })).toEqual([]);
  });
});

describe("gatherConditionControlPenalty()（全制御値減）", () => {
  it("衰弱(stackable)は重ねる、酩酊の制御分も合算", () => {
    const conds = [
      readCondition(condEffect({ kind: "weakness", magnitude: 2, id: "w1" })),
      readCondition(condEffect({ kind: "weakness", magnitude: 3, id: "w2" })),
      readCondition(condEffect({ kind: "intoxMinor", id: "i1" })), // magnitude=2
    ];
    expect(gatherConditionControlPenalty(conds)).toBe(2 + 3 + 2);
  });

  it("酩酊だけでも制御に効く（allCheckAndControl）", () => {
    const conds = [readCondition(condEffect({ kind: "intoxMajor", id: "x" }))]; // 5
    expect(gatherConditionControlPenalty(conds)).toBe(5);
  });

  it("重圧など制御に効かない kind は無視", () => {
    const conds = [readCondition(condEffect({ kind: "pressure", targetAbility: "life" }))];
    expect(gatherConditionControlPenalty(conds)).toBe(0);
  });
});

describe("getCheckBlock()（重圧）", () => {
  it("該当能力値の上方判定を禁止", () => {
    const conds = [readCondition(condEffect({ kind: "pressure", targetAbility: "life", name: "重圧(生命)" }))];
    expect(getCheckBlock(conds, { upward: true, ability: "life" })).toEqual({ blocked: true, by: "重圧(生命)" });
    expect(getCheckBlock(conds, { upward: true, ability: "reason" }).blocked).toBe(false);
  });

  it("上方判定でなければ(制御判定)禁止しない", () => {
    const conds = [readCondition(condEffect({ kind: "pressure", targetAbility: "life" }))];
    expect(getCheckBlock(conds, { upward: false, ability: "life" }).blocked).toBe(false);
  });
});
