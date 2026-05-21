import { describe, it, expect } from "vitest";
import { MockSchemaField, MockStringField } from "../../../setup.mjs";

const { BiographyTemplate } = await import("../../../../scripts/data/actor/common/biography.mjs");

describe("BiographyTemplate.defineSchema()", () => {
  const schema = BiographyTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("トップレベルフィールドがすべて存在する", () => {
    const expectedKeys = [
      "charaname_ruby", "handle", "handle_ruby", "post",
      "citizenRank", "age", "gender", "birthday",
      "height", "weight", "eyes", "hair", "skin", "description",
    ];
    for (const key of expectedKeys) {
      it(`schema.${key} が存在する`, () => {
        expect(schema).toHaveProperty(key);
      });
    }
  });

  describe("StringField のデフォルト値が正しい", () => {
    it("handle は StringField で initial が空文字", () => {
      expect(schema.handle).toBeInstanceOf(MockStringField);
      expect(schema.handle.options.initial).toBe("");
    });

    it("citizenRank の initial は 'B-'", () => {
      expect(schema.citizenRank.options.initial).toBe("B-");
    });
  });

  describe("post (SchemaField) の構造が正しい", () => {
    it("post は SchemaField である", () => {
      expect(schema.post).toBeInstanceOf(MockSchemaField);
    });

    it("post.name と post.id が存在する", () => {
      expect(schema.post.fields).toHaveProperty("name");
      expect(schema.post.fields).toHaveProperty("id");
    });

    it("post.name の initial は '無所属'", () => {
      expect(schema.post.fields.name.options.initial).toBe("無所属");
    });

    it("post.id の initial は空文字", () => {
      expect(schema.post.fields.id.options.initial).toBe("");
    });
  });
});
