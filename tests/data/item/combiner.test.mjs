import { describe, it, expect } from "vitest";
import { MockBooleanField, MockSchemaField, MockStringField } from "../../setup.mjs";

const { CombinerDataModel } = await import("../../../scripts/data/item/combiner.mjs");

describe("CombinerDataModel.defineSchema()", () => {
  const schema = CombinerDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("BaseTemplate のフィールドが含まれる", () => {
    it("schema.description が存在する", () => {
      expect(schema).toHaveProperty("description");
    });
  });

  describe("OutfitBaseTemplate のフィールドが含まれる", () => {
    it("schema.isPrepared が存在する", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
    });

    it("schema.uses が SchemaField で存在する", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });
  });

  describe("combine フィールドの構造が正しい(フェーズ6-4)", () => {
    it("schema.combine は SchemaField で source1/source2/appearance を持つ", () => {
      expect(schema.combine).toBeInstanceOf(MockSchemaField);
      expect(schema.combine.fields.source1).toBeInstanceOf(MockStringField);
      expect(schema.combine.fields.source2).toBeInstanceOf(MockStringField);
      expect(schema.combine.fields.appearance).toBeInstanceOf(MockStringField);
    });

    it("appearance は initial '1'、choices は 1/2", () => {
      expect(schema.combine.fields.appearance.options.initial).toBe("1");
      expect(schema.combine.fields.appearance.options.choices).toEqual(["1", "2"]);
    });

    it("旧 combinedOutfitID は持たない", () => {
      expect(schema).not.toHaveProperty("combinedOutfitID");
    });

    it("combine.params は SchemaField でパラメータ選択フィールドを持つ(フェーズ6-4)", () => {
      expect(schema.combine.fields.params).toBeInstanceOf(MockSchemaField);
      const p = schema.combine.fields.params.fields;
      expect(p.appearancePenalty).toBeInstanceOf(MockStringField);
      expect(p.controlMod).toBeInstanceOf(MockStringField);
      expect(p.attack).toBeInstanceOf(MockStringField);
      expect(p.defence).toBeInstanceOf(MockStringField);
      expect(p.guardValue).toBeInstanceOf(MockStringField);
      expect(p.range).toBeInstanceOf(MockStringField);
      expect(p.speedFactor).toBeInstanceOf(MockStringField);
      expect(p.passenger).toBeInstanceOf(MockStringField);
    });
  });

  it("extensible のフィールドは含まれない(slot が含まれない)", () => {
    expect(schema).not.toHaveProperty("slots");
  });

  it("armour 固有フィールドは含まれない(defence が含まれない)", () => {
    expect(schema).not.toHaveProperty("defence");
  });
});

describe("CombinerDataModel identificationKey (フェーズ6-0)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("identificationKey は StringField で initial が空文字", () => {
    expect(schema.identificationKey).toBeInstanceOf(MockStringField);
    expect(schema.identificationKey.options.initial).toBe("");
  });
});

describe("CombinerDataModel usage template (フェーズ6-1 追加対応)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("actions (用途リスト) が存在する", () => {
    expect(schema).toHaveProperty("actions");
  });
});

describe("CombinerDataModel isCombineActive (コンバイン活性状態)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("isCombineActive は BooleanField で initial が false", () => {
    expect(schema.isCombineActive).toBeInstanceOf(MockBooleanField);
    expect(schema.isCombineActive.options.initial).toBe(false);
  });
});

describe("CombinerDataModel combine.params.combatSpeedMod (CS修正択一)", () => {
  const schema = CombinerDataModel.defineSchema();

  it("combine.params.combatSpeedMod は StringField で initial が '1'", () => {
    expect(schema.combine.fields.params.fields.combatSpeedMod).toBeInstanceOf(MockStringField);
    expect(schema.combine.fields.params.fields.combatSpeedMod.options.initial).toBe("1");
  });
});
