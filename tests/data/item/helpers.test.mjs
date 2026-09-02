import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { defenceField, attackField, modeValueField, computeItemEffectiveValues, parseEffectTargetKey, parseEffectConditions, evalEffectConditions, resolveItemTotalPath, checkChangeMatches, computeCheckBonus, gatherCheckBonusSources, damageVsChangeMatches, gatherDamageVsSources, damageDealtChangeMatches, gatherDamageDealtSources, damageTakenChangeMatches, gatherDamageTakenSources, collectActorEffectBuffs, targetStyleWorksKeys, actorCardValueOverride, itemChangeTargets, buildTransferredEffectData, planTransferCopySync, effectAutoApplies, analyzeGrantLanding, itemGrantCandidates, rewriteGrantChangesForItem, AE_FLAG_PARAMS, flagTotalPath, readFlag, computeFlagEffectiveValues, parseBooleanFlagValue, isOutfitServiceImmune, isOutfitMalfunctioning, isOutfitDestroyed, isOutfitUnusable } = await import("../../../scripts/data/item/helpers.mjs");

describe("defenceField()", () => {
  it("呼び出せる", () => {
    expect(defenceField).toBeDefined();
  });

  it("SchemaField を返す", () => {
    expect(defenceField()).toBeInstanceOf(MockSchemaField);
  });

  it("mode / S_defence / P_defence / I_defence の 4 フィールドを持つ", () => {
    const field = defenceField();
    expect(field.fields).toHaveProperty("mode");
    expect(field.fields).toHaveProperty("S_defence");
    expect(field.fields).toHaveProperty("P_defence");
    expect(field.fields).toHaveProperty("I_defence");
  });

  it("mode は StringField で initial が none、choices は none/value", () => {
    const field = defenceField();
    expect(field.fields.mode).toBeInstanceOf(MockStringField);
    expect(field.fields.mode.options.initial).toBe("none");
    expect(field.fields.mode.options.choices).toEqual(["none", "value"]);
  });

  it("各フィールドは NumberField で initial が 0", () => {
    const field = defenceField();
    for (const key of ["S_defence", "P_defence", "I_defence"]) {
      expect(field.fields[key]).toBeInstanceOf(MockNumberField);
      expect(field.fields[key].options.initial).toBe(0);
    }
  });

  it("effectMod は持たない(v2: バフは適用パスが total へ直接)", () => {
    const field = defenceField();
    for (const key of ["S_effectMod", "P_effectMod", "I_effectMod"]) {
      expect(field.fields[key]).toBeUndefined();
    }
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(defenceField()).not.toBe(defenceField());
  });
});

describe("modeValueField()", () => {
  it("mode / value のみを持つ(effectMod は廃止)", () => {
    const field = modeValueField(["none", "value"]);
    expect(field).toBeInstanceOf(MockSchemaField);
    expect(field.fields).toHaveProperty("mode");
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).not.toHaveProperty("effectMod");
  });

  it("mode の choices は引数で指定される", () => {
    const field = modeValueField(["none", "value", "reference"]);
    expect(field.fields.mode.options.choices).toEqual(["none", "value", "reference"]);
  });
});

describe("attackField()", () => {
  it("呼び出せる", () => {
    expect(attackField).toBeDefined();
  });

  it("SchemaField を返す", () => {
    expect(attackField()).toBeInstanceOf(MockSchemaField);
  });

  it("damageType / value の 2 フィールドを持つ(effectMod/mod は廃止)", () => {
    const field = attackField();
    expect(field.fields).toHaveProperty("damageType");
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).not.toHaveProperty("effectMod");
    expect(field.fields).not.toHaveProperty("mod");
  });

  it("damageType は choices 付き StringField で initial が空文字 (単一選択、フェーズ6-2)", () => {
    const field = attackField();
    expect(field.fields.damageType).toBeInstanceOf(MockStringField);
    expect(field.fields.damageType.options.initial).toBe("");
    expect(Object.keys(field.fields.damageType.options.choices)).toEqual(["S", "P", "I", "X"]);
  });

  it("value は NumberField で initial が 0", () => {
    const field = attackField();
    expect(field.fields.value).toBeInstanceOf(MockNumberField);
    expect(field.fields.value.options.initial).toBe(0);
  });


  it("呼び出すたびに別インスタンスを返す", () => {
    expect(attackField()).not.toBe(attackField());
  });
});

describe("computeItemEffectiveValues()（v2: total=base）", () => {
  it("modeValue / attack は total=value（バフは適用パスが total へ直接効かせる）", () => {
    const sys = {
      guardValue: { mode: "value", value: 3, effectMod: 2 },
      attack: { damageType: "I", value: 4, effectMod: 9 },
    };
    computeItemEffectiveValues(sys);
    expect(sys.guardValue.total).toBe(3);
    expect(sys.attack.total).toBe(4);
    // ダメージ種別の実効値(2026-07-13): 上書き AE の着地先(素値 damageType は不変)
    expect(sys.attack.damageTypeTotal).toBe("I");
  });

  it("defence は S/P/I それぞれ total=base", () => {
    const sys = { defence: { mode: "value", S_defence: 1, P_defence: 2, I_defence: 3,
      S_effectMod: 10, P_effectMod: 20, I_effectMod: 30 } };
    computeItemEffectiveValues(sys);
    expect(sys.defence.S_total).toBe(1);
    expect(sys.defence.P_total).toBe(2);
    expect(sys.defence.I_total).toBe(3);
  });

  it("slots[].count の total=value", () => {
    const sys = { slots: [{ kind: "normal", count: { mode: "value", value: 2, effectMod: 1 } }] };
    computeItemEffectiveValues(sys);
    expect(sys.slots[0].count.total).toBe(2);
  });

  it("素の値(FAValue / residence)の Total=base", () => {
    const sys = {
      FAValue: 2, FAValueEffectMod: 3,
      appearanceTarget: 10, appearanceTargetEffectMod: 1,
      cyberSecurity: 5, cyberSecurityEffectMod: 0,
      analogSecurity: 4, analogSecurityEffectMod: 2,
    };
    computeItemEffectiveValues(sys);
    expect(sys.FAValueTotal).toBe(2);
    expect(sys.appearanceTargetTotal).toBe(10);
    expect(sys.cyberSecurityTotal).toBe(5);
    expect(sys.analogSecurityTotal).toBe(4);
  });

  it("base 値(value)は書き換えない", () => {
    const sys = { guardValue: { mode: "value", value: 3, effectMod: 2 } };
    computeItemEffectiveValues(sys);
    expect(sys.guardValue.value).toBe(3);
  });
});

describe("checkChangeMatches()", () => {
  it("技能(完全一致/プレフィックス)", () => {
    expect(checkChangeMatches("check.melee", { type: "skill", skillKeys: ["melee", "shooting"] })).toBe(true);
    expect(checkChangeMatches("check.melee", { type: "skill", skillKeys: ["shooting"] })).toBe(false);
    expect(checkChangeMatches("check.society_*", { type: "skill", skillKeys: ["society_police"] })).toBe(true);
  });
  it("グループ参照(スタイル/ワークス)は criteria.skills の style/organization で照合", () => {
    const crit = { type: "skill", skills: [
      { key: "kabutowari_cut", style: "kabutowari", organization: "" },
      { key: "society_media",  style: "",          organization: "kabuki" },
    ] };
    expect(checkChangeMatches("check.style.kabutowari", crit)).toBe(true);
    expect(checkChangeMatches("check.style.ayakashi", crit)).toBe(false);
    expect(checkChangeMatches("check.works.kabuki", crit)).toBe(true);
    expect(checkChangeMatches("check.works.union", crit)).toBe(false);
    // 完全一致/プレフィックスも同じ criteria.skills で動く
    expect(checkChangeMatches("check.society_*", crit)).toBe(true);
    expect(checkChangeMatches("check.kabutowari_cut", crit)).toBe(true);
  });
  it("グループ参照(社会下位区分)は criteria.skills の societyClass で照合(2026-08-26)", () => {
    const crit = { type: "skill", skills: [
      { key: "society_street", societyClass: "industry" },
      { key: "melee", societyClass: "" },
    ] };
    expect(checkChangeMatches("check.society.industry", crit)).toBe(true);
    expect(checkChangeMatches("check.society.nation", crit)).toBe(false);
    expect(checkChangeMatches("check.society.industry", { type: "ability", ability: "reason" })).toBe(false);
    // 未分類(societyClass 空)の社会技能は下位区分キーに合致しない(あらゆる社会は society_* が担う)
    expect(checkChangeMatches("check.society.industry", { type: "skill", skills: [{ key: "society_nova" }] })).toBe(false);
  });
  it("能力値判定 / 制御判定", () => {
    expect(checkChangeMatches("check.reason", { type: "ability", ability: "reason" })).toBe(true);
    expect(checkChangeMatches("check.reason", { type: "ability", ability: "passion" })).toBe(false);
    expect(checkChangeMatches("controlCheck.reason", { type: "control", ability: "reason" })).toBe(true);
    expect(checkChangeMatches("check.reason", { type: "control", ability: "reason" })).toBe(false);
  });
  it("判定全般（check.all・2026-07-13）: 技能判定・能力値判定に合致し制御判定には合致しない", () => {
    expect(checkChangeMatches("check.all", { type: "skill", skillKeys: ["melee"] })).toBe(true);
    expect(checkChangeMatches("check.all", { type: "ability", ability: "reason" })).toBe(true);
    expect(checkChangeMatches("check.all", { type: "control", ability: "reason" })).toBe(false);
  });
});

describe("computeCheckBonus()（同一効果の重複適用不可）", () => {
  const crit = { type: "skill", skillKeys: ["society_police", "society_media"] };

  it("単一効果＝その値", () => {
    const effs = [{ identity: "e1", changes: [{ key: "check.society_*", value: "1" }] }];
    expect(computeCheckBonus(effs, crit)).toBe(1);
  });

  it("同一効果が複数技能に合致しても1回(プレフィックスが2技能に当たっても+1)", () => {
    // crit に society 技能が2つあるが、1エフェクトなので +1
    const effs = [{ identity: "e1", changes: [{ key: "check.society_*", value: "1" }] }];
    expect(computeCheckBonus(effs, crit)).toBe(1);
  });

  it("同一 identity の複数効果は最大採用", () => {
    const effs = [
      { identity: "buffA", changes: [{ key: "check.society_*", value: "1" }] },
      { identity: "buffA", changes: [{ key: "check.society_*", value: "3" }] },
    ];
    expect(computeCheckBonus(effs, crit)).toBe(3);
  });

  it("別 identity はスタック", () => {
    const effs = [
      { identity: "buffA", changes: [{ key: "check.society_*", value: "1" }] },
      { identity: "buffB", changes: [{ key: "check.society_*", value: "2" }] },
    ];
    expect(computeCheckBonus(effs, crit)).toBe(3);
  });

  it("stackable は重複排除せず加算", () => {
    const effs = [
      { identity: "buffA", stackable: true, changes: [{ key: "check.society_*", value: "1" }] },
      { identity: "buffA", stackable: true, changes: [{ key: "check.society_*", value: "1" }] },
    ];
    expect(computeCheckBonus(effs, crit)).toBe(2);
  });

  it("非アクティブはスキップ", () => {
    const effs = [{ identity: "e1", active: false, changes: [{ key: "check.society_*", value: "5" }] }];
    expect(computeCheckBonus(effs, crit)).toBe(0);
  });

  it("1つの効果の複数の該当行は合算される（行は効果の内容・2026-07-17 裁定）", () => {
    // 禁止は「同名効果の二重適用」(インスタンス単位)であり、1効果内の行は畳み込まない
    const effs = [{ identity: "e1", changes: [{ key: "check.all", value: "1" }, { key: "check.society_police", value: "2" }] }];
    expect(computeCheckBonus(effs, crit)).toBe(3);
  });
});

describe("gatherCheckBonusSources()（チャット内訳）", () => {
  const crit = { type: "skill", skillKeys: ["society_police"] };

  it("寄与エフェクトを name+value で返す（重複排除・最大採用）", () => {
    const effs = [
      { identity: "buffA", name: "情報網", changes: [{ key: "check.society_*", value: "1" }] },
      { identity: "buffA", name: "情報網", changes: [{ key: "check.society_*", value: "3" }] },
      { identity: "buffB", name: "コネ", stackable: true, changes: [{ key: "check.society_*", value: "2" }] },
    ];
    const sources = gatherCheckBonusSources(effs, crit);
    expect(sources).toEqual([
      { name: "情報網", value: 3 },
      { name: "コネ", value: 2 },
    ]);
  });

  it("名前が無い場合は (無名効果)", () => {
    const effs = [{ identity: "e1", changes: [{ key: "check.society_*", value: "1" }] }];
    expect(gatherCheckBonusSources(effs, crit)[0].name).toBe("(無名効果)");
  });
});

describe("damageVsChangeMatches()（ダメージ対象バフ・攻撃対象のスタイル/ワークスで照合）", () => {
  const crit = { styles: ["ayakashi", "kabutowari"], works: ["kabuki"] };
  it("対象が持つスタイル/ワークスに一致すれば true", () => {
    expect(damageVsChangeMatches("damage.vsStyle.ayakashi", crit)).toBe(true);
    expect(damageVsChangeMatches("damage.vsStyle.tatara", crit)).toBe(false);
    expect(damageVsChangeMatches("damage.vsWorks.kabuki", crit)).toBe(true);
    expect(damageVsChangeMatches("damage.vsWorks.union", crit)).toBe(false);
  });
  it("判定バフキー(check.*)や値バフキーは damageVs として照合しない", () => {
    expect(damageVsChangeMatches("check.style.ayakashi", crit)).toBe(false);
    expect(damageVsChangeMatches("system.ability.reason", crit)).toBe(false);
  });

  describe("damage.vsWet / damage.vsNotWet（対象のウェット状態で照合・2026-09-01）", () => {
    const wet    = { styles: [], works: [], isWet: true,  category: "physical" };
    const notWet = { styles: [], works: [], isWet: false, category: "physical" };

    it("vsWet は対象がウェットのときだけ・vsNotWet はその逆", () => {
      expect(damageVsChangeMatches("damage.vsWet", wet)).toBe(true);
      expect(damageVsChangeMatches("damage.vsWet", notWet)).toBe(false);
      expect(damageVsChangeMatches("damage.vsNotWet", notWet)).toBe(true);
      expect(damageVsChangeMatches("damage.vsNotWet", wet)).toBe(false);
    });

    it("系統セレクタは攻撃の系統に一致するときだけ（系統なしは全系統）", () => {
      expect(damageVsChangeMatches("damage.vsWet.physical", wet)).toBe(true);
      expect(damageVsChangeMatches("damage.vsWet.mental", wet)).toBe(false);
      expect(damageVsChangeMatches("damage.vsWet.mental", { ...wet, category: "mental" })).toBe(true);
    });

    it("対象未解決(isWet 未供給)では照合しない＝ゲートしない", () => {
      expect(damageVsChangeMatches("damage.vsWet", { styles: [], works: [] })).toBe(false);
      expect(damageVsChangeMatches("damage.vsNotWet", { styles: [], works: [] })).toBe(false);
    });

    it("不正な系統セレクタはキーとして成立しない", () => {
      expect(damageVsChangeMatches("damage.vsWet.unknown", wet)).toBe(false);
    });

    it("寄与の集計は他の damage.vs* と同じ経路（重複規約も共通）", () => {
      const effs = [
        { identity: "a", name: "電脳の刃", changes: [{ key: "damage.vsNotWet", value: "3" }] },
        { identity: "b", name: "生身狩り", changes: [{ key: "damage.vsWet.physical", value: "5" }] },
      ];
      expect(gatherDamageVsSources(effs, wet)).toEqual([{ name: "生身狩り", value: 5 }]);
      expect(gatherDamageVsSources(effs, notWet)).toEqual([{ name: "電脳の刃", value: 3 }]);
    });
  });
});

describe("damageDealtChangeMatches() / gatherDamageDealtSources()（与えるダメージバフ・2026-07-11）", () => {
  it("系統なし(damage.dealt)は全系統・系統つきは一致時のみ", () => {
    expect(damageDealtChangeMatches("damage.dealt", "physical")).toBe(true);
    expect(damageDealtChangeMatches("damage.dealt", "social")).toBe(true);
    expect(damageDealtChangeMatches("damage.dealt.physical", "physical")).toBe(true);
    expect(damageDealtChangeMatches("damage.dealt.physical", "mental")).toBe(false);
    expect(damageDealtChangeMatches("damage.vsStyle.ayakashi", "physical")).toBe(false); // 別スコープ
  });

  it("寄与を name+value で返す（identity 最大採用・判定バフと同じ重複規約）", () => {
    const effs = [
      { identity: "a", name: "剛力", changes: [{ key: "damage.dealt", value: "2" }] },
      { identity: "a", name: "剛力", changes: [{ key: "damage.dealt.physical", value: "4" }] },
      { identity: "b", name: "精神集中", changes: [{ key: "damage.dealt.mental", value: "3" }] },
    ];
    expect(gatherDamageDealtSources(effs, "physical")).toEqual([{ name: "剛力", value: 4 }]);
    expect(gatherDamageDealtSources(effs, "mental")).toEqual([
      { name: "剛力", value: 2 },
      { name: "精神集中", value: 3 },
    ]);
  });
});

describe("gatherDamageVsSources()（対象バフの内訳・判定バフと同じ重複規約）", () => {
  const crit = { styles: ["ayakashi"], works: [] };
  it("寄与を name+value で返す（identity 単位で最大採用・stackable は列挙）", () => {
    const effs = [
      { identity: "tokkou", name: "アヤカシ特効", changes: [{ key: "damage.vsStyle.ayakashi", value: "3" }] },
      { identity: "tokkou", name: "アヤカシ特効", changes: [{ key: "damage.vsStyle.ayakashi", value: "5" }] },
      { identity: "stk", name: "重ねがけ", stackable: true, changes: [{ key: "damage.vsStyle.ayakashi", value: "2" }] },
      { identity: "miss", name: "対象外", changes: [{ key: "damage.vsStyle.tatara", value: "9" }] },
    ];
    expect(gatherDamageVsSources(effs, crit)).toEqual([
      { name: "アヤカシ特効", value: 5 },
      { name: "重ねがけ", value: 2 },
    ]);
  });
});

describe("damageTakenChangeMatches() / gatherDamageTakenSources()（受けるダメージ軽減AE・2026-07-17）", () => {
  const crit = { category: "physical", damageType: "S", attackerStyles: ["kabuki"], attackerWorks: ["union"] };

  it("parseEffectTargetKey: taken は系統/ダメージ種別セレクタ・from は攻撃者のスタイル/ワークス", () => {
    expect(parseEffectTargetKey("damage.taken")).toMatchObject({ scope: "damageTaken", category: null, damageType: null });
    expect(parseEffectTargetKey("damage.taken.physical")).toMatchObject({ scope: "damageTaken", category: "physical", damageType: null });
    expect(parseEffectTargetKey("damage.taken.mental")).toMatchObject({ scope: "damageTaken", category: "mental", damageType: null });
    expect(parseEffectTargetKey("damage.taken.S")).toMatchObject({ scope: "damageTaken", category: "physical", damageType: "S" });
    expect(parseEffectTargetKey("damage.taken.X")).toMatchObject({ scope: "damageTaken", category: "physical", damageType: "X" });
    expect(parseEffectTargetKey("damage.taken.slash")).toBeNull();  // 未知セレクタ
    expect(parseEffectTargetKey("damage.fromStyle.kabuki")).toMatchObject({ scope: "damageFrom", group: "style", selector: "kabuki" });
    expect(parseEffectTargetKey("damage.fromWorks.union")).toMatchObject({ scope: "damageFrom", group: "works", selector: "union" });
    expect(parseEffectTargetKey("damage.fromStyle")).toBeNull();    // セレクタ無し
  });

  it("照合: 系統・ダメージ種別・攻撃者スタイル/ワークス", () => {
    expect(damageTakenChangeMatches("damage.taken", crit)).toBe(true);
    expect(damageTakenChangeMatches("damage.taken.physical", crit)).toBe(true);
    expect(damageTakenChangeMatches("damage.taken.mental", crit)).toBe(false);
    expect(damageTakenChangeMatches("damage.taken.S", crit)).toBe(true);
    expect(damageTakenChangeMatches("damage.taken.P", crit)).toBe(false);
    // 種別キーは精神/社会攻撃(種別なし)に合致しない
    expect(damageTakenChangeMatches("damage.taken.S", { category: "mental", damageType: "" })).toBe(false);
    expect(damageTakenChangeMatches("damage.fromStyle.kabuki", crit)).toBe(true);
    expect(damageTakenChangeMatches("damage.fromStyle.tatara", crit)).toBe(false);
    expect(damageTakenChangeMatches("damage.fromWorks.union", crit)).toBe(true);
    expect(damageTakenChangeMatches("damage.dealt", crit)).toBe(false); // 攻撃側キーは対象外
  });

  it("寄与: 効果内の該当行は合算・同一 identity のインスタンスは最も効果の大きい(最小)1つ・stackable は累積", () => {
    const effs = [
      { identity: "guard", name: "鉄壁", changes: [{ key: "damage.taken", value: "-2" }, { key: "damage.taken.S", value: "-5" }] },
      { identity: "guard", name: "鉄壁", changes: [{ key: "damage.taken", value: "-3" }] },
      { identity: "curse", name: "呪い", changes: [{ key: "damage.taken", value: "2" }] },
      { identity: "stk", name: "重ねがけ", stackable: true, changes: [{ key: "damage.taken", value: "-1" }] },
      { identity: "anti", name: "対カブキ", changes: [{ key: "damage.fromStyle.kabuki", value: "-4" }] },
      { identity: "miss", name: "対象外", changes: [{ key: "damage.fromStyle.tatara", value: "-9" }] },
    ];
    expect(gatherDamageTakenSources(effs, crit)).toEqual([
      { name: "鉄壁", value: -7 },   // 行の合算(-2-5)がインスタンス値。同 identity の -3 より効果大
      { name: "呪い", value: 2 },
      { name: "対カブキ", value: -4 },
      { name: "重ねがけ", value: -1 },
    ]);
  });

  it("taken と fromStyle が同一効果に併記されたら、どちらもその効果の内容として効く（合算・2026-07-17 裁定）", () => {
    const effs = [
      { identity: "dual", name: "複合軽減", changes: [{ key: "damage.taken", value: "-2" }, { key: "damage.fromStyle.kabuki", value: "-6" }] },
    ];
    expect(gatherDamageTakenSources(effs, crit)).toEqual([{ name: "複合軽減", value: -8 }]);
  });
});

describe("targetStyleWorksKeys()（攻撃対象のスタイル/ワークス識別キー）", () => {
  it("type:style の識別キーと styleSkill の組織を集める（重複排除・'-'除外・対象外型は無視）", () => {
    const target = { items: [
      { type: "style", system: { identificationKey: "ayakashi" } },
      { type: "style", system: { identificationKey: "ayakashi" } },
      { type: "styleSkill", system: { special: { works: { organization: "kabuki" } } } },
      { type: "styleSkill", system: { special: { works: { organization: "-" } } } },
      { type: "weapon", system: { identificationKey: "gun" } },
    ] };
    expect(targetStyleWorksKeys(target)).toEqual({ styles: ["ayakashi"], works: ["kabuki"] });
  });
  it("対象なし・アイテムなしは空配列", () => {
    expect(targetStyleWorksKeys(null)).toEqual({ styles: [], works: [] });
    expect(targetStyleWorksKeys({ items: [] })).toEqual({ styles: [], works: [] });
  });
});

describe("collectActorEffectBuffs()（アクター＋所有アイテムの effects を正規形に）", () => {
  it("自身と所有アイテムの effects を identity/name/stackable/active/changes で集める", () => {
    const actor = {
      effects: [{ id: "a1", name: "自前", active: true, changes: [{ key: "check.melee", value: "1" }] }],
      items: [{ effects: [{ id: "i1", name: "装備", active: true, flags: { "tokyo-nova-axleration": { effectId: "eid", stackable: true } }, changes: [] }] }],
    };
    const out = collectActorEffectBuffs(actor);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ identity: "a1", name: "自前", stackable: false });
    expect(out[1]).toMatchObject({ identity: "eid", name: "装備", stackable: true });
  });
});

describe("actorCardValueOverride()（カード数字の上書き・2026-07-13）", () => {
  const mkActor = (value) => ({
    effects: [{ id: "e1", active: true, flags: {}, changes: [{ key: "check.cardValue", value }] }],
    items: [],
  });
  it("A/J/Q/K は 1/11/12/13・数字はそのまま", () => {
    expect(actorCardValueOverride(mkActor("A"))).toBe(1);
    expect(actorCardValueOverride(mkActor("J"))).toBe(11);
    expect(actorCardValueOverride(mkActor("Q"))).toBe(12);
    expect(actorCardValueOverride(mkActor("K"))).toBe(13);
    expect(actorCardValueOverride(mkActor("7"))).toBe(7);
    expect(actorCardValueOverride(mkActor("10"))).toBe(10);
  });
  it("不正値・空・非アクティブは null", () => {
    expect(actorCardValueOverride(mkActor("15"))).toBeNull();
    expect(actorCardValueOverride(mkActor(""))).toBeNull();
    const inactive = mkActor("A");
    inactive.effects[0].active = false;
    expect(actorCardValueOverride(inactive)).toBeNull();
  });
});

describe("物理転送（itemChangeTargets / buildTransferredEffectData・2026-07-13 再設計）", () => {
  const weapon = { documentName: "Item", id: "w1", type: "weapon", system: { identificationKey: "buki", minorCategory: "melee", majorCategory: "weapon" } };
  const genSkill = { documentName: "Item", id: "s1", type: "generalSkill", system: { identificationKey: "shanai" } };
  const optionBearer = { documentName: "Item", id: "o1", name: "強化オプション", system: { parentItemId: "w1" } };
  const effect = (changes, flags = {}) => ({
    uuid: "Actor.a.Item.o1.ActiveEffect.e1", name: "強化", img: "icons/svg/aura.svg",
    disabled: false, changes, flags,
  });

  it("識別キー/カテゴリの変更が対象アイテムに向くか判定できる", () => {
    const pk = (k) => parseEffectTargetKey(k);
    expect(itemChangeTargets(pk("item.buki.system.attack.value"), weapon)).toBe(true);
    expect(itemChangeTargets(pk("item.hoka.system.attack.value"), weapon)).toBe(false);
    expect(itemChangeTargets(pk("system.category.melee.attack"), weapon)).toBe(true);
    expect(itemChangeTargets(pk("system.attack.value"), weapon)).toBe(false); // 素のキーは転送対象外
  });

  it("疑似分類: system.category.generalSkill/styleSkill はアイテムタイプで束ねる", () => {
    const pk = (k) => parseEffectTargetKey(k);
    expect(itemChangeTargets(pk("system.category.generalSkill.level"), genSkill)).toBe(true);
    expect(itemChangeTargets(pk("system.category.generalSkill.level"), weapon)).toBe(false);
    expect(itemChangeTargets(pk("system.category.styleSkill.level"), genSkill)).toBe(false);
  });

  it("転送コピー: 向く変更だけを素のキー（system.*）に書き換えて生成（由来フラグつき）", () => {
    const e = effect([
      { key: "item.buki.system.attack.damageType", mode: 5, value: "S" },
      { key: "system.category.melee.attack", mode: 2, value: "2" },
      { key: "system.ability.reason.value", mode: 2, value: "1" }, // アクター向け=転送しない
    ]);
    const data = buildTransferredEffectData(e, weapon, optionBearer);
    expect(data.changes.map(c => c.key)).toEqual([
      "system.attack.damageType",
      "system.attack",
    ]);
    expect(data.changes[0].value).toBe("S");
    expect(data.origin).toBe(e.uuid);
    expect(data.flags["tokyo-nova-axleration"].transferredFrom).toBe(e.uuid);
    expect(data.flags["tokyo-nova-axleration"].transferredSourceName).toBe("強化オプション");
    expect(data.transfer).toBe(false);
  });

  it("準備先（applyToParent）: 素のキーの変更を準備先ホストへそのまま転送（混在は落ちる）", () => {
    const flags = { "tokyo-nova-axleration": { applyToParent: true } };
    const e = effect([
      { key: "system.attack.value", mode: 2, value: "2" },
      { key: "system.category.melee.attack", mode: 2, value: "9" }, // 混在非対応=落ちる
      { key: "check.melee", mode: 2, value: "1" },                  // 実行時系統=落ちる
    ], flags);
    const data = buildTransferredEffectData(e, weapon, optionBearer);
    expect(data.changes.map(c => c.key)).toEqual(["system.attack.value"]);
    // 準備先でないアイテムへは転送しない
    expect(buildTransferredEffectData(e, genSkill, optionBearer)).toBeNull();
    // 準備されていない(bearer が Item でない/parentItemId 不一致)なら転送しない
    expect(buildTransferredEffectData(e, weapon, { documentName: "Item", id: "x", system: { parentItemId: "" } })).toBeNull();
  });

  it("同一性と重複可を供給元から引き継ぐ（effectId / stackable）", () => {
    const flags = { "tokyo-nova-axleration": { effectId: "dic-001", stackable: true } };
    const e = effect([{ key: "item.buki.system.attack.value", mode: 2, value: "2" }], flags);
    const data = buildTransferredEffectData(e, weapon, optionBearer);
    expect(data.flags["tokyo-nova-axleration"].effectId).toBe("dic-001");
    expect(data.flags["tokyo-nova-axleration"].stackable).toBe(true);
  });

  it("向く変更が無ければ null", () => {
    const e = effect([{ key: "system.ability.reason.value", mode: 2, value: "1" }]);
    expect(buildTransferredEffectData(e, weapon, optionBearer)).toBeNull();
  });
});

describe("resolveItemTotalPath()", () => {
  it("フルパス正規化(2026-07-13): 素値/実効どちらの綴りでも必ず実効(total 系)へ着地する", () => {
    expect(resolveItemTotalPath("attack.value")).toBe("attack.total");
    expect(resolveItemTotalPath("attack.total")).toBe("attack.total");
    expect(resolveItemTotalPath("attack")).toBe("attack.total");
    expect(resolveItemTotalPath("guardValue.value")).toBe("guardValue.total");
    expect(resolveItemTotalPath("level")).toBe("levelTotal");
    expect(resolveItemTotalPath("levelTotal")).toBe("levelTotal");
    expect(resolveItemTotalPath("defence.S")).toBe("defence.S_total");
    expect(resolveItemTotalPath("defence.S_defence")).toBe("defence.S_total");
    expect(resolveItemTotalPath("defence.S_total")).toBe("defence.S_total");
  });

  it("ダメージ種別は実効フィールドへ(設定欄の素値には書かない・2026-07-13 訂正)", () => {
    expect(resolveItemTotalPath("attack.damageType")).toBe("attack.damageTypeTotal");
    expect(resolveItemTotalPath("attack.damageTypeTotal")).toBe("attack.damageTypeTotal");
  });
  it("modeValue/attack は <param>.total", () => {
    expect(resolveItemTotalPath("attack")).toBe("attack.total");
    expect(resolveItemTotalPath("guardValue")).toBe("guardValue.total");
  });
  it("defence.S/P/I は defence.X_total", () => {
    expect(resolveItemTotalPath("defence.S")).toBe("defence.S_total");
    expect(resolveItemTotalPath("defence.I")).toBe("defence.I_total");
  });
  it("素の値は <param>Total", () => {
    expect(resolveItemTotalPath("level")).toBe("levelTotal");
    expect(resolveItemTotalPath("FAValue")).toBe("FAValueTotal");
    expect(resolveItemTotalPath("cyberSecurity")).toBe("cyberSecurityTotal");
  });

  it("特性フラグ(フェーズ12): 素/実効どちらの綴りも実効フィールドへ", () => {
    expect(resolveItemTotalPath("isFullAuto")).toBe("isFullAutoTotal");
    expect(resolveItemTotalPath("isFullAutoTotal")).toBe("isFullAutoTotal");
    expect(resolveItemTotalPath("suits.spade")).toBe("suits.spadeTotal");
    expect(resolveItemTotalPath("suits.spadeTotal")).toBe("suits.spadeTotal");
  });

  it("使用回数の最大値(KI-038・2026-08-09): 素/実効どちらの綴りも uses.maxTotal へ着地する", () => {
    expect(resolveItemTotalPath("uses.max")).toBe("uses.maxTotal");
    expect(resolveItemTotalPath("uses.maxTotal")).toBe("uses.maxTotal");
  });
});

describe("特性フラグ AE(フェーズ12)", () => {
  it("flagTotalPath: 素パス → 実効パス(末尾に Total)", () => {
    expect(flagTotalPath("isFullAuto")).toBe("isFullAutoTotal");
    expect(flagTotalPath("suits.spade")).toBe("suits.spadeTotal");
  });

  it("AE_FLAG_PARAMS は特性系のみ(構造的な isAction/noCombo は含まない)", () => {
    expect(AE_FLAG_PARAMS).toContain("isFullAuto");
    expect(AE_FLAG_PARAMS).toContain("suits.spade");
    expect(AE_FLAG_PARAMS).toContain("usesBounty");
    expect(AE_FLAG_PARAMS).not.toContain("isAction");
    expect(AE_FLAG_PARAMS).not.toContain("noCombo");
  });

  it("computeFlagEffectiveValues: base から <フラグ>Total を派生(ネストも)", () => {
    const sys = { isFullAuto: true, suits: { spade: true, heart: false } };
    computeFlagEffectiveValues(sys);
    expect(sys.isFullAutoTotal).toBe(true);
    expect(sys.suits.spadeTotal).toBe(true);
    expect(sys.suits.heartTotal).toBe(false);
  });

  it("readFlag: 実効(Total)があればそれ、無ければ base", () => {
    expect(readFlag({ isFullAuto: true }, "isFullAuto")).toBe(true);         // base のみ
    expect(readFlag({ isFullAuto: true, isFullAutoTotal: false }, "isFullAuto")).toBe(false); // AE で off
    expect(readFlag({ suits: { spade: false, spadeTotal: true } }, "suits.spade")).toBe(true);
    expect(readFlag({}, "isFullAuto")).toBe(false);
  });

  it("parseBooleanFlagValue: true/false 系文字列と 1/0 を解釈、不能は null", () => {
    expect(parseBooleanFlagValue("true")).toBe(true);
    expect(parseBooleanFlagValue("1")).toBe(true);
    expect(parseBooleanFlagValue("オン")).toBe(true);
    expect(parseBooleanFlagValue("false")).toBe(false);
    expect(parseBooleanFlagValue("0")).toBe(false);
    expect(parseBooleanFlagValue("xyz")).toBeNull();
  });

  it("AE_FLAG_PARAMS は故障/破壊を含む(AE で書き換え可能・2026-07-18)", () => {
    expect(AE_FLAG_PARAMS).toContain("isMalfunction");
    expect(AE_FLAG_PARAMS).toContain("isDestroyed");
  });
});

describe("アウトフィット故障/破壊ヘルパー(2026-07-18)", () => {
  it("isOutfitServiceImmune: サービス大分類のみ true", () => {
    expect(isOutfitServiceImmune({ majorCategory: "service" })).toBe(true);
    expect(isOutfitServiceImmune({ majorCategory: "weapon" })).toBe(false);
    expect(isOutfitServiceImmune({})).toBe(false);
  });

  it("isOutfitMalfunctioning: 実効フラグ(AE 反映)。サービスは常に false", () => {
    // base のみ
    expect(isOutfitMalfunctioning({ majorCategory: "weapon", isMalfunction: true })).toBe(true);
    // AE で on(Total)
    expect(isOutfitMalfunctioning({ majorCategory: "weapon", isMalfunction: false, isMalfunctionTotal: true })).toBe(true);
    // AE で off
    expect(isOutfitMalfunctioning({ majorCategory: "weapon", isMalfunction: true, isMalfunctionTotal: false })).toBe(false);
    // サービス免疫
    expect(isOutfitMalfunctioning({ majorCategory: "service", isMalfunction: true })).toBe(false);
    expect(isOutfitMalfunctioning({ majorCategory: "service", isMalfunctionTotal: true })).toBe(false);
  });

  it("isOutfitDestroyed: 実効フラグ。サービスは常に false", () => {
    expect(isOutfitDestroyed({ majorCategory: "vehicle", isDestroyed: true })).toBe(true);
    expect(isOutfitDestroyed({ majorCategory: "vehicle", isDestroyed: false, isDestroyedTotal: true })).toBe(true);
    expect(isOutfitDestroyed({ majorCategory: "service", isDestroyed: true })).toBe(false);
  });

  it("isOutfitUnusable: 故障または破壊で true", () => {
    expect(isOutfitUnusable({ majorCategory: "weapon", isMalfunction: true })).toBe(true);
    expect(isOutfitUnusable({ majorCategory: "weapon", isDestroyed: true })).toBe(true);
    expect(isOutfitUnusable({ majorCategory: "weapon" })).toBe(false);
    expect(isOutfitUnusable({ majorCategory: "service", isMalfunction: true, isDestroyed: true })).toBe(false);
  });
});

describe("parseEffectTargetKey()（フェーズ12: 名前装飾・部位)", () => {
  it("名前装飾: 素のキー name＝乗っているアイテム自身の名前", () => {
    expect(parseEffectTargetKey("name")).toMatchObject({ scope: "itemName", conditions: [] });
  });

  it("名前装飾: 識別キー狙い item.<キー>.name", () => {
    expect(parseEffectTargetKey("item.longsword.name")).toMatchObject({ scope: "skill", selector: "longsword", path: "name" });
  });

  it("system.name は誤記として無効(死にキー)", () => {
    expect(parseEffectTargetKey("system.name")).toBeNull();
  });

  it("アクター部位スロット増減: system.partSlot.<部位キー>", () => {
    expect(parseEffectTargetKey("system.partSlot.one-hand")).toMatchObject({ scope: "partSlot", selector: "one-hand", conditions: [] });
  });

  it("アイテム部位行の追加: system.part.<部位キー>", () => {
    expect(parseEffectTargetKey("system.part.overhead")).toMatchObject({ scope: "partAdd", selector: "overhead", path: "part.overhead" });
  });

  it("system.part(セレクタ無し)は無効", () => {
    expect(parseEffectTargetKey("system.part")).toBeNull();
  });
});

describe("parseEffectTargetKey()（コンディション効果の無視ゲート ignore.*・フェーズ12）", () => {
  it("ignore.all＝あらゆる効果", () => {
    expect(parseEffectTargetKey("ignore.all")).toMatchObject({ scope: "ignore", mode: "all", conditions: [] });
  });

  it("ignore.bs＝全BSの効果(グループ)", () => {
    expect(parseEffectTargetKey("ignore.bs")).toMatchObject({ scope: "ignore", mode: "group", group: "bs", conditions: [] });
  });

  it("ignore.bs.<kind>＝個別BS", () => {
    expect(parseEffectTargetKey("ignore.bs.poison")).toMatchObject({ scope: "ignore", mode: "kind", kind: "poison", conditions: [] });
  });

  it("ignore.damage＝ダメージ由来の効果すべて(全系統)", () => {
    expect(parseEffectTargetKey("ignore.damage")).toMatchObject({ scope: "ignore", mode: "damage", category: null, conditions: [] });
  });

  it("ignore.damage.<系統>＝その系統のダメージ由来の効果", () => {
    expect(parseEffectTargetKey("ignore.damage.physical")).toMatchObject({ scope: "ignore", mode: "damage", category: "physical", conditions: [] });
    expect(parseEffectTargetKey("ignore.damage.mental")).toMatchObject({ scope: "ignore", mode: "damage", category: "mental" });
    expect(parseEffectTargetKey("ignore.damage.social")).toMatchObject({ scope: "ignore", mode: "damage", category: "social" });
  });

  it("未知の系統・セレクタは無効", () => {
    expect(parseEffectTargetKey("ignore.damage.bogus")).toBeNull();
    expect(parseEffectTargetKey("ignore")).toBeNull();
    expect(parseEffectTargetKey("ignore.bogus")).toBeNull();
  });
});

describe("parseEffectTargetKey()（v2 system.<名前空間> 文法）", () => {
  it("値: ability / control", () => {
    expect(parseEffectTargetKey("system.ability.reason")).toMatchObject({ scope: "ability", path: "reason", conditions: [] });
    expect(parseEffectTargetKey("system.control.reason")).toMatchObject({ scope: "control", path: "reason" });
  });

  it("値: 素のパラメータキー＝効果が乗るアイテム自身（2026-07-13 再設計）", () => {
    expect(parseEffectTargetKey("system.attack.value")).toMatchObject({ scope: "self", path: "attack.value" });
    expect(parseEffectTargetKey("system.attack.damageType")).toMatchObject({ scope: "self", path: "attack.damageType" });
    expect(parseEffectTargetKey("system.level")).toMatchObject({ scope: "self", path: "level" });
  });

  it("廃止済みの旧綴り（self/parent/skill 名前空間）は死にキー（null）", () => {
    expect(parseEffectTargetKey("system.self.attack")).toBeNull();
    expect(parseEffectTargetKey("system.parent.attack")).toBeNull();
    expect(parseEffectTargetKey("system.skill.melee.level")).toBeNull();
    expect(parseEffectTargetKey("system.skill.society_*.level")).toBeNull();
  });

  it("値: category(小分類・大分類とも)", () => {
    expect(parseEffectTargetKey("system.category.melee.attack")).toMatchObject({ scope: "category", selector: "melee", path: "attack" });
    expect(parseEffectTargetKey("system.category.weapon.attack")).toMatchObject({ scope: "category", selector: "weapon", path: "attack" });
  });

  it("疑似分類: system.category.generalSkill/styleSkill（2026-07-13 再設計）", () => {
    expect(parseEffectTargetKey("system.category.generalSkill.level")).toMatchObject({ scope: "category", selector: "generalSkill", path: "level" });
    expect(parseEffectTargetKey("system.category.styleSkill.level")).toMatchObject({ scope: "category", selector: "styleSkill", path: "level" });
  });

  it("パスにドットを含む(defence.S)", () => {
    expect(parseEffectTargetKey("system.category.armor.defence.S")).toMatchObject({ scope: "category", selector: "armor", path: "defence.S" });
  });

  it("値: cs の3層(base/value/current・フェーズ10-5)", () => {
    expect(parseEffectTargetKey("system.cs.base")).toMatchObject({ scope: "cs", path: "base", conditions: [] });
    expect(parseEffectTargetKey("system.cs.value")).toMatchObject({ scope: "cs", path: "value" });
    expect(parseEffectTargetKey("system.cs.current")).toMatchObject({ scope: "cs", path: "current" });
  });

  it("cs の未知パスは null", () => {
    expect(parseEffectTargetKey("system.cs.total")).toBeNull();
    expect(parseEffectTargetKey("system.cs")).toBeNull();
  });

  it("値: ar.max(付与ARの実効・フェーズ11)", () => {
    expect(parseEffectTargetKey("system.ar.max")).toMatchObject({ scope: "ar", path: "max", conditions: [] });
  });

  it("ar の未知パスは null（現在AR への AE 着地は設けない）", () => {
    expect(parseEffectTargetKey("system.ar.value")).toBeNull();
    expect(parseEffectTargetKey("system.ar")).toBeNull();
  });

  it("判定: check.<能力値> / controlCheck.<能力値> / check.<技能>", () => {
    expect(parseEffectTargetKey("check.reason")).toMatchObject({ scope: "abilityCheck", ability: "reason" });
    expect(parseEffectTargetKey("controlCheck.reason")).toMatchObject({ scope: "controlCheck", ability: "reason" });
    expect(parseEffectTargetKey("check.melee")).toMatchObject({ scope: "skillCheck", selector: "melee", prefix: false });
    expect(parseEffectTargetKey("check.society_*")).toMatchObject({ scope: "skillCheck", selector: "society_", prefix: true });
  });

  it("判定グループ参照: check.style.<キー> / check.works.<キー>", () => {
    expect(parseEffectTargetKey("check.style.kabutowari")).toMatchObject({ scope: "skillCheck", group: "style", selector: "kabutowari" });
    expect(parseEffectTargetKey("check.works.kabuki")).toMatchObject({ scope: "skillCheck", group: "works", selector: "kabuki" });
    // 制御判定はグループ不可(能力値のみ)
    expect(parseEffectTargetKey("controlCheck.style.kabutowari")).toBeNull();
  });

  it("判定全般: check.all（無印「判定」＝能力値+技能判定・2026-07-13）", () => {
    expect(parseEffectTargetKey("check.all")).toMatchObject({ scope: "anyCheck" });
    // 制御判定は対象外(能力値のみのため null)
    expect(parseEffectTargetKey("controlCheck.all")).toBeNull();
  });

  it("カード数字の上書き: check.cardValue（値は A〜K・2026-07-13）", () => {
    expect(parseEffectTargetKey("check.cardValue")).toMatchObject({ scope: "cardValue" });
    expect(parseEffectTargetKey("controlCheck.cardValue")).toBeNull(); // 制御判定は対象外
  });

  it("スート変更マーカー: check.suitChange（値不要・2026-07-12）", () => {
    expect(parseEffectTargetKey("check.suitChange")).toMatchObject({ scope: "suitChange" });
    // 制御判定は対象外(能力値のみのため null)
    expect(parseEffectTargetKey("controlCheck.suitChange")).toBeNull();
  });

  it("ダメージタグ改変: damage.replaceTag.<タグ> / damage.addTag.<タグ>（支配タグ・2026-07-12）", () => {
    expect(parseEffectTargetKey("damage.replaceTag.stupor")).toMatchObject({ scope: "damageTag", mode: "replace", tag: "stupor" });
    expect(parseEffectTargetKey("damage.replaceTag.mind-break")).toMatchObject({ scope: "damageTag", mode: "replace", tag: "mind-break" });
    expect(parseEffectTargetKey("damage.addTag.erased")).toMatchObject({ scope: "damageTag", mode: "add", tag: "erased" });
    expect(parseEffectTargetKey("damage.replaceTag")).toBeNull(); // タグ無し
  });

  it("ダメージ対象バフ: damage.vsStyle.<キー> / damage.vsWorks.<キー>", () => {
    expect(parseEffectTargetKey("damage.vsStyle.ayakashi")).toMatchObject({ scope: "damageVs", group: "style", selector: "ayakashi" });
    expect(parseEffectTargetKey("damage.vsWorks.kabuki")).toMatchObject({ scope: "damageVs", group: "works", selector: "kabuki" });
    expect(parseEffectTargetKey("damage.vsStyle")).toBeNull();   // セレクタ無し
    expect(parseEffectTargetKey("damage.other.x")).toBeNull();   // 未知サブキー
  });

  it("与えるダメージバフ: damage.dealt[.<系統>](2026-07-11)", () => {
    expect(parseEffectTargetKey("damage.dealt")).toMatchObject({ scope: "damageDealt", category: null });
    expect(parseEffectTargetKey("damage.dealt.physical")).toMatchObject({ scope: "damageDealt", category: "physical" });
    expect(parseEffectTargetKey("damage.dealt.social")).toMatchObject({ scope: "damageDealt", category: "social" });
    expect(parseEffectTargetKey("damage.dealt.slash")).toBeNull(); // 未知系統
  });

  it("生身のダメージ種別上書き: system.baseAttack.damageType → 実効フィールドへ（2026-07-13）", () => {
    expect(parseEffectTargetKey("system.baseAttack.damageType")).toMatchObject({ scope: "baseAttackType" });
    expect(parseEffectTargetKey("system.baseAttack.value")).toBeNull(); // 他はネイティブ
  });

  it("アイテム狙いの識別キー記法: item.<識別キー>.system.*（式と同じ綴り・2026-07-13）", () => {
    expect(parseEffectTargetKey("item.melee.system.attack.value"))
      .toMatchObject({ scope: "skill", selector: "melee", prefix: false, path: "attack.value" });
    expect(parseEffectTargetKey("item.society_*.system.level"))
      .toMatchObject({ scope: "skill", selector: "society_", prefix: true, path: "level" });
    expect(parseEffectTargetKey("item.buki.system.attack.damageType"))
      .toMatchObject({ scope: "skill", selector: "buki", path: "attack.damageType" });
    // self/parent セレクタは廃止(自身=素のキー・準備先=AE 設定のチェック)
    expect(parseEffectTargetKey("item.self.system.attack")).toBeNull();
    expect(parseEffectTargetKey("item.parent.system.attack")).toBeNull();
    expect(parseEffectTargetKey("item.melee.attack")).toBeNull(); // system 抜きは不可
  });

  it("条件付き [hack>=3] / 複数 ;", () => {
    expect(parseEffectTargetKey("system.category.melee[hack>=3].attack").conditions)
      .toEqual([{ path: "hack", op: ">=", value: 3 }]);
    expect(parseEffectTargetKey("system.category.melee[hack>=3;guardValue>0].attack").conditions)
      .toEqual([{ path: "hack", op: ">=", value: 3 }, { path: "guardValue", op: ">", value: 0 }]);
  });

  it("不正・ネイティブキーは null（未知名前空間は素のパラメータキーとして解釈）", () => {
    expect(parseEffectTargetKey("")).toBeNull();
    expect(parseEffectTargetKey("noDotKey")).toBeNull();
    expect(parseEffectTargetKey("system.handMaxSizeMod")).toBeNull();   // ネイティブ(KI-020)
    expect(parseEffectTargetKey("system.unknown.x")).toMatchObject({ scope: "self", path: "unknown.x" });
    expect(parseEffectTargetKey(undefined)).toBeNull();
  });
});

describe("自動適用ゲート（effectAutoApplies・2026-07-13 再設計）", () => {
  const onItem = (over = {}) => ({ parent: { documentName: "Item" }, transfer: true, flags: {}, ...over });

  it("アクター上の効果・親なしは常に生きる", () => {
    expect(effectAutoApplies({ parent: { documentName: "Actor" }, transfer: false, flags: {} })).toBe(true);
    expect(effectAutoApplies({ transfer: false, flags: {} })).toBe(true);
  });
  it("アイテム上の効果は transfer（効果を対象に自動適用）がゲート", () => {
    expect(effectAutoApplies(onItem())).toBe(true);
    expect(effectAutoApplies(onItem({ transfer: false }))).toBe(false);
  });
  it("実体化済みインスタンス（転送コピー/付与コピー）は transfer=false でも生きる", () => {
    expect(effectAutoApplies(onItem({ transfer: false, flags: { "tokyo-nova-axleration": { transferredFrom: "x" } } }))).toBe(true);
    expect(effectAutoApplies(onItem({ transfer: false, flags: { "tokyo-nova-axleration": { grantedFrom: "x" } } }))).toBe(true);
  });
});

describe("使用時付与のアイテム着地（analyzeGrantLanding / itemGrantCandidates / rewriteGrantChangesForItem）", () => {
  const weapon  = { id: "w1", type: "weapon", name: "ブレード", system: { identificationKey: "buki", minorCategory: "melee", majorCategory: "weapon", attack: {} } };
  const weapon2 = { id: "w2", type: "weapon", name: "ガン",     system: { identificationKey: "", minorCategory: "ranged", majorCategory: "weapon", attack: {} } };
  const armor   = { id: "a1", type: "armor",  name: "アーマー", system: { minorCategory: "bodyArmor", majorCategory: "armor", defence: {} } };
  const skill   = { id: "s1", type: "generalSkill", name: "社内政治", system: { identificationKey: "shanai", level: 1 } };
  const items = [weapon, weapon2, armor, skill];

  it("着地種別: アイテム狙いキーが1つでもあればアイテム着地、無ければアクター着地", () => {
    expect(analyzeGrantLanding([{ key: "system.attack.value" }])).toBe("item");
    expect(analyzeGrantLanding([{ key: "system.category.melee.attack" }])).toBe("item");
    expect(analyzeGrantLanding([{ key: "item.buki.system.attack.value" }])).toBe("item");
    expect(analyzeGrantLanding([{ key: "check.melee" }, { key: "system.ability.reason.value" }])).toBe("actor");
    expect(analyzeGrantLanding([])).toBe("actor");
  });

  it("候補: 素のキーは全アウトフィット（対象パラメータ持ちのみ）", () => {
    const c = itemGrantCandidates(items, [{ key: "system.attack.value" }]);
    expect(c.map(i => i.id)).toEqual(["w1", "w2"]); // attack を持たない防具・技能は除外
  });

  it("候補: 分類・疑似分類・識別キーで絞る", () => {
    expect(itemGrantCandidates(items, [{ key: "system.category.melee.attack" }]).map(i => i.id)).toEqual(["w1"]);
    expect(itemGrantCandidates(items, [{ key: "system.category.generalSkill.level" }]).map(i => i.id)).toEqual(["s1"]);
    expect(itemGrantCandidates(items, [{ key: "item.buki.system.attack.value" }]).map(i => i.id)).toEqual(["w1"]);
  });

  it("書き換え: アイテム狙いの変更だけを素のキーへ正規化（アクター向けは落とす）", () => {
    const changes = [
      { key: "system.category.melee.attack", mode: 2, value: "5" },
      { key: "item.buki.system.attack.damageType", mode: 5, value: "S" },
      { key: "system.attack.value", mode: 2, value: "1" },
      { key: "check.melee", mode: 2, value: "1" }, // 混在非対応=落ちる
    ];
    expect(rewriteGrantChangesForItem(changes).map(c => c.key)).toEqual([
      "system.attack", "system.attack.damageType", "system.attack.value",
    ]);
  });
});

describe("evalEffectConditions()（条件評価）", () => {
  const sys = { hack: { mode: "value", value: 2, total: 4 }, guardValue: { value: 1, total: 1 }, levelTotal: 3 };

  it("条件なしは true", () => {
    expect(evalEffectConditions(sys, [])).toBe(true);
  });

  it("total を優先して比較する", () => {
    expect(evalEffectConditions(sys, parseEffectConditions("hack>=3"))).toBe(true);  // hack.total=4
    expect(evalEffectConditions(sys, parseEffectConditions("hack>=5"))).toBe(false);
  });

  it("素の Total 値(levelTotal)も解決する", () => {
    expect(evalEffectConditions(sys, parseEffectConditions("level==3"))).toBe(true);
  });

  it("全条件 AND", () => {
    expect(evalEffectConditions(sys, parseEffectConditions("hack>=3;guardValue>0"))).toBe(true);
    expect(evalEffectConditions(sys, parseEffectConditions("hack>=3;guardValue>5"))).toBe(false);
  });
});

// KI-049（2026-09-02）: 供給元1つ×アイテム1つに対して転送コピーは1つだけ、が不変条件。
// 同時多発のフックで多重に作られた過去のデータも、次の同期で1つへ畳めるようにする。
describe("planTransferCopySync()（供給元×アイテムごとの転送コピーの合わせ方・KI-049）", () => {
  it("狙っていてコピーが無ければ作る", () => {
    expect(planTransferCopySync([], true)).toEqual({ update: null, create: true, delete: [] });
  });

  it("狙っていてコピーが1つあれば上書きする（供給元が正）", () => {
    expect(planTransferCopySync([{ id: "c1" }], true)).toEqual({ update: "c1", create: false, delete: [] });
  });

  it("多重にできたコピーは1つを残して残りを除去する", () => {
    expect(planTransferCopySync([{ id: "c1" }, { id: "c2" }, { id: "c3" }], true))
      .toEqual({ update: "c1", create: false, delete: ["c2", "c3"] });
  });

  it("狙わなくなったらコピーを全部除去する", () => {
    expect(planTransferCopySync([{ id: "c1" }, { id: "c2" }], false))
      .toEqual({ update: null, create: false, delete: ["c1", "c2"] });
  });

  it("狙っておらずコピーも無ければ何もしない", () => {
    expect(planTransferCopySync([], false)).toEqual({ update: null, create: false, delete: [] });
  });
});
