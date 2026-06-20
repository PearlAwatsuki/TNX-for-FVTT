import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { defenceField, attackField, migrateAttackModToEffectMod } = await import("../../../scripts/data/item/helpers.mjs");

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

  it("呼び出すたびに別インスタンスを返す", () => {
    expect(defenceField()).not.toBe(defenceField());
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
