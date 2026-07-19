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

    for (const key of ["isOption", "isCyber", "isConsumption"]) {
      it(`${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }

    it("isCarrying は BooleanField で initial が true (2026-06-13 ユーザー指示)", () => {
      expect(schema.isCarrying).toBeInstanceOf(MockBooleanField);
      expect(schema.isCarrying.options.initial).toBe(true);
    });

    it("fromStyleSkillKey は StringField で initial が空文字(10-2 由来マーク)", () => {
      expect(schema.fromStyleSkillKey).toBeInstanceOf(MockStringField);
      expect(schema.fromStyleSkillKey.options.initial).toBe("");
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

  describe("exclusive (専用) が正しい (10-2: スタイル/組織辞典参照の配列化)", () => {
    it("exclusive は ArrayField で要素は {type, key} の SchemaField (initial 空文字)", () => {
      expect(schema.exclusive).toBeInstanceOf(MockArrayField);
      expect(schema.exclusive.element).toBeInstanceOf(MockSchemaField);
      expect(schema.exclusive.element.fields.type).toBeInstanceOf(MockStringField);
      expect(schema.exclusive.element.fields.type.options.initial).toBe("");
      expect(schema.exclusive.element.fields.key).toBeInstanceOf(MockStringField);
      expect(schema.exclusive.element.fields.key.options.initial).toBe("");
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

  describe("timing は持たない (2026-07-19 廃止: タイミングは用途側で管理する)", () => {
    it("schema.timing が存在しない", () => {
      expect(schema.timing).toBeUndefined();
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

  describe("buy / hide (SchemaField) が正しい", () => {
    for (const key of ["buy", "hide"]) {
      it(`${key} は SchemaField である`, () => {
        expect(schema[key]).toBeInstanceOf(MockSchemaField);
      });

      it(`${key}.value は NumberField で initial が 0`, () => {
        expect(schema[key].fields.value).toBeInstanceOf(MockNumberField);
        expect(schema[key].fields.value.options.initial).toBe(0);
      });
    }

    it("buy.mode は StringField で initial が 'none'、choices は none/value/reference", () => {
      expect(schema.buy.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.buy.fields.mode.options.initial).toBe("none");
      expect(schema.buy.fields.mode.options.choices).toEqual(["none", "value", "reference"]);
    });

    it("hide.mode は StringField で initial が 'none'、choices は none/value/reference/control", () => {
      expect(schema.hide.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.hide.fields.mode.options.initial).toBe("none");
      expect(schema.hide.fields.mode.options.choices).toEqual(["none", "value", "reference", "control"]);
    });
  });

  describe("数値フィールドが正しい", () => {
    it("preserveExp は {mode,value} の SchemaField で mode の choices は none/value のみ (常備化経験点は「なし/数値」)", () => {
      expect(schema.preserveExp).toBeInstanceOf(MockSchemaField);
      expect(schema.preserveExp.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.preserveExp.fields.mode.options.initial).toBe("none");
      expect(schema.preserveExp.fields.mode.options.choices).toEqual(["none", "value"]);
      expect(schema.preserveExp.fields.value).toBeInstanceOf(MockNumberField);
      expect(schema.preserveExp.fields.value.options.initial).toBe(0);
    });

    it("appearancePenalty は SchemaField で mode/value を持つ (フェーズ6-4 にて変更)", () => {
      expect(schema.appearancePenalty).toBeInstanceOf(MockSchemaField);
      expect(schema.appearancePenalty.fields.mode).toBeInstanceOf(MockStringField);
      expect(schema.appearancePenalty.fields.value).toBeInstanceOf(MockNumberField);
    });
  });

  describe("parentItemId / parentSlotKind (オプション装備先の参照)", () => {
    it("parentItemId は StringField で initial が空文字", () => {
      expect(schema.parentItemId).toBeInstanceOf(MockStringField);
      expect(schema.parentItemId.options.initial).toBe("");
    });

    it("parentSlotKind は StringField で initial が空文字", () => {
      expect(schema.parentSlotKind).toBeInstanceOf(MockStringField);
      expect(schema.parentSlotKind.options.initial).toBe("");
    });
  });

  describe("combineGroupId (コンバイングループ参照)", () => {
    it("combineGroupId は StringField で initial が空文字", () => {
      expect(schema.combineGroupId).toBeInstanceOf(MockStringField);
      expect(schema.combineGroupId.options.initial).toBe("");
    });
  });

  describe("uses (SchemaField) の構造が正しい", () => {
    it("uses は SchemaField である", () => {
      expect(schema.uses).toBeInstanceOf(MockSchemaField);
    });

    it("uses に isLimit / type / max / spent が存在する", () => {
      expect(schema.uses.fields).toHaveProperty("isLimit");
      expect(schema.uses.fields).toHaveProperty("type");
      expect(schema.uses.fields).toHaveProperty("max");
      expect(schema.uses.fields).toHaveProperty("spent");
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

    it("uses.spent は NumberField で initial が 0", () => {
      expect(schema.uses.fields.spent).toBeInstanceOf(MockNumberField);
      expect(schema.uses.fields.spent.options.initial).toBe(0);
    });

    it("migrateData: 旧 uses.value(残り) → uses.spent(消費済み) に移行する", () => {
      const src = OutfitBaseTemplate.migrateData({ uses: { value: 2, max: 5 } });
      expect(src.uses.spent).toBe(3); // 5 - 2
      expect(src.uses.value).toBeUndefined();
    });
  });

  describe("故障/破壊(2026-07-18)", () => {
    for (const key of ["isMalfunction", "isDestroyed"]) {
      it(`${key} は BooleanField で initial が false`, () => {
        expect(schema[key]).toBeInstanceOf(MockBooleanField);
        expect(schema[key].options.initial).toBe(false);
      });
    }
  });
});

describe("OutfitBaseTemplate.prepareDerivedData()（故障/破壊・準備固定・2026-07-18）", () => {
  /** prepareDerivedData を素のオブジェクトへ適用して派生後の状態を返す。 */
  const derive = (over = {}) => {
    const sys = {
      majorCategory: "", minorCategory: "",
      part: [], partOptional: false,
      isPrepared: true, isCarrying: true,
      isMalfunction: false, isDestroyed: false,
      ...over,
    };
    OutfitBaseTemplate.prototype.prepareDerivedData.call(sys);
    return sys;
  };

  it("非サービスの故障/破壊は実効(Total)に反映される", () => {
    const sys = derive({ majorCategory: "weapon", isMalfunction: true, isDestroyed: true, part: [{ kind: "bodyPart" }] });
    expect(sys.isMalfunctionTotal).toBe(true);
    expect(sys.isDestroyedTotal).toBe(true);
  });

  it("サービス大分類は免疫=実効の故障/破壊を false に落とす", () => {
    const sys = derive({ majorCategory: "service", isMalfunction: true, isDestroyed: true, part: [{ kind: "bodyPart" }] });
    expect(sys.isMalfunctionTotal).toBe(false);
    expect(sys.isDestroyedTotal).toBe(false);
  });

  it("サービス/バックグラウンドは準備・携帯を強制 true(部位なしでも準備される)", () => {
    // 部位なし=通常は isPartless で isPrepared=false だが、バックグラウンドはそれを上書きする
    const sys = derive({ majorCategory: "service", minorCategory: "background", isPrepared: false, isCarrying: false, part: [] });
    expect(sys.isPrepared).toBe(true);
    expect(sys.isCarrying).toBe(true);
  });
});
