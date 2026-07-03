import { describe, it, expect } from "vitest";
import { MockNumberField, MockSchemaField, MockBooleanField } from "../../setup.mjs";

const { TroopDataModel } = await import("../../../scripts/data/actor/troop.mjs");
const { GuestDataModel } = await import("../../../scripts/data/actor/guest.mjs");

describe("TroopDataModel.defineSchema()", () => {
  const schema = TroopDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("AttributesTemplate のフィールドが含まれる", () => {
    const attributeKeys = [
      "reason", "passion", "life", "mundane",
      "combatSpeed", "actionRank",
      "physicalDamage", "mentalDamage", "socialDamage",
    ];
    for (const key of attributeKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("BiographyTemplate のフィールドが含まれる（フェーズ11-4 で追加・ユーザー意向）", () => {
    const biographyKeys = ["handle", "charaname_ruby", "citizenRank", "description"];
    for (const key of biographyKeys) {
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

  describe("troop 固有フィールド", () => {
    it("memo を持たない（フェーズ11-4 で biography.description へ統合・廃止）", () => {
      expect(schema).not.toHaveProperty("memo");
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

    it("isEnigmaMode は BooleanField で initial false（エニグマモード=人数の代わりにエニグマポイント）", () => {
      expect(schema.isEnigmaMode).toBeInstanceOf(MockBooleanField);
      expect(schema.isEnigmaMode.options.initial).toBe(false);
    });
  });

  it("guest（共通基底そのまま）との差分は heads / isEnigmaMode の2フィールドに限られる", () => {
    const guestKeys = new Set(Object.keys(GuestDataModel.defineSchema()));
    const troopKeys = new Set(Object.keys(schema));
    const troopOnly = [...troopKeys].filter(k => !guestKeys.has(k)).sort();
    const guestOnly = [...guestKeys].filter(k => !troopKeys.has(k));
    expect(troopOnly).toEqual(["heads", "isEnigmaMode"]);
    expect(guestOnly).toEqual([]);
  });
});

describe("TroopDataModel.migrateData()（memo → biography.description 移行）", () => {
  it("description が空なら memo を写して memo を除去する", () => {
    const source = TroopDataModel.migrateData({ memo: "古いメモ" });
    expect(source.description).toBe("古いメモ");
    expect(source).not.toHaveProperty("memo");
  });

  it("description が既にあるなら上書きしない（memo は除去）", () => {
    const source = TroopDataModel.migrateData({ memo: "古いメモ", description: "<p>既存</p>" });
    expect(source.description).toBe("<p>既存</p>");
    expect(source).not.toHaveProperty("memo");
  });

  it("memo が無ければ何もしない", () => {
    const source = TroopDataModel.migrateData({ description: "<p>既存</p>" });
    expect(source.description).toBe("<p>既存</p>");
  });
});
