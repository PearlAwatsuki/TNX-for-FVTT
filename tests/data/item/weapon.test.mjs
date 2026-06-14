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

    it("schema.isCheckAcquired が BooleanField で initial が false", () => {
      expect(schema.isCheckAcquired).toBeInstanceOf(MockBooleanField);
      expect(schema.isCheckAcquired.options.initial).toBe(false);
    });

    it("schema.slots が ArrayField で存在する(ExtensibleTemplate)", () => {
      expect(schema.slots).toBeInstanceOf(MockArrayField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
      expect(schema.uses.fields).toHaveProperty("isLimit");
    });
  });

  describe("ExtensibleTemplate のフィールドが含まれる", () => {
    it("schema.slots が ArrayField で存在する", () => {
      expect(schema.slots).toBeInstanceOf(MockArrayField);
    });
  });

  describe("attack フィールドの構造が正しい(attackField() 共用)", () => {
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

    it("attack.mod は NumberField で initial が 0", () => {
      expect(schema.attack.fields.mod).toBeInstanceOf(MockNumberField);
      expect(schema.attack.fields.mod.options.initial).toBe(0);
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

  describe("range (射程) の構造が正しい", () => {
    it("range は {min, max} の SchemaField である", () => {
      expect(schema.range).toBeInstanceOf(MockSchemaField);
      expect(schema.range.fields).toHaveProperty("min");
      expect(schema.range.fields).toHaveProperty("max");
    });

    it("min は choices 付き StringField で initial が none、選択肢は none+5 種(6 種)", () => {
      const f = schema.range.fields.min;
      expect(f).toBeInstanceOf(MockStringField);
      expect(f.options.initial).toBe("none");
      expect(Object.keys(f.options.choices)).toEqual(["none", "close", "short", "middle", "long", "superLong"]);
    });

    it("max は choices 付き StringField で initial が none、選択肢は none+4 種(至近除く 5 種)", () => {
      const f = schema.range.fields.max;
      expect(f).toBeInstanceOf(MockStringField);
      expect(f.options.initial).toBe("none");
      expect(Object.keys(f.options.choices)).toEqual(["none", "short", "middle", "long", "superLong"]);
    });
  });

  describe("Boolean フィールドが BooleanField で initial false である", () => {
    for (const key of ["isLaser", "isFullAuto"]) {
      it(`schema.${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }

    it("isthrow は持たない(フェーズ6-2 で isConsumption に一般化して削除)", () => {
      expect(schema).not.toHaveProperty("isthrow");
    });

    it("isConsumption / quantity を持つ(outfitBase 由来)", () => {
      expect(schema.isConsumption).toBeInstanceOf(MockBooleanField);
      expect(schema.quantity).toBeInstanceOf(MockSchemaField);
    });
  });

  it("schema.FAValue は NumberField で initial が 0", () => {
    expect(schema.FAValue).toBeInstanceOf(MockNumberField);
    expect(schema.FAValue.options.initial).toBe(0);
  });

  it("attackArea (攻撃範囲) は choices 付き StringField で initial が none", () => {
    expect(schema.attackArea).toBeInstanceOf(MockStringField);
    expect(schema.attackArea.options.initial).toBe("none");
    expect(Object.keys(schema.attackArea.options.choices)).toEqual(
      ["none", "area", "areaSelect", "scene", "sceneSelect"]
    );
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
