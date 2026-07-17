import { describe, it, expect } from "vitest";
import { formatSkillName, itemDisplayName } from "../../scripts/module/identification.mjs";

// 技能名の表示整形(2026-07-18 ユーザー確定): アイテム名欄・アクターシートの技能リスト以外の
// 表示では必ず 〈〉 で囲い、秘技/奥義/演出特技の識別マーク(†・※・@)は省く。

describe("formatSkillName()（〈〉整形＋識別マーク省去）", () => {
  it("技能名を 〈〉 で囲う", () => {
    expect(formatSkillName("白兵")).toBe("〈白兵〉");
    expect(formatSkillName("社会：警察")).toBe("〈社会：警察〉");
  });

  it("識別マーク(†・※・@)を省く", () => {
    expect(formatSkillName("マイフェイバリット†")).toBe("〈マイフェイバリット〉");
    expect(formatSkillName("危機予知※")).toBe("〈危機予知〉");
    expect(formatSkillName("@ホーリーメイデン")).toBe("〈ホーリーメイデン〉");
  });

  it("冪等(既に 〈〉 付きでも二重に囲わない)・空は空文字", () => {
    expect(formatSkillName("〈白兵〉")).toBe("〈白兵〉");
    expect(formatSkillName("")).toBe("");
    expect(formatSkillName(null)).toBe("");
  });
});

describe("itemDisplayName()（技能のみ 〈〉 整形・他は素の名前）", () => {
  it("一般技能/スタイル技能は 〈〉 整形", () => {
    expect(itemDisplayName({ type: "generalSkill", name: "回避" })).toBe("〈回避〉");
    expect(itemDisplayName({ type: "styleSkill", name: "危機予知※" })).toBe("〈危機予知〉");
  });

  it("技能以外(武器等)は素の名前のまま", () => {
    expect(itemDisplayName({ type: "weapon", name: "ペネトレイト" })).toBe("ペネトレイト");
    expect(itemDisplayName(null)).toBe("");
  });
});
