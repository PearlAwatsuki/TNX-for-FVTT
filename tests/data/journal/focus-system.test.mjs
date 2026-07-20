import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { FocusSystemDataModel } = await import("../../../scripts/data/journal/focus-system.mjs");

describe("FocusSystemDataModel.defineSchema()（FS判定シート・2026-07-20）", () => {
  const schema = FocusSystemDataModel.defineSchema();

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("FS の設定フィールドを持つ", () => {
    expect(schema).toHaveProperty("restriction");
    expect(schema).toHaveProperty("defeatCondition");
    expect(schema).toHaveProperty("defeatEffect");
    expect(schema).toHaveProperty("targetProgress");
    expect(schema).toHaveProperty("supportSkillKey");
    expect(schema).toHaveProperty("rows");
    expect(schema).toHaveProperty("memo");
  });

  it("FS 名は持たない（ページ名を使う）", () => {
    expect(schema).not.toHaveProperty("name");
  });

  it("進行状態は持たない（正本はワールド設定の実行中 FS）", () => {
    expect(schema).not.toHaveProperty("progress");
    expect(schema).not.toHaveProperty("cut");
  });

  it("敗北条件は種別・自由文・カット数を持つ", () => {
    const fields = schema.defeatCondition.fields;
    expect(fields).toHaveProperty("type");
    expect(fields).toHaveProperty("text");
    expect(fields).toHaveProperty("cutLimit");
  });

  it("判定行は閾値・技能・目標値・進行修正・備考を持つ", () => {
    const fields = schema.rows.element.fields;
    expect(fields).toHaveProperty("id");
    expect(fields).toHaveProperty("threshold");
    expect(fields).toHaveProperty("skillKey");
    expect(fields).toHaveProperty("targetValue");
    expect(fields).toHaveProperty("progressMod");
    expect(fields).toHaveProperty("note");
  });

  it("進行修正は参照元・パラメータ・式を持つ", () => {
    const fields = schema.rows.element.fields.progressMod.fields;
    expect(fields).toHaveProperty("source");
    expect(fields).toHaveProperty("param");
    expect(fields).toHaveProperty("formula");
  });

  it("判定行には支援判定の役割欄を持たない（支援判定の技能はブロック側の1つ）", () => {
    expect(schema.rows.element.fields).not.toHaveProperty("role");
  });
});
