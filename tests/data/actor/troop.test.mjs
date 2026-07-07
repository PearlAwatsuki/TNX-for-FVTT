import { describe, it, expect } from "vitest";
import { MockStringField, MockNumberField, MockSchemaField, MockBooleanField } from "../../setup.mjs";

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

    it("troopMode は StringField で initial 'troop'（種別ドロップダウン: トループ/エニグマ/分身）", () => {
      expect(schema.troopMode).toBeInstanceOf(MockStringField);
      expect(schema.troopMode.options.initial).toBe("troop");
      expect(schema.troopMode.options.choices).toEqual(["troop", "enigma", "bunshin"]);
    });

    it("sourceName を持たない（分身元は所有者参照から導出・2026-07-07 廃止）", () => {
      expect(schema).not.toHaveProperty("sourceName");
    });

    it("troopLevel は NumberField で initial 0・min 0・整数（能力値=スタイル基本値+トループレベル）", () => {
      expect(schema.troopLevel).toBeInstanceOf(MockNumberField);
      expect(schema.troopLevel.options.initial).toBe(0);
      expect(schema.troopLevel.options.min).toBe(0);
      expect(schema.troopLevel.options.integer).toBe(true);
    });

    it("旧 isEnigmaMode を持たない（種別ドロップダウンに置換・2026-07-03 修正）", () => {
      expect(schema).not.toHaveProperty("isEnigmaMode");
    });

    it("hasWorks（ワークスを設定）は BooleanField で initial false", () => {
      expect(schema.hasWorks).toBeInstanceOf(MockBooleanField);
      expect(schema.hasWorks.options.initial).toBe(false);
    });

    it("ownerActorRef（所有者=取得元アクター参照・11-6）は SchemaField{uuid, name}", () => {
      expect(schema.ownerActorRef).toBeInstanceOf(MockSchemaField);
      expect(schema.ownerActorRef.fields).toHaveProperty("uuid");
      expect(schema.ownerActorRef.fields).toHaveProperty("name");
      expect(schema.ownerActorRef.fields.uuid.options.initial).toBe("");
    });
  });

  it("guest（共通基底そのまま）との差分は heads / troopMode / hasWorks / troopLevel / ownerActorRef に限られる", () => {
    const guestKeys = new Set(Object.keys(GuestDataModel.defineSchema()));
    const troopKeys = new Set(Object.keys(schema));
    const troopOnly = [...troopKeys].filter(k => !guestKeys.has(k)).sort();
    const guestOnly = [...guestKeys].filter(k => !troopKeys.has(k));
    expect(troopOnly).toEqual(["hasWorks", "heads", "ownerActorRef", "troopLevel", "troopMode"]);
    expect(guestOnly).toEqual([]);
  });
});

describe("TroopDataModel.migrateData()（旧フィールド移行）", () => {
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

  it("旧 isEnigmaMode=true は troopMode 'enigma' へ移行して除去する", () => {
    const source = TroopDataModel.migrateData({ isEnigmaMode: true });
    expect(source.troopMode).toBe("enigma");
    expect(source).not.toHaveProperty("isEnigmaMode");
  });

  it("旧 isEnigmaMode=false は troopMode を設定せず除去のみ", () => {
    const source = TroopDataModel.migrateData({ isEnigmaMode: false });
    expect(source.troopMode).toBeUndefined();
    expect(source).not.toHaveProperty("isEnigmaMode");
  });

  it("旧 sourceName は除去する（分身元は所有者参照から導出・2026-07-07 廃止）", () => {
    const source = TroopDataModel.migrateData({ sourceName: "時雨" });
    expect(source).not.toHaveProperty("sourceName");
  });
});
