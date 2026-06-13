import { describe, it, expect } from "vitest";
import { MockBooleanField, MockStringField, MockNumberField, MockSchemaField, MockArrayField } from "../../../setup.mjs";

const { OutfitBaseTemplate } = await import("../../../../scripts/data/item/common/outfit-base.mjs");
const { getMajorCategoryChoices, getMinorCategoryChoices } =
  await import("../../../../scripts/data/item/outfit-categories.mjs");

describe("OutfitBaseTemplate.defineSchema()", () => {
  const schema = OutfitBaseTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  describe("Boolean フィールドが正しい", () => {
    it("isPrepared は BooleanField で initial が true", () => {
      expect(schema.isPrepared).toBeInstanceOf(MockBooleanField);
      expect(schema.isPrepared.options.initial).toBe(true);
    });

    it('"isPre-play" は BooleanField で initial が false (ハイフン含みキー)', () => {
      expect(schema).toHaveProperty("isPre-play");
      expect(schema["isPre-play"]).toBeInstanceOf(MockBooleanField);
      expect(schema["isPre-play"].options.initial).toBe(false);
    });

    for (const key of ["isOption", "isCyber", "isConsumption", "isBiological"]) {
      it(`${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }

    it("isCarrying は BooleanField で initial が true (2026-06-13 ユーザー指示)", () => {
      expect(schema.isCarrying).toBeInstanceOf(MockBooleanField);
      expect(schema.isCarrying.options.initial).toBe(true);
    });
  });

  describe("quantity (消費アイテムの個数、フェーズ6-2) が正しい", () => {
    it("quantity は {value, max} の SchemaField で initial 1・min 0・整数", () => {
      expect(schema.quantity).toBeInstanceOf(MockSchemaField);
      for (const key of ["value", "max"]) {
        expect(schema.quantity.fields[key]).toBeInstanceOf(MockNumberField);
        expect(schema.quantity.fields[key].options.initial).toBe(1);
        expect(schema.quantity.fields[key].options.min).toBe(0);
        expect(schema.quantity.fields[key].options.integer).toBe(true);
      }
    });
  });

  describe("自由記述フィールド (フェーズ6-1) が正しい", () => {
    it("exclusive は StringField で initial が空文字 (閲覧時に空欄は '-' 表示)", () => {
      expect(schema.exclusive).toBeInstanceOf(MockStringField);
      expect(schema.exclusive.options.initial).toBe("");
    });
  });

  describe("part (部位) が正しい (フェーズ6-3: 複数部位対応で配列化)", () => {
    it("part は ArrayField で要素は {value, slots} の SchemaField", () => {
      expect(schema.part).toBeInstanceOf(MockArrayField);
      expect(schema.part.element).toBeInstanceOf(MockSchemaField);
      expect(schema.part.element.fields.value).toBeInstanceOf(MockStringField);
      expect(schema.part.element.fields.value.options.initial).toBe("");
    });

    it("要素の slots は NumberField で initial 1・min 0・整数", () => {
      const slots = schema.part.element.fields.slots;
      expect(slots).toBeInstanceOf(MockNumberField);
      expect(slots.options.initial).toBe(1);
      expect(slots.options.min).toBe(0);
      expect(slots.options.integer).toBe(true);
    });
  });

  describe("hack (電脳制御値) が正しい (フェーズ6-1)", () => {
    it("hack は {mode, value} の SchemaField で mode の choices は none/value のみ", () => {
      expect(schema.hack).toBeInstanceOf(MockSchemaField);
      expect(schema.hack.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.hack.fields.mode.options.initial).toBe("none");
      expect(schema.hack.fields.mode.options.choices).toEqual(["none", "value"]);
      expect(schema.hack.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.hack.fields.value.options.initial).toBe(0);
    });
  });

  describe("timing が正しい (フェーズ6-3: 単一の SchemaField に変更)", () => {
    it("timing は配列ではなく単一の SchemaField (アウトフィットのタイミングは一つのみ)", () => {
      expect(schema.timing).toBeInstanceOf(MockSchemaField);
    });

    it("value / actionName / processName / timingOther を持ち、初期値がスタイル技能と同一", () => {
      const el = schema.timing.fields;
      for (const key of ["value", "actionName", "processName"]) {
        expect(el[key]).toBeInstanceOf(MockStringField);
        expect(el[key].options.initial).toBe("blank");
      }
      expect(el.timingOther).toBeInstanceOf(MockStringField);
      expect(el.timingOther.options.initial).toBe("");
    });
  });

  describe("カテゴリフィールド (choices 付き) が正しい", () => {
    it("majorCategory は StringField で initial が空文字・blank 許容", () => {
      expect(schema.majorCategory).toBeInstanceOf(MockStringField);
      expect(schema.majorCategory.options.initial).toBe("");
      expect(schema.majorCategory.options.blank).toBe(true);
    });

    it("majorCategory の choices は大分類リストを返す関数", () => {
      expect(schema.majorCategory.options.choices).toBe(getMajorCategoryChoices);
    });

    it("minorCategory は StringField で initial が空文字・blank 許容", () => {
      expect(schema.minorCategory).toBeInstanceOf(MockStringField);
      expect(schema.minorCategory.options.initial).toBe("");
      expect(schema.minorCategory.options.blank).toBe(true);
    });

    it("minorCategory の choices は小分類リストを返す関数", () => {
      expect(schema.minorCategory.options.choices).toBe(getMinorCategoryChoices);
    });
  });

  describe("buy / hide (3 状態 SchemaField) が正しい", () => {
    for (const key of ["buy", "hide"]) {
      it(`${key} は SchemaField である`, () => {
        expect(schema[key]).toBeInstanceOf(MockSchemaField);
      });

      it(`${key}.mode は StringField で initial が 'none'、choices は none/value/reference`, () => {
        expect(schema[key].fields.mode).toBeInstanceOf(MockStringField);
        expect(schema[key].fields.mode.options.initial).toBe("none");
        expect(schema[key].fields.mode.options.choices).toEqual(["none", "value", "reference"]);
      });

      it(`${key}.value は NumberField で initial が 0`, () => {
        expect(schema[key].fields.value).toBeInstanceOf(MockNumberField);
        expect(schema[key].fields.value.options.initial).toBe(0);
      });
    }
  });

  describe("数値フィールドが正しい", () => {
    it("preserveExp は NumberField で initial が 0 (常備化経験点は必ず数値)", () => {
      expect(schema.preserveExp).toBeInstanceOf(MockNumberField);
      expect(schema.preserveExp.options.initial).toBe(0);
    });

    it("appearancePenalty は NumberField で initial が 0 (危険値は必ず数値)", () => {
      expect(schema.appearancePenalty).toBeInstanceOf(MockNumberField);
      expect(schema.appearancePenalty.options.initial).toBe(0);
    });
  });

  describe("uses (SchemaField) の構造が正しい", () => {
    it("uses は SchemaField である", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });

    it("uses に isLimit / type / max / value が存在する", () => {
      expect(schema.uses.fields).toHaveProperty("isLimit");
      expect(schema.uses.fields).toHaveProperty("type");
      expect(schema.uses.fields).toHaveProperty("max");
      expect(schema.uses.fields).toHaveProperty("value");
    });

    it("uses.type は StringField で initial が空文字 (種別: アクト/シーン/カット)", () => {
      expect(schema.uses.fields.type).toBeInstanceOf(MockStringField);
      expect(schema.uses.fields.type.options.initial).toBe("");
    });

    it("uses.isLimit は BooleanField で initial が false", () => {
      expect(schema.uses.fields.isLimit).toBeInstanceOf(MockBooleanField);
      expect(schema.uses.fields.isLimit.options.initial).toBe(false);
    });

    it("uses.max は NumberField で initial が 0", () => {
      expect(schema.uses.fields.max).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.max.options.initial).toBe(0);
    });

    it("uses.value は NumberField で initial が 0", () => {
      expect(schema.uses.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.value.options.initial).toBe(0);
    });
  });
});
