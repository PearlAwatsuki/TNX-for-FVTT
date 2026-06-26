import { describe, it, expect } from "vitest";
import { MockBooleanField, MockStringField, MockNumberField, MockSchemaField, MockObjectField } from "../../setup.mjs";
import { ATTACK_DAMAGE_TYPES } from "../../../scripts/data/item/helpers.mjs";

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

  describe("ActorBaseTemplate（カード管理フィールドは User flag へ一本化済み）", () => {
    const actorBaseKeys = ["handPileId", "trumpCardPileId"];
    for (const key of actorBaseKeys) {
      it(`schema.${key} を持たない`, () => {
        expect(schema).not.toHaveProperty(key);
      });
    }

    it("handMaxSize フィールドを持たない(手札上限は User flag の権威)", () => {
      expect(schema).not.toHaveProperty("handMaxSize");
    });
  });

  describe("cast 固有フィールド — 基本", () => {
    it("player_name フィールドを持たない(フェーズ6-0 で削除)", () => {
      expect(schema).not.toHaveProperty("player_name");
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

  describe("cast 固有フィールド — baseAttack (生身の攻撃力)", () => {
    it("baseAttack は SchemaField で damageType・value・mod を持つ", () => {
      expect(schema.baseAttack).toBeInstanceOf(MockSchemaField);
      expect(schema.baseAttack.fields.damageType).toBeInstanceOf(MockStringField);
      expect(schema.baseAttack.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.baseAttack.fields.mod).toBeInstanceOf(MockNumberField);
    });

    it("damageType の initial は 'I'（生身の打撃は衝撃ダメージ）", () => {
      expect(schema.baseAttack.fields.damageType.options.initial).toBe("I");
    });

    it("damageType の choices は ATTACK_DAMAGE_TYPES", () => {
      expect(schema.baseAttack.fields.damageType.options.choices).toBe(ATTACK_DAMAGE_TYPES);
    });

    it("value / mod の initial は 0", () => {
      expect(schema.baseAttack.fields.value.options.initial).toBe(0);
      expect(schema.baseAttack.fields.mod.options.initial).toBe(0);
    });
  });

  describe("cast 固有フィールド — baseDefence (生身の防御値)", () => {
    it("baseDefence は SchemaField で S_defence・P_defence・I_defence を持つ", () => {
      expect(schema.baseDefence).toBeInstanceOf(MockSchemaField);
      for (const key of ["S_defence", "P_defence", "I_defence"]) {
        expect(schema.baseDefence.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.baseDefence.fields[key].options.initial).toBe(0);
      }
    });
  });

  describe("cast 固有フィールド — baseGuard (生身の受け値)", () => {
    it("baseGuard は SchemaField で value・mod を持ち initial 0", () => {
      expect(schema.baseGuard).toBeInstanceOf(MockSchemaField);
      expect(schema.baseGuard.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.baseGuard.fields.value.options.initial).toBe(0);
      expect(schema.baseGuard.fields.mod).toBeInstanceOf(MockNumberField);
      expect(schema.baseGuard.fields.mod.options.initial).toBe(0);
    });
  });

  describe("cast 固有フィールド — isGhost (ゴースト登場フラグ)", () => {
    it("isGhost が BooleanField で initial が false", () => {
      expect(schema.isGhost).toBeInstanceOf(MockBooleanField);
      expect(schema.isGhost.options.initial).toBe(false);
    });
  });

  describe("cast 固有フィールド — bounty / bountyBase (報酬点)", () => {
    it("bounty が NumberField で initial が 0、integer が true", () => {
      expect(schema.bounty).toBeInstanceOf(MockNumberField);
      expect(schema.bounty.options.initial).toBe(0);
      expect(schema.bounty.options.integer).toBe(true);
    });

    it("bountyBase が NumberField で initial が 0、integer が true", () => {
      expect(schema.bountyBase).toBeInstanceOf(MockNumberField);
      expect(schema.bountyBase.options.initial).toBe(0);
      expect(schema.bountyBase.options.integer).toBe(true);
    });
  });

  describe("cast 固有フィールド — appearanceModifier (登場判定修正)", () => {
    it("appearanceModifier が NumberField で initial が 0、integer が true", () => {
      expect(schema.appearanceModifier).toBeInstanceOf(MockNumberField);
      expect(schema.appearanceModifier.options.initial).toBe(0);
      expect(schema.appearanceModifier.options.integer).toBe(true);
    });
  });

  describe("cast 固有フィールド — outfitMod (アウトフィット修正集計)", () => {
    it("outfitMod が SchemaField である", () => {
      expect(schema.outfitMod).toBeInstanceOf(MockSchemaField);
    });

    for (const key of ["control", "reason", "passion", "life", "mundane", "combatSpeed"]) {
      it(`outfitMod.${key} が NumberField で initial が 0、integer が true`, () => {
        expect(schema.outfitMod.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.outfitMod.fields[key].options.initial).toBe(0);
        expect(schema.outfitMod.fields[key].options.integer).toBe(true);
      });
    }
  });

  describe("cast 固有フィールド — lifePath (SchemaField)", () => {
    it("lifePath が SchemaField である", () => {
      expect(schema.lifePath).toBeInstanceOf(MockSchemaField);
    });

    for (const slot of ["origin", "experience", "encounter"]) {
      it(`lifePath.${slot} が SchemaField で itemUuid / name を持つ`, () => {
        const slotField = schema.lifePath.fields[slot];
        expect(slotField).toBeInstanceOf(MockSchemaField);
        for (const sub of ["itemUuid", "name"]) {
          expect(slotField.fields[sub]).toBeInstanceOf(MockStringField);
          expect(slotField.fields[sub].options.initial).toBe("");
        }
      });

      it(`lifePath.${slot} は summary フィールドを持たない(live fromUuid 解決に移行)`, () => {
        const slotField = schema.lifePath.fields[slot];
        expect(slotField.fields).not.toHaveProperty("summary");
      });
    }
  });
});
