import { describe, it, expect } from "vitest";
import { CONDITION_KINDS, readCondition, readConditions, getConditionKind, getConditionKinds, gatherConditionCheckSources, getCheckBlock, gatherConditionControlPenalty, computeJammingPenalty, buildInflictedEffectsData, applyDamageTagMods, recoveryKindMatches, recoveryKindExcluded, ignoreRuleMatches, gatherIgnoreRules, getEffectiveConditions, gatherSkillUseWarnings, hasBountyBlock }
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

/** def を直接指定した実効コンディション行(getEffectiveConditions 相当)を作る。
 *  負傷固有効果(skillPenalty/skillBlock/bountyBlock)は def に、選択結果/休眠はインスタンスに載る。 */
function condRow({ kind = "x", def = {}, name = "効果", active = true, magnitude = 0,
  targetSkill = null, pendingScene = false, stackable = false } = {}) {
  return { kind, def, name, active, magnitude, targetSkill, pendingScene, stackable, targetMode: def.targetMode ?? null };
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

  it("負傷の選択技能(targetSkill)はインスタンスフラグから読む", () => {
    const eff = { id: "s", name: "造反", active: true, statuses: new Set(["soc-14"]),
      flags: { [SCOPE]: { conditions: { "soc-14": { targetSkill: "society_police" } } } } };
    const c = readConditions(eff)[0];
    expect(c.targetSkill).toBe("society_police");
    expect(c.pendingScene).toBe(false); // soc-14 は sceneDeferred でない=休眠しない
  });

  it("休眠(pendingScene)は sceneDeferred な負傷が sceneFired 未設定のとき true・発火で false", () => {
    const mk = (flags) => readConditions({ id: "d", name: "信用失墜", active: true, statuses: new Set(["soc-6"]),
      flags: { [SCOPE]: flags } })[0];
    expect(mk({}).pendingScene).toBe(true);                                                  // 付与直後=休眠(経路不問)
    expect(mk({ conditions: { "soc-6": { sceneFired: true } } }).pendingScene).toBe(false);  // 発火後=有効
  });

  it("targetSkill / pendingScene の既定は null / false（sceneDeferred でない BS）", () => {
    const c = readCondition(condEffect({ kind: "doped-minor" }));
    expect(c.targetSkill).toBeNull();
    expect(c.pendingScene).toBe(false);
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

describe("gatherConditionCheckSources()：特定技能への達成値ペナルティ(skillPenalty・眼部損傷)", () => {
  const eye = (skillKey = "perception") =>
    condRow({ kind: "phys-14", name: "眼部損傷", def: { skillPenalty: { skillKey, value: 5 } } });

  it("判定参加技能に対象キーが含まれれば上方判定 -value", () => {
    expect(gatherConditionCheckSources([eye()], { upward: true, skillKeys: ["perception", "assault"] }))
      .toEqual([{ name: "眼部損傷", value: -5 }]);
  });

  it("参加技能(組み合わせ含む)に対象キーが無ければ不適用", () => {
    expect(gatherConditionCheckSources([eye()], { upward: true, skillKeys: ["assault", "shooting"] })).toEqual([]);
  });

  it("上方判定でなければ(制御判定)不適用", () => {
    expect(gatherConditionCheckSources([eye()], { upward: false, skillKeys: ["perception"] })).toEqual([]);
  });

  it("休眠(pendingScene)なら不適用", () => {
    const dormant = { ...eye(), pendingScene: true };
    expect(gatherConditionCheckSources([dormant], { upward: true, skillKeys: ["perception"] })).toEqual([]);
  });
});

describe("gatherSkillUseWarnings()：特定技能の使用不可(skillBlock・警告のみ)", () => {
  const credit = () => condRow({ kind: "soc-13", name: "口座凍結", def: { skillBlock: { skillKey: "credit" } } });
  const society = (targetSkill) =>
    condRow({ kind: "soc-14", name: "造反", def: { skillBlock: { category: "society" } }, targetSkill });

  it("固定キー(信用)が判定参加技能に含まれれば警告名を返す", () => {
    expect(gatherSkillUseWarnings([credit()], ["credit", "assault"])).toEqual(["口座凍結"]);
  });

  it("選択型は付与時の targetSkill で照合する", () => {
    expect(gatherSkillUseWarnings([society("society_police")], ["society_police"])).toEqual(["造反"]);
    expect(gatherSkillUseWarnings([society("society_police")], ["society_media"])).toEqual([]);
  });

  it("参加技能に含まれなければ警告しない", () => {
    expect(gatherSkillUseWarnings([credit()], ["assault"])).toEqual([]);
  });

  it("休眠(pendingScene)は警告しない", () => {
    expect(gatherSkillUseWarnings([{ ...credit(), pendingScene: true }], ["credit"])).toEqual([]);
  });

  it("同じ kind は重複して警告しない", () => {
    expect(gatherSkillUseWarnings([credit(), credit()], ["credit"])).toEqual(["口座凍結"]);
  });
});

describe("hasBountyBlock()：報酬点の使用不可(bountyBlock)", () => {
  const frozen = () => condRow({ kind: "soc-13", name: "口座凍結", def: { bountyBlock: true } });

  it("bountyBlock を持つ有効な行があれば true", () => {
    expect(hasBountyBlock([frozen()])).toBe(true);
  });

  it("bountyBlock を持たなければ false", () => {
    expect(hasBountyBlock([condRow({ kind: "phys-14", def: { skillPenalty: { skillKey: "perception", value: 5 } } })])).toBe(false);
    expect(hasBountyBlock([])).toBe(false);
  });

  it("休眠(pendingScene)は数えない", () => {
    expect(hasBountyBlock([{ ...frozen(), pendingScene: true }])).toBe(false);
  });
});

describe("負傷の直接効果フィールド（damage-chart → CONDITION_KINDS・2026-07-16）", () => {
  it("眼部損傷は〈知覚=perception〉上方判定 -5 (skillPenalty)", () => {
    expect(CONDITION_KINDS["phys-14"].skillPenalty).toEqual({ skillKey: "perception", value: 5 });
  });

  it("治療まで系: 口座凍結=信用固定+報酬点不可 / 造反=社会選択 / 人脈消失=コネ選択（sceneDeferred なし）", () => {
    expect(CONDITION_KINDS["soc-13"].skillBlock).toEqual({ skillKey: "stature" });
    expect(CONDITION_KINDS["soc-13"].bountyBlock).toBe(true);
    expect(CONDITION_KINDS["soc-13"].sceneDeferred).toBeUndefined();
    expect(CONDITION_KINDS["soc-14"].skillBlock).toEqual({ category: "society" });
    expect(CONDITION_KINDS["soc-15"].skillBlock).toEqual({ category: "contact" });
  });

  it("次シーン系: 信用失墜/スキャンダル/信頼喪失は sceneDeferred=true", () => {
    expect(CONDITION_KINDS["soc-6"].skillBlock).toEqual({ skillKey: "stature" });
    expect(CONDITION_KINDS["soc-6"].bountyBlock).toBe(true);
    expect(CONDITION_KINDS["soc-6"].sceneDeferred).toBe(true);
    expect(CONDITION_KINDS["soc-7"].skillBlock).toEqual({ category: "society" });
    expect(CONDITION_KINDS["soc-7"].sceneDeferred).toBe(true);
    expect(CONDITION_KINDS["soc-8"].skillBlock).toEqual({ category: "contact" });
    expect(CONDITION_KINDS["soc-8"].sceneDeferred).toBe(true);
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


describe("applyDamageTagMods()（ダメージタグ改変・支配タグ・2026-07-12）", () => {
  const stuporData = () => buildInflictedEffectsData("ment-11", { hidden: true }); // 自我危機: stupor + controlNegate
  const erasedData = () => buildInflictedEffectsData("soc-11", { hidden: true });  // 追放: erased

  it("mods 無し/空はそのまま返す", () => {
    const list = stuporData();
    expect(applyDamageTagMods(list, null)).toBe(list);
    expect(applyDamageTagMods(list, { replace: new Map(), add: new Map() })).toEqual(list);
  });

  it("replace: 昏睡→支配（名前/statuses/conditionKind を置換・replacedFrom を記録）", () => {
    const [d] = applyDamageTagMods(stuporData(), { replace: new Map([["stupor", "dominated"]]) });
    expect(d.statuses).toEqual(["dominated"]);
    expect(d.name).toBe("支配");
    expect(d.flags[SCOPE].conditionKind).toBe("dominated");
    expect(d.flags[SCOPE].replacedFrom).toBe("stupor");
  });

  it("replace: チャート項目由来の条件(controlNegate)は新タグへ引き継ぐ", () => {
    const [d] = applyDamageTagMods(stuporData(), { replace: new Map([["stupor", "dominated"]]) });
    expect(d.flags[SCOPE].conditions.dominated.pendingControlNegate).toBeDefined();
    expect(d.flags[SCOPE].conditions.stupor).toBeUndefined();
  });

  it("replace: 未知のタグキーは無視（元のまま）", () => {
    const [d] = applyDamageTagMods(stuporData(), { replace: new Map([["stupor", "unknownTag"]]) });
    expect(d.statuses).toEqual(["stupor"]);
  });

  it("add: 抹殺に支配を追加（元タグは残る・addedFrom を記録）", () => {
    const out = applyDamageTagMods(erasedData(), { add: new Map([["erased", ["dominated"]]]) });
    expect(out.map(d => d.statuses[0])).toEqual(["erased", "dominated"]);
    expect(out[1].name).toBe("支配");
    expect(out[1].flags[SCOPE].addedFrom).toBe("erased");
    expect(out[1].flags[SCOPE].hideFromList).toBe(true);
  });

  it("add: 対象外のタグには追加されない・未知の追加タグは無視", () => {
    const none = applyDamageTagMods(stuporData(), { add: new Map([["erased", ["dominated"]]]) });
    expect(none).toHaveLength(1);
    const bad = applyDamageTagMods(erasedData(), { add: new Map([["erased", ["unknownTag"]]]) });
    expect(bad).toHaveLength(1);
  });
});

describe("CONDITION_KINDS: 支配（dominated・2026-07-12）", () => {
  it("マーカータグ（type なし＝行動ブロックもロスト処理も持たない・非重複・戦闘不能グループ）", () => {
    const def = CONDITION_KINDS["dominated"];
    expect(def.label).toBe("支配");
    expect(def.group).toBe("incapacitation");
    expect(def.type).toBeUndefined();
    expect(def.stackable).toBe(false);
  });
});


describe("回復の範囲照合・除外（recoveryKindMatches / recoveryKindExcluded・2026-07-13）", () => {
  it("範囲: kind 指定は完全一致・kind 空はグループ全体・複数行は OR", () => {
    expect(recoveryKindMatches("panic", [{ group: "bs", kind: "panic" }])).toBe(true);
    expect(recoveryKindMatches("weakness", [{ group: "bs", kind: "panic" }])).toBe(false);
    expect(recoveryKindMatches("weakness", [{ group: "bs", kind: "" }])).toBe(true);
    expect(recoveryKindMatches("faint", [{ group: "bs", kind: "" }, { group: "incapacitation", kind: "" }])).toBe(true);
    // 負傷はグループ=系統(physical/mental/social)
    expect(recoveryKindMatches("phys-6", [{ group: "physical", kind: "" }])).toBe(true);
    expect(recoveryKindMatches("ment-11", [{ group: "physical", kind: "" }])).toBe(false);
    expect(recoveryKindMatches("soc-11", [{ group: "social", kind: "" }])).toBe(true);
  });

  it("範囲: 未知タグ・空行は不一致", () => {
    expect(recoveryKindMatches("unknown", [{ group: "bs", kind: "" }])).toBe(false);
    expect(recoveryKindMatches("panic", [])).toBe(false);
    expect(recoveryKindMatches("panic", null)).toBe(false);
  });

  it("除外: タグ自身と「そのタグを与える負傷」の両方を除外（指定タグを含むもの以外すべて）", () => {
    const ex = ["dead", "mind-break"];
    expect(recoveryKindExcluded("dead", ex)).toBe(true);
    expect(recoveryKindExcluded("phys-16", ex)).toBe(true);   // 斬首=完全死亡を与える
    expect(recoveryKindExcluded("phys-21", ex)).toBe(true);   // 頭部損傷=完全死亡
    expect(recoveryKindExcluded("ment-16", ex)).toBe(true);   // 自我崩壊=精神崩壊
    expect(recoveryKindExcluded("ment-21", ex)).toBe(true);   // 魂魄消失=精神崩壊
    expect(recoveryKindExcluded("phys-6", ex)).toBe(false);   // 胸部損傷(衰弱)は除外されない
    expect(recoveryKindExcluded("stupor", ex)).toBe(false);
  });

  it("除外: 抹殺は設定次第（ハードコードで強制しない＝未確定は卓裁定）", () => {
    expect(recoveryKindExcluded("erased", [])).toBe(false);
    expect(recoveryKindExcluded("erased", ["erased"])).toBe(true);
    expect(recoveryKindExcluded("soc-11", ["erased"])).toBe(true); // 追放=抹殺を与える
  });
});

describe("コンディション効果の無視ゲート（ignore.*・フェーズ12）", () => {
  describe("ignoreRuleMatches()", () => {
    it("all はあらゆる効果に一致", () => {
      expect(ignoreRuleMatches({ mode: "all" }, { group: "bs", kind: "poison", damageCategory: null })).toBe(true);
      expect(ignoreRuleMatches({ mode: "all" }, { group: "incapacitation", kind: "faint", damageCategory: "physical" })).toBe(true);
    });
    it("group はグループ一致のみ", () => {
      expect(ignoreRuleMatches({ mode: "group", group: "bs" }, { group: "bs", kind: "poison" })).toBe(true);
      expect(ignoreRuleMatches({ mode: "group", group: "bs" }, { group: "physical", kind: "phys-7" })).toBe(false);
    });
    it("kind は種別一致のみ", () => {
      expect(ignoreRuleMatches({ mode: "kind", kind: "poison" }, { group: "bs", kind: "poison" })).toBe(true);
      expect(ignoreRuleMatches({ mode: "kind", kind: "poison" }, { group: "bs", kind: "doped-minor" })).toBe(false);
    });
    it("damage は damageCategory があるときだけ・系統 null は全ダメージ由来", () => {
      expect(ignoreRuleMatches({ mode: "damage", category: "physical" }, { damageCategory: "physical" })).toBe(true);
      expect(ignoreRuleMatches({ mode: "damage", category: "physical" }, { damageCategory: "mental" })).toBe(false);
      expect(ignoreRuleMatches({ mode: "damage", category: null }, { damageCategory: "social" })).toBe(true);
      expect(ignoreRuleMatches({ mode: "damage", category: null }, { damageCategory: null })).toBe(false); // 由来なしは対象外
    });
  });

  describe("gatherIgnoreRules()", () => {
    it("有効な effects の ignore.* キーだけを規則化する", () => {
      const buffs = [
        { active: true, changes: [{ key: "ignore.bs", value: "" }, { key: "system.attack.value", value: 2 }] },
        { active: true, changes: [{ key: "ignore.damage.physical", value: "" }] },
        { active: false, changes: [{ key: "ignore.all", value: "" }] }, // 無効は無視
      ];
      expect(gatherIgnoreRules(buffs)).toEqual([
        { scope: "ignore", mode: "group", group: "bs", conditions: [] },
        { scope: "ignore", mode: "damage", category: "physical", conditions: [] },
      ]);
    });
  });

  describe("getEffectiveConditions()（effectIgnored 注釈・woundCategory 解決）", () => {
    const eff = (id, kind, flags = {}, changes = []) => ({
      id, disabled: false, active: true, statuses: new Set([kind]), name: kind, changes,
      flags: { [SCOPE]: { conditionKind: kind, ...flags } },
    });
    const ignoreEff = (id, key) => ({ id, disabled: false, active: true, statuses: new Set(), name: "ig", changes: [{ key, value: "" }], flags: {} });
    const flagOf = (conds, kind) => conds.find(c => c.kind === kind)?.effectIgnored;

    it("ignore なし → 全て effectIgnored=false", () => {
      const actor = { effects: [eff("b", "poison")], items: [] };
      expect(getEffectiveConditions(actor).every(c => c.effectIgnored === false)).toBe(true);
    });

    it("ignore.bs → BS のみ無視・負傷(group=physical)は残る", () => {
      const actor = { effects: [ignoreEff("ig", "ignore.bs"), eff("b", "poison"), eff("w", "phys-7")], items: [] };
      const conds = getEffectiveConditions(actor);
      expect(flagOf(conds, "poison")).toBe(true);
      expect(flagOf(conds, "phys-7")).toBe(false);
    });

    it("ignore.damage.physical → 負傷自身＋woundSource で肉体由来のみ無視", () => {
      const actor = { effects: [
        ignoreEff("ig", "ignore.damage.physical"),
        eff("w1", "phys-7", { woundCategory: "physical" }),
        eff("b1", "poison", { woundSource: "w1" }),   // 肉体由来
        eff("b2", "doped-minor"),                      // 直接付与(由来なし)
      ], items: [] };
      const conds = getEffectiveConditions(actor);
      expect(flagOf(conds, "phys-7")).toBe(true);
      expect(flagOf(conds, "poison")).toBe(true);
      expect(flagOf(conds, "doped-minor")).toBe(false);
    });

    it("ignore.damage.mental は肉体由来を無視しない", () => {
      const actor = { effects: [ignoreEff("ig", "ignore.damage.mental"), eff("w1", "phys-7", { woundCategory: "physical" })], items: [] };
      expect(flagOf(getEffectiveConditions(actor), "phys-7")).toBe(false);
    });

    it("ignore.all → 全て無視", () => {
      const actor = { effects: [ignoreEff("ig", "ignore.all"), eff("b", "poison"), eff("w", "phys-7")], items: [] };
      expect(getEffectiveConditions(actor).every(c => c.effectIgnored === true)).toBe(true);
    });

    it("手動フラグ manuallyIgnored → ルール無しでも effectIgnored=true(卓ツール)", () => {
      const actor = { effects: [eff("b", "poison", { manuallyIgnored: true }), eff("b2", "doped-minor")], items: [] };
      const conds = getEffectiveConditions(actor);
      expect(flagOf(conds, "poison")).toBe(true);
      expect(conds.find(c => c.kind === "poison")?.manuallyIgnored).toBe(true);
      // 手動フラグの無い別 BS は無視されない
      expect(flagOf(conds, "doped-minor")).toBe(false);
    });
  });
});
