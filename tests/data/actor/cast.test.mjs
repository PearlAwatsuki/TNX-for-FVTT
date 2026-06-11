import { describe, it, expect } from "vitest";
import { MockStringField, MockNumberField, MockSchemaField, MockObjectField } from "../../setup.mjs";

const { CastDataModel } = await import("../../../scripts/data/actor/cast.mjs");

describe("CastDataModel.defineSchema()", () => {
  const schema = CastDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BiographyTemplate のフィールドが含まれる", () => {
    const biographyKeys = [
      "charaname_ruby", "handle", "handle_ruby", "post",
      "citizenRank", "age", "gender", "birthday",
      "height", "weight", "eyes", "hair", "skin", "description",
    ];
    for (const key of biographyKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("AttributesTemplate のフィールドが含まれる", () => {
    const attributeKeys = [
      "reason", "passion", "life", "mundane",
      "combatSpeed", "physicalDamage", "mentalDamage", "socialDamage",
    ];
    for (const key of attributeKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("ActorBaseTemplate のフィールドが含まれる", () => {
    const actorBaseKeys = ["handPileId", "trumpCardPileId"];
    for (const key of actorBaseKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }

    it("handMaxSize フィールドを持たない(手札上限は User flag の権威)", () => {
      expect(schema).not.toHaveProperty("handMaxSize");
    });
  });

  describe("cast 固有フィールド — 基本", () => {
    it("player_name が StringField で initial が空文字", () => {
      expect(schema.player_name).toBeInstanceOf(MockStringField);
      expect(schema.player_name.options.initial).toBe("");
    });

    it("playerId フィールドを持たない(フェーズ2-5 で廃止)", () => {
      expect(schema).not.toHaveProperty("playerId");
    });

    it("history が ObjectField である", () => {
      expect(schema.history).toBeInstanceOf(MockObjectField);
    });
  });

  describe("cast 固有フィールド — exp (SchemaField)", () => {
    it("exp が SchemaField である", () => {
      expect(schema.exp).toBeInstanceOf(MockSchemaField);
    });

    it("exp.value が NumberField で initial が 170", () => {
      expect(schema.exp.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.value.options.initial).toBe(170);
    });

    it("exp.spent が NumberField で initial が -170", () => {
      expect(schema.exp.fields.spent).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.spent.options.initial).toBe(-170);
    });

    it("exp.total が NumberField で initial が 0", () => {
      expect(schema.exp.fields.total).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.total.options.initial).toBe(0);
    });

    it("exp.additional が NumberField で initial が 0", () => {
      expect(schema.exp.fields.additional).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.additional.options.initial).toBe(0);
    });
  });

  describe("cast 固有フィールド — lifePath (SchemaField)", () => {
    it("lifePath が SchemaField である", () => {
      expect(schema.lifePath).toBeInstanceOf(MockSchemaField);
    });

    for (const slot of ["origin", "experience", "encounter"]) {
      it(`lifePath.${slot} が SchemaField で itemUuid / name / summary を持つ`, () => {
        const slotField = schema.lifePath.fields[slot];
        expect(slotField).toBeInstanceOf(MockSchemaField);
        for (const sub of ["itemUuid", "name", "summary"]) {
          expect(slotField.fields[sub]).toBeInstanceOf(MockStringField);
          expect(slotField.fields[sub].options.initial).toBe("");
        }
      });
    }
  });
});
