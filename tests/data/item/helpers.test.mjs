import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { defenceField, attackField, modeValueField, migrateAttackModToEffectMod, computeItemEffectiveValues, matchesAeTarget, addToItemEffectMod, parseCrossTargetKey, parseEffectTargetKey, parseEffectConditions, evalEffectConditions, resolveItemTotalPath } = await import("../../../scripts/data/item/helpers.mjs");

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

  it("S/P/I それぞれの effectMod (AE 着地点) を NumberField で持つ", () => {
    const field = defenceField();
    for (const key of ["S_effectMod", "P_effectMod", "I_effectMod"]) {
      expect(field.fields[key]).toBeInstanceOf(MockNumberField);
      expect(field.fields[key].options.initial).toBe(0);
    }
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(defenceField()).not.toBe(defenceField());
  });
});

describe("modeValueField()", () => {
  it("mode / value / effectMod を持つ SchemaField を返す", () => {
    const field = modeValueField(["none", "value"]);
    expect(field).toBeInstanceOf(MockSchemaField);
    expect(field.fields).toHaveProperty("mode");
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).toHaveProperty("effectMod");
  });

  it("effectMod (AE 着地点) は NumberField で initial が 0", () => {
    const field = modeValueField(["none", "value"]);
    expect(field.fields.effectMod).toBeInstanceOf(MockNumberField);
    expect(field.fields.effectMod.options.initial).toBe(0);
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

  it("damageType / value / effectMod の 3 フィールドを持つ", () => {
    const field = attackField();
    expect(field.fields).toHaveProperty("damageType");
    expect(field.fields).toHaveProperty("value");
    expect(field.fields).toHaveProperty("effectMod");
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

  it("effectMod (AE 着地点) は NumberField で initial が 0", () => {
    const field = attackField();
    expect(field.fields.effectMod).toBeInstanceOf(MockNumberField);
    expect(field.fields.effectMod.options.initial).toBe(0);
  });

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(attackField()).not.toBe(attackField());
  });
});

describe("migrateAttackModToEffectMod()", () => {
  it("旧 attack.mod を attack.effectMod へ移し mod を削除する", () => {
    const source = { attack: { damageType: "I", value: 4, mod: 2 } };
    migrateAttackModToEffectMod(source);
    expect(source.attack.effectMod).toBe(2);
    expect(source.attack).not.toHaveProperty("mod");
  });

  it("既に effectMod がある場合は上書きしない", () => {
    const source = { attack: { value: 4, mod: 2, effectMod: 9 } };
    migrateAttackModToEffectMod(source);
    expect(source.attack.effectMod).toBe(9);
  });

  it("attack が無い / mod が無い場合は何もしない", () => {
    const a = {};
    expect(() => migrateAttackModToEffectMod(a)).not.toThrow();
    const b = { attack: { value: 4 } };
    migrateAttackModToEffectMod(b);
    expect(b.attack.effectMod).toBeUndefined();
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

describe("resolveItemTotalPath()", () => {
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
});

describe("matchesAeTarget()（モードB 照合）", () => {
  const weapon = { type: "weapon", system: { majorCategory: "武器", minorCategory: "白兵武器", identificationKey: "katana" } };

  it("byItemType で一致する", () => {
    expect(matchesAeTarget(weapon, { byItemType: ["weapon"], param: "attack", value: 1 })).toBe(true);
    expect(matchesAeTarget(weapon, { byItemType: ["armor"], param: "attack", value: 1 })).toBe(false);
  });

  it("byMinorCategory(白兵武器)で一致する", () => {
    expect(matchesAeTarget(weapon, { byMinorCategory: ["白兵武器"] })).toBe(true);
    expect(matchesAeTarget(weapon, { byMinorCategory: ["射撃武器"] })).toBe(false);
  });

  it("byIdentificationKey で名指し一致する", () => {
    expect(matchesAeTarget(weapon, { byIdentificationKey: ["katana", "tanto"] })).toBe(true);
    expect(matchesAeTarget(weapon, { byIdentificationKey: ["tanto"] })).toBe(false);
  });

  it("複数次元は AND で評価する", () => {
    expect(matchesAeTarget(weapon, { byItemType: ["weapon"], byMinorCategory: ["白兵武器"] })).toBe(true);
    expect(matchesAeTarget(weapon, { byItemType: ["weapon"], byMinorCategory: ["射撃武器"] })).toBe(false);
  });

  it("フィルタ未指定は false(無条件全件マッチを防ぐ)", () => {
    expect(matchesAeTarget(weapon, { param: "attack", value: 1 })).toBe(false);
    expect(matchesAeTarget(weapon, { byItemType: [] })).toBe(false);
  });
});

describe("addToItemEffectMod()（モードB 注入）", () => {
  it("modeValue/attack の effectMod に加算する", () => {
    const sys = { attack: { value: 4, effectMod: 0 }, guardValue: { mode: "value", value: 1, effectMod: 0 } };
    addToItemEffectMod(sys, "attack", 2);
    addToItemEffectMod(sys, "guardValue", 3);
    expect(sys.attack.effectMod).toBe(2);
    expect(sys.guardValue.effectMod).toBe(3);
  });

  it("defence.S/P/I の effectMod に加算する", () => {
    const sys = { defence: { S_effectMod: 1, P_effectMod: 2, I_effectMod: 3 } };
    addToItemEffectMod(sys, "defence.P", 10);
    expect(sys.defence.P_effectMod).toBe(12);
    expect(sys.defence.S_effectMod).toBe(1);
  });

  it("素の値(level/FAValue)の EffectMod に加算する", () => {
    const sys = { levelEffectMod: 2, FAValueEffectMod: 1 };
    addToItemEffectMod(sys, "level", 1);
    addToItemEffectMod(sys, "FAValue", 4);
    expect(sys.levelEffectMod).toBe(3);
    expect(sys.FAValueEffectMod).toBe(5);
  });

  it("対象 effectMod が無い場合は何もしない", () => {
    const sys = { foo: { value: 1 } };
    expect(() => addToItemEffectMod(sys, "foo", 5)).not.toThrow();
    expect(sys.foo.value).toBe(1);
  });
});

describe("parseCrossTargetKey()（モードB キー解析）", () => {
  it("<識別キー>.<パス> を分解する", () => {
    expect(parseCrossTargetKey("hisho-geki.attack.effectMod"))
      .toEqual({ identKey: "hisho-geki", path: "attack.effectMod" });
    expect(parseCrossTargetKey("katana.defence.S_effectMod"))
      .toEqual({ identKey: "katana", path: "defence.S_effectMod" });
  });

  it("system. / flags. で始まる通常キーは null", () => {
    expect(parseCrossTargetKey("system.attack.effectMod")).toBeNull();
    expect(parseCrossTargetKey("flags.x.y")).toBeNull();
  });

  it("ドット無し・空・非文字列は null", () => {
    expect(parseCrossTargetKey("hisho")).toBeNull();
    expect(parseCrossTargetKey("")).toBeNull();
    expect(parseCrossTargetKey(undefined)).toBeNull();
  });
});

describe("parseEffectTargetKey()（v2 system.<名前空間> 文法）", () => {
  it("値: ability / control", () => {
    expect(parseEffectTargetKey("system.ability.reason")).toMatchObject({ scope: "ability", path: "reason", conditions: [] });
    expect(parseEffectTargetKey("system.control.reason")).toMatchObject({ scope: "control", path: "reason" });
  });

  it("値: self / parent", () => {
    expect(parseEffectTargetKey("system.self.attack")).toMatchObject({ scope: "self", path: "attack" });
    expect(parseEffectTargetKey("system.parent.attack")).toMatchObject({ scope: "parent", path: "attack" });
  });

  it("値: category(小分類・大分類とも)", () => {
    expect(parseEffectTargetKey("system.category.melee.attack")).toMatchObject({ scope: "category", selector: "melee", path: "attack" });
    expect(parseEffectTargetKey("system.category.weapon.attack")).toMatchObject({ scope: "category", selector: "weapon", path: "attack" });
  });

  it("値: skill レベル(完全一致・プレフィックス)", () => {
    expect(parseEffectTargetKey("system.skill.melee.level")).toMatchObject({ scope: "skill", selector: "melee", prefix: false, path: "level" });
    expect(parseEffectTargetKey("system.skill.society_*.level")).toMatchObject({ scope: "skill", selector: "society_", prefix: true, path: "level" });
  });

  it("パスにドットを含む(defence.S)", () => {
    expect(parseEffectTargetKey("system.category.armor.defence.S")).toMatchObject({ scope: "category", selector: "armor", path: "defence.S" });
  });

  it("判定: check.<能力値> / controlCheck.<能力値> / check.<技能>", () => {
    expect(parseEffectTargetKey("check.reason")).toMatchObject({ scope: "abilityCheck", ability: "reason" });
    expect(parseEffectTargetKey("controlCheck.reason")).toMatchObject({ scope: "controlCheck", ability: "reason" });
    expect(parseEffectTargetKey("check.melee")).toMatchObject({ scope: "skillCheck", selector: "melee", prefix: false });
    expect(parseEffectTargetKey("check.society_*")).toMatchObject({ scope: "skillCheck", selector: "society_", prefix: true });
  });

  it("条件付き [hack>=3] / 複数 ;", () => {
    expect(parseEffectTargetKey("system.category.melee[hack>=3].attack").conditions)
      .toEqual([{ path: "hack", op: ">=", value: 3 }]);
    expect(parseEffectTargetKey("system.category.melee[hack>=3;guardValue>0].attack").conditions)
      .toEqual([{ path: "hack", op: ">=", value: 3 }, { path: "guardValue", op: ">", value: 0 }]);
  });

  it("不正・未知名前空間・ネイティブキーは null", () => {
    expect(parseEffectTargetKey("")).toBeNull();
    expect(parseEffectTargetKey("noDotKey")).toBeNull();
    expect(parseEffectTargetKey("system.handMaxSizeMod")).toBeNull();   // ネイティブ
    expect(parseEffectTargetKey("system.unknown.x")).toBeNull();
    expect(parseEffectTargetKey(undefined)).toBeNull();
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
