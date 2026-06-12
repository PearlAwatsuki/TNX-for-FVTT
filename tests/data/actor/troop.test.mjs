import { describe, it, expect } from "vitest";
import { MockStringField, MockNumberField, MockSchemaField } from "../../setup.mjs";

const { TroopDataModel } = await import("../../../scripts/data/actor/troop.mjs");

describe("TroopDataModel.defineSchema()", () => {
  const schema = TroopDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
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

  describe("troop 固有フィールド", () => {
    it("schema.memo が存在する", () => {
      expect(schema).toHaveProperty("memo");
    });

    it("memo は StringField で initial が空文字", () => {
      expect(schema.memo).toBeInstanceOf(MockStringField);
      expect(schema.memo.options.initial).toBe("");
    });

    it("heads は SchemaField で value / max を持つ(リソースバー用構造)", () => {
      expect(schema.heads).toBeInstanceOf(MockSchemaField);
      expect(schema.heads.fields).toHaveProperty("value");
      expect(schema.heads.fields).toHaveProperty("max");
    });

    it("heads.value / heads.max は NumberField で initial が 1・min 0・整数", () => {
      for (const key of ["value", "max"]) {
        expect(schema.heads.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.heads.fields[key].options.initial).toBe(1);
        expect(schema.heads.fields[key].options.min).toBe(0);
        expect(schema.heads.fields[key].options.integer).toBe(true);
      }
    });
  });

  describe("biography template のフィールドは含まれない", () => {
    const biographyKeys = ["handle", "charaname_ruby", "citizenRank"];
    for (const key of biographyKeys) {
      it(`schema.${key} が存在しない`, () => {
        expect(schema).not.toHaveProperty(key);
      });
    }
  });
});
