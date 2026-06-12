import { describe, it, expect } from "vitest";
import { MockArrayField, MockSchemaField, MockStringField, MockNumberField } from "../../../setup.mjs";

const { ExtensibleTemplate, SLOT_KINDS } = await import("../../../../scripts/data/item/common/extensible.mjs");

describe("ExtensibleTemplate.defineSchema() (フェーズ6-2 プール方式)", () => {
  const schema = ExtensibleTemplate.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("slots が ArrayField で要素は SchemaField", () => {
    expect(schema.slots).toBeInstanceOf(MockArrayField);
    expect(schema.slots.element).toBeInstanceOf(MockSchemaField);
  });

  it("旧 slot フィールドは持たない", () => {
    expect(schema).not.toHaveProperty("slot");
  });

  it("要素は kind / count を持つ(装備側はスロット数のみを設定する)", () => {
    expect(schema.slots.element.fields).toHaveProperty("kind");
    expect(schema.slots.element.fields).toHaveProperty("count");
    expect(schema.slots.element.fields).not.toHaveProperty("optionId");
    expect(schema.slots.element.fields).not.toHaveProperty("label");
  });

  it("kind は choices 付き StringField で initial が normal", () => {
    const kind = schema.slots.element.fields.kind;
    expect(kind).toBeInstanceOf(MockStringField);
    expect(kind.options.initial).toBe("normal");
    expect(kind.options.choices).toBe(SLOT_KINDS);
  });

  it("count は NumberField で initial 0・min 0・整数", () => {
    const count = schema.slots.element.fields.count;
    expect(count).toBeInstanceOf(MockNumberField);
    expect(count.options.initial).toBe(0);
    expect(count.options.min).toBe(0);
    expect(count.options.integer).toBe(true);
  });
});

describe("SLOT_KINDS", () => {
  it("通常 + 意識 3 種 + ソフトウェア/ハードウェアの 6 種", () => {
    expect(SLOT_KINDS).toEqual({
      normal:      "スロット",
      surface:     "表層意識",
      deep:        "深層意識",
      unconscious: "無意識",
      software:    "ソフトウェア",
      hardware:    "ハードウェア",
    });
  });

  it("凍結されている", () => {
    expect(Object.isFrozen(SLOT_KINDS)).toBe(true);
  });
});
