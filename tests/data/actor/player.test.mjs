import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockObjectField } from "../../setup.mjs";

const { PlayerDataModel } = await import("../../../scripts/data/actor/player.mjs");

describe("PlayerDataModel.defineSchema()", () => {
  const schema = PlayerDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("ActorBaseTemplate のフィールドが含まれる", () => {
    const actorBaseKeys = ["handMaxSize", "handPileId", "trumpCardPileId"];
    for (const key of actorBaseKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("biography / attributes template のフィールドは含まれない", () => {
    const excludedKeys = [
      "handle", "charaname_ruby", "citizenRank",
      "reason", "passion", "physicalDamage",
    ];
    for (const key of excludedKeys) {
      it(`schema.${key} が存在しない`, () => {
        expect(schema).not.toHaveProperty(key);
      });
    }
  });

  describe("player 固有フィールド — history", () => {
    it("history が ObjectField である", () => {
      expect(schema.history).toBeInstanceOf(MockObjectField);
    });
  });

  describe("player 固有フィールド — exp (SchemaField)", () => {
    it("exp が SchemaField である", () => {
      expect(schema.exp).toBeInstanceOf(MockSchemaField);
    });

    it("exp.value が NumberField で initial が 0", () => {
      expect(schema.exp.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.value.options.initial).toBe(0);
    });

    it("exp.total が NumberField で initial が 0", () => {
      expect(schema.exp.fields.total).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.total.options.initial).toBe(0);
    });

    it("exp.spent が NumberField で initial が 0", () => {
      expect(schema.exp.fields.spent).toBeInstanceOf(MockNumberField);
      expect(schema.exp.fields.spent.options.initial).toBe(0);
    });

    it("exp に additional フィールドが存在しない(cast との差異)", () => {
      expect(schema.exp.fields).not.toHaveProperty("additional");
    });
  });

  describe("cast 固有フィールドは含まれない", () => {
    it("player_name が存在しない", () => {
      expect(schema).not.toHaveProperty("player_name");
    });

    it("playerId が存在しない", () => {
      expect(schema).not.toHaveProperty("playerId");
    });

    it("lifePath が存在しない", () => {
      expect(schema).not.toHaveProperty("lifePath");
    });
  });
});
