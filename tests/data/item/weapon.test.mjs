import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockNumberField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { WeaponDataModel } = await import("../../../scripts/data/item/weapon.mjs");

describe("WeaponDataModel.defineSchema()", () => {
  const schema = WeaponDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が BooleanField で存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it("schema.slot が ArrayField で存在する(ExtensibleTemplate)", () => {
      expect(schema.slot).toBeInstanceOf(MockArrayField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema.uses.fields).toHaveProperty("isLimit");
    });
  });

  describe("ExtensibleTemplate のフィールドが含まれる", () => {
    it("schema.slot が ArrayField で存在する", () => {
      expect(schema.slot).toBeInstanceOf(MockArrayField);
    });
  });

  describe("attack フィールドの構造が正しい(attackField() 共用)", () => {
    it("schema.attack が SchemaField で存在する", () => {
      expect(schema.attack).toBeInstanceOf(MockSchemaField);
    });

    it("attack.damageType は ArrayField(StringField) である", () => {
      expect(schema.attack.fields.damageType).toBeInstanceOf(MockArrayField);
      expect(schema.attack.fields.damageType.element).toBeInstanceOf(MockStringField);
    });

    it("attack.value は NumberField で initial が 0", () => {
      expect(schema.attack.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.value.options.initial).toBe(0);
    });

    it("attack.mod は NumberField で initial が 0", () => {
      expect(schema.attack.fields.mod).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.mod.options.initial).toBe(0);
    });
  });

  it("schema.guardValue は NumberField で initial が 0", () => {
    expect(schema.guardValue).toBeInstanceOf(MockNumberField);
    expect(schema.guardValue.options.initial).toBe(0);
  });

  it("schema.range は StringField で initial が '-'", () => {
    expect(schema.range).toBeInstanceOf(MockStringField);
    expect(schema.range.options.initial).toBe("-");
  });

  describe("Boolean フィールドが BooleanField で initial false である", () => {
    for (const key of ["isthrow", "isLaser", "isBiological", "isFullAuto"]) {
      it(`schema.${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }
  });

  it("schema.FAValue は NumberField で initial が 0", () => {
    expect(schema.FAValue).toBeInstanceOf(MockNumberField);
    expect(schema.FAValue.options.initial).toBe(0);
  });

  it("defence フィールドは含まれない(cyborg 固有)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});

describe("WeaponDataModel identificationKey (フェーズ6-0)", () => {
  const schema = WeaponDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("WeaponDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = WeaponDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});
