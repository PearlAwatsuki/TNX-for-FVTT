import { describe, it, expect } from "vitest";
import { MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { CyborgDataModel } = await import("../../../scripts/data/item/cyborg.mjs");

describe("CyborgDataModel.defineSchema()", () => {
  const schema = CyborgDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });
  });

  describe("defence フィールドの構造が正しい", () => {
    it("schema.defence が SchemaField で存在する", () => {
      expect(schema.defence).toBeInstanceOf(MockSchemaField);
    });

    it("defence に mode / S_defence / P_defence / I_defence が存在する", () => {
      expect(schema.defence.fields).toHaveProperty("mode");
      expect(schema.defence.fields).toHaveProperty("S_defence");
      expect(schema.defence.fields).toHaveProperty("P_defence");
      expect(schema.defence.fields).toHaveProperty("I_defence");
    });

    it("defence.mode は StringField で initial が none、choices は none/value", () => {
      expect(schema.defence.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.defence.fields.mode.options.initial).toBe("none");
      expect(schema.defence.fields.mode.options.choices).toEqual(["none", "value"]);
    });

    it("defence の各フィールドは NumberField で initial が 0", () => {
      for (const key of ["S_defence", "P_defence", "I_defence"]) {
        expect(schema.defence.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.defence.fields[key].options.initial).toBe(0);
      }
    });
  });

  describe("attack フィールドの構造が正しい", () => {
    it("schema.attack が SchemaField で存在する", () => {
      expect(schema.attack).toBeInstanceOf(MockSchemaField);
    });

    it("attack.damageType は choices 付き StringField (単一選択)", () => {
      expect(schema.attack.fields.damageType).toBeInstanceOf(MockStringField);
      expect(Object.keys(schema.attack.fields.damageType.options.choices)).toEqual(["S", "P", "I", "X"]);
    });

    it("attack.value は NumberField で initial が 0", () => {
      expect(schema.attack.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.value.options.initial).toBe(0);
    });

    it("attack.effectMod は持たない(v2: バフは total へ直接適用)", () => {
      expect(schema.attack.fields.effectMod).toBeUndefined();
    });

    it("attack.mod (旧フィールド) は存在しない", () => {
      expect(schema.attack.fields.mod).toBeUndefined();
    });
  });

  it("schema.guardValue は {mode,value} の SchemaField で mode の choices は none/value のみ", () => {
    expect(schema.guardValue).toBeInstanceOf(MockSchemaField);
    expect(schema.guardValue.fields.mode).toBeInstanceOf(MockStringField);
    expect(schema.guardValue.fields.mode.options.initial).toBe("none");
    expect(schema.guardValue.fields.mode.options.choices).toEqual(["none", "value"]);
    expect(schema.guardValue.fields.value).toBeInstanceOf(MockNumberField);
    expect(schema.guardValue.fields.value.options.initial).toBe(0);
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slots");
  });
});

describe("CyborgDataModel identificationKey (フェーズ6-0)", () => {
  const schema = CyborgDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("CyborgDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = CyborgDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
