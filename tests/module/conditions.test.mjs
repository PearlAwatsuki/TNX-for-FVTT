import { describe, it, expect } from "vitest";
import { CONDITION_KINDS, readCondition, readConditions, getConditionKind, getConditionKinds, gatherConditionCheckSources, getCheckBlock, gatherConditionControlPenalty, computeJammingPenalty }
  from "../../scripts/module/conditions.mjs";

/** 準備アウトフィット記述子の略記 */
function pf(majorCategory, minorCategory, hack, identKey) {
  return { majorCategory, minorCategory, hack, identKey };
}

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

  it("酩酊は固定値(fixedMagnitude)を読み、stackable は def 固定(非重複)", () => {
    const c = readCondition(condEffect({ kind: "doped-minor", magnitude: 99 }));
    expect(c.kind).toBe("doped-minor");
    expect(c.label).toBe("酩酊(小)");
    expect(c.magnitude).toBe(2);      // 固定 -2（フラグ 99 は無視）
    expect(c.stackable).toBe(false);  // 酩酊は非重複（ハードコード）
  });

  it("可変値(magnitudeField)はフラグから読む。衰弱は stackable", () => {
    const c = readConditions({ id: "w", name: "衰弱", active: true, statuses: new Set(["weakness"]),
      flags: { [SCOPE]: { conditions: { weakness: { magnitude: 3 } } } } })[0];
    expect(c.magnitude).toBe(3);
    expect(c.stackable).toBe(true);
  });

  it("1つの AE が複数 BS を持つ場合、readConditions は全て返し効果値は kind 別キーで読む", () => {
    const eff = {
      id: "multi", name: "複合", active: true,
      statuses: new Set(["doped-minor", "weakness"]),
      flags: { [SCOPE]: { conditions: { "doped-minor": { magnitude: 4 }, "weakness": { magnitude: 7 } } } },
    };
    const cs = readConditions(eff);
    expect(getConditionKinds(eff)).toEqual(["doped-minor", "weakness"]);
    expect(cs).toHaveLength(2);
    expect(cs.find(c => c.kind === "doped-minor").magnitude).toBe(2);  // 酩酊は固定（フラグ4は無視）
    expect(cs.find(c => c.kind === "weakness").magnitude).toBe(7);     // 衰弱は可変
    // 全制御値減: 酩酊2＋衰弱7（共に対象指定なし＝all）
    expect(gatherConditionControlPenalty(cs)).toEqual({ all: 9, byAbility: {} });
  });

  it("kind は statuses(status id) からも判定する（flags 非依存）", () => {
    // statusEffects 付与で作られた AE は flags.conditionKind を持たない場合がある
    const eff = { id: "s1", name: "酩酊(小)", active: true, statuses: new Set(["doped-minor"]), flags: {} };
    const c = readCondition(eff);
    expect(c?.kind).toBe("doped-minor");
    expect(c?.magnitude).toBe(2); // def 既定
    expect(getConditionKind({ statuses: ["interference"] })).toBe("interference"); // 配列でも可
    expect(getConditionKind({ statuses: new Set(["dead"]) })).toBe("dead");
    expect(getConditionKind({ statuses: new Set(["not-a-condition"]) })).toBeNull();
  });
});

describe("CONDITION_KINDS レジストリ", () => {
  it("主要 kind が型を持つ", () => {
    expect(CONDITION_KINDS["doped-minor"].type).toBe("numeric");
    expect(CONDITION_KINDS.pressure.type).toBe("block");
    expect(CONDITION_KINDS.interference.type).toBe("computed");
    expect(CONDITION_KINDS.poison.type).toBe("continuous");
    expect(CONDITION_KINDS.fear.type).toBe("attackTarget");
  });
});

describe("gatherConditionCheckSources()", () => {
  it("酩酊(小)は上方判定の達成値 -2", () => {
    const conds = [readCondition(condEffect({ kind: "doped-minor", name: "酩酊(小)" }))];
    expect(gatherConditionCheckSources(conds, { upward: true })).toEqual([{ name: "酩酊(小)", value: -2 }]);
  });

  it("上方判定でなければ適用しない", () => {
    const conds = [readCondition(condEffect({ kind: "doped-minor" }))];
    expect(gatherConditionCheckSources(conds, { upward: false })).toEqual([]);
  });

  it("酩酊(小)と酩酊(大)は別 kind で重なる(-2 と -5)", () => {
    const conds = [
      readCondition(condEffect({ kind: "doped-minor", name: "酩酊(小)", id: "a" })),
      readCondition(condEffect({ kind: "doped-major", name: "酩酊(大)", id: "b" })),
    ];
    const got = gatherConditionCheckSources(conds, { upward: true });
    expect(got).toContainEqual({ name: "酩酊(小)", value: -2 });
    expect(got).toContainEqual({ name: "酩酊(大)", value: -5 });
  });

  it("萎縮(stackable)は対象一致でスタック、憎悪(非stackable)は複数でも-5一回", () => {
    const cower = [
      readCondition(condEffect({ kind: "fear", name: "萎縮A", id: "c1" })),
      readCondition(condEffect({ kind: "fear", name: "萎縮B", id: "c2" })),
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
    const cower = [readCondition(condEffect({ kind: "fear" }))];
    expect(gatherConditionCheckSources(cower, { isAttack: true, targetMatched: false })).toEqual([]);
    const hatred = [readCondition(condEffect({ kind: "hatred" }))];
    expect(gatherConditionCheckSources(hatred, { isAttack: true, targetMatched: true })).toEqual([]);
  });
});

describe("gatherConditionControlPenalty()（制御値減・all/byAbility）", () => {
  /** 衰弱の condition を直接作る（magnitude＋任意の targetAbility） */
  function weak(magnitude, targetAbility, id = "w") {
    return readConditions({ id, name: "衰弱", active: true, statuses: new Set(["weakness"]),
      flags: { [SCOPE]: { conditions: { weakness: { magnitude, targetAbility } } } } })[0];
  }

  it("衰弱(stackable)は重ねる、酩酊(固定)の制御分も全制御に合算", () => {
    const conds = [weak(2, "", "w1"), weak(3, "", "w2"), readCondition(condEffect({ kind: "doped-minor", id: "i1" }))];
    expect(gatherConditionControlPenalty(conds)).toEqual({ all: 2 + 3 + 2, byAbility: {} });
  });

  it("衰弱(数字なし)＝対象能力値1つだけ。targetAbility は byAbility に入る", () => {
    const conds = [weak(4, "life", "w1")];
    expect(gatherConditionControlPenalty(conds)).toEqual({ all: 0, byAbility: { life: 4 } });
  });

  it("酩酊(大)だけでも全制御に効く（固定5）", () => {
    const conds = [readCondition(condEffect({ kind: "doped-major", id: "x" }))];
    expect(gatherConditionControlPenalty(conds)).toEqual({ all: 5, byAbility: {} });
  });

  it("重圧など制御に効かない kind は無視", () => {
    const conds = [readCondition(condEffect({ kind: "pressure", targetAbility: "life" }))];
    expect(gatherConditionControlPenalty(conds)).toEqual({ all: 0, byAbility: {} });
  });
});

describe("computeJammingPenalty()（電子妨害）", () => {
  it("該当カテゴリ＋電制≤n の準備個数（上限10）", () => {
    const outfits = [
      pf("weapon", "melee", 2),       // 電制2≤3 該当
      pf("cyberware", "neuralware", 3), // 該当
      pf("tron", "software", 5),      // 電制5>3 非該当
      pf("housing", "residence", 1),  // 対象外カテゴリ
      pf("armor", "armorGear", 1),    // 小分類該当
    ];
    expect(computeJammingPenalty(3, outfits)).toBe(3);
  });

  it("上限10", () => {
    const outfits = Array.from({ length: 14 }, () => pf("cyberware", "neuralware", 1));
    expect(computeJammingPenalty(5, outfits)).toBe(10);
  });

  it("全身義体(fullCyborg)を電制≤nで準備 → 10", () => {
    expect(computeJammingPenalty(3, [pf("cyberware", "fullCyborg", 2)])).toBe(10);
  });

  it("ヴィークルを電制≤nで準備 → 10", () => {
    expect(computeJammingPenalty(3, [pf("vehicle", "groundVehicle", 1)])).toBe(10);
  });

  it("該当タップでゴースト登場中 → 10、ゴーストでなければタップは通常カウント", () => {
    const tap = [pf("tron", "tap", 2)];
    expect(computeJammingPenalty(3, tap, { isGhost: true })).toBe(10);
    expect(computeJammingPenalty(3, tap, { isGhost: false })).toBe(1);
  });

  it("ウェットなら該当1個以上で1、0個なら0", () => {
    const wet = pf("service", "background", null, "wet");
    expect(computeJammingPenalty(3, [wet, pf("weapon", "melee", 2)])).toBe(1);
    expect(computeJammingPenalty(3, [wet, pf("weapon", "melee", 9)])).toBe(0); // 電制9>3
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
