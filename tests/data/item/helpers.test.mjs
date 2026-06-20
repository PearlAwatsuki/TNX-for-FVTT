import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { defenceField, attackField, modeValueField, migrateAttackModToEffectMod, computeItemEffectiveValues } = await import("../../../scripts/data/item/helpers.mjs");

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

describe("computeItemEffectiveValues()", () => {
  it("modeValue(mode=value)は value+effectMod を total に出す", () => {
    const sys = { guardValue: { mode: "value", value: 3, effectMod: 2 } };
    computeItemEffectiveValues(sys);
    expect(sys.guardValue.total).toBe(5);
  });

  it("modeValue(mode≠value)は effectMod を無視し total=value", () => {
    const sys = { hide: { mode: "control", value: 7, effectMod: 5 } };
    computeItemEffectiveValues(sys);
    expect(sys.hide.total).toBe(7);
  });

  it("attack(mode なし)は value+effectMod", () => {
    const sys = { attack: { damageType: "I", value: 4, effectMod: 2 } };
    computeItemEffectiveValues(sys);
    expect(sys.attack.total).toBe(6);
  });

  it("defence は S/P/I それぞれ total を出す(mode=value)", () => {
    const sys = { defence: {
      mode: "value",
      S_defence: 1, P_defence: 2, I_defence: 3,
      S_effectMod: 10, P_effectMod: 20, I_effectMod: 30,
    } };
    computeItemEffectiveValues(sys);
    expect(sys.defence.S_total).toBe(11);
    expect(sys.defence.P_total).toBe(22);
    expect(sys.defence.I_total).toBe(33);
  });

  it("defence(mode≠value)は effectMod を無視する", () => {
    const sys = { defence: {
      mode: "none",
      S_defence: 1, P_defence: 2, I_defence: 3,
      S_effectMod: 10, P_effectMod: 20, I_effectMod: 30,
    } };
    computeItemEffectiveValues(sys);
    expect(sys.defence.S_total).toBe(1);
  });

  it("slots[].count の total を出す", () => {
    const sys = { slots: [
      { kind: "normal", count: { mode: "value", value: 2, effectMod: 1 } },
      { kind: "normal", count: { mode: "none",  value: 0, effectMod: 5 } },
    ] };
    computeItemEffectiveValues(sys);
    expect(sys.slots[0].count.total).toBe(3);
    expect(sys.slots[1].count.total).toBe(0);
  });

  it("負の修正(controlMod 等)も clamp せずそのまま反映する", () => {
    const sys = { controlMod: { mode: "value", value: 1, effectMod: -5 } };
    computeItemEffectiveValues(sys);
    expect(sys.controlMod.total).toBe(-4);
  });

  it("素の値(FAValue / residence)の Total を出す", () => {
    const sys = {
      FAValue: 2, FAValueEffectMod: 3,
      appearanceTarget: 10, appearanceTargetEffectMod: 1,
      cyberSecurity: 5, cyberSecurityEffectMod: 0,
      analogSecurity: 4, analogSecurityEffectMod: 2,
    };
    computeItemEffectiveValues(sys);
    expect(sys.FAValueTotal).toBe(5);
    expect(sys.appearanceTargetTotal).toBe(11);
    expect(sys.cyberSecurityTotal).toBe(5);
    expect(sys.analogSecurityTotal).toBe(6);
  });

  it("base 値(value)は書き換えない", () => {
    const sys = { guardValue: { mode: "value", value: 3, effectMod: 2 } };
    computeItemEffectiveValues(sys);
    expect(sys.guardValue.value).toBe(3);
  });
});
