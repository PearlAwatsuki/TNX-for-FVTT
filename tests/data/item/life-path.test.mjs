import { describe, it, expect } from "vitest";
import { MockStringField } from "../../setup.mjs";

const { LifePathDataModel } = await import("../../../scripts/data/item/life-path.mjs");

describe("LifePathDataModel.defineSchema()", () => {
  const schema = LifePathDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("固有フィールドが存在する", () => {
    it("schema.lifePathType が存在する", () => {
      expect(schema).toHaveProperty("lifePathType");
    });

    it("schema.skillName が存在する", () => {
      expect(schema).toHaveProperty("skillName");
    });
  });

  describe("固有フィールドの初期値が空文字列である", () => {
    it("schema.lifePathType.options.initial === ''", () => {
      expect(schema.lifePathType.options.initial).toBe("");
    });

    it("schema.skillName.options.initial === ''", () => {
      expect(schema.skillName.options.initial).toBe("");
    });
  });

  describe("lifePathType の choices (フェーズ6-0)", () => {
    it("choices は origin / experience / encounter の 3 種のみ", () => {
      expect(schema.lifePathType.options.choices).toEqual({
        origin:     "出自",
        experience: "経験",
        encounter:  "邂逅",
      });
    });

    it("未選択を許容する (blank: true)", () => {
      expect(schema.lifePathType.options.blank).toBe(true);
    });
  });

  it("lifePath に存在しないフィールドは含まれない(level が含まれない)", () => {
    expect(schema).not.toHaveProperty("level");
  });

  it("Cast Actor 側の lifePath.origin は含まれない", () => {
    expect(schema).not.toHaveProperty("origin");
  });
});

describe("LifePathDataModel identificationKey (フェーズ6-0)", () => {
  const schema = LifePathDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});
