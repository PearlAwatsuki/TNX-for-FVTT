import { describe, it, expect } from "vitest";
import {
  defaultFocusSystemData,
  readFocusSystemData,
  newProgressRow,
  isFocusSystemJournal,
} from "../../scripts/focus-system/data.mjs";

const SCOPE = "tokyo-nova-axleration";

describe("defaultFocusSystemData()（FS判定シートの初期値・2026-07-21）", () => {
  it("空の FS判定として成立する形を返す", () => {
    const d = defaultFocusSystemData();
    expect(d.restriction).toBe("");
    expect(d.defeatCondition).toEqual({ type: "cut", text: "", cutLimit: 0 });
    expect(d.defeatEffect).toBe("");
    expect(d.targetProgress).toBe(0);
    expect(d.rows).toEqual([]);
    expect(d.memo).toBe("");
  });

  it("支援判定の技能は配列（シートの欄は自由記入＝複数書ける・2026-07-21 現物確認）", () => {
    expect(defaultFocusSystemData().supportSkillKeys).toEqual([]);
  });
});

describe("readFocusSystemData()（フラグの読み出しと正規化）", () => {
  it("フラグが無ければ初期値", () => {
    expect(readFocusSystemData({})).toEqual(defaultFocusSystemData());
    expect(readFocusSystemData(null)).toEqual(defaultFocusSystemData());
  });

  it("保存済みの値を読む", () => {
    const doc = { flags: { [SCOPE]: { focusSystem: {
      restriction: "サイバーウェア所持者のみ",
      targetProgress: 30,
      supportSkillKeys: ["negotiation"],
    } } } };
    const d = readFocusSystemData(doc);
    expect(d.restriction).toBe("サイバーウェア所持者のみ");
    expect(d.targetProgress).toBe(30);
    expect(d.supportSkillKeys).toEqual(["negotiation"]);
  });

  it("欠けている項目は初期値で埋める", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: { targetProgress: 10 } } } });
    expect(d.defeatCondition).toEqual({ type: "cut", text: "", cutLimit: 0 });
    expect(d.rows).toEqual([]);
  });

  it("旧・単数の supportSkillKey を配列へ読み替える", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: { supportSkillKey: "drive" } } } });
    expect(d.supportSkillKeys).toEqual(["drive"]);
  });

  it("旧・単数が空文字なら空配列（空キーを1件持たない）", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: { supportSkillKey: "" } } } });
    expect(d.supportSkillKeys).toEqual([]);
  });

  it("支援判定の技能は重複と空を畳む", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: {
      supportSkillKeys: ["drive", "", "drive", "negotiation"],
    } } } });
    expect(d.supportSkillKeys).toEqual(["drive", "negotiation"]);
  });

  it("判定行は欠けた項目を埋めて数値化する", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: {
      rows: [{ threshold: "5", skillKeys: ["drive"] }],
    } } } });
    expect(d.rows[0]).toMatchObject({
      threshold: 5, skillKeys: ["drive"], targetValue: 0, note: "",
      progressMod: { source: "none", param: "", formula: "" },
    });
    expect(d.rows[0].id).toBeTruthy();
  });

  it("判定行の技能は複数持てる（重複と空を畳む・2026-07-21）", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: {
      rows: [{ skillKeys: ["drive", "", "drive", "hacking"] }],
    } } } });
    expect(d.rows[0].skillKeys).toEqual(["drive", "hacking"]);
  });

  it("旧・単数の skillKey を持つ判定行を配列へ読み替える", () => {
    const d = readFocusSystemData({ flags: { [SCOPE]: { focusSystem: {
      rows: [{ skillKey: "drive" }],
    } } } });
    expect(d.rows[0].skillKeys).toEqual(["drive"]);
  });

  it("元のフラグを書き換えない", () => {
    const flags = { [SCOPE]: { focusSystem: { rows: [{ threshold: 1 }] } } };
    readFocusSystemData({ flags });
    expect(flags[SCOPE].focusSystem.rows[0]).toEqual({ threshold: 1 });
  });
});

describe("newProgressRow()（判定行の新規行）", () => {
  it("既定値を持ち、ID が振られる", () => {
    const r = newProgressRow();
    expect(r.threshold).toBe(0);
    expect(r.skillKeys).toEqual([]);
    expect(r.targetValue).toBe(0);
    expect(r.progressMod).toEqual({ source: "none", param: "", formula: "" });
    expect(r.id).toBeTruthy();
  });

  it("行ごとに別の ID になる", () => {
    expect(newProgressRow().id).not.toBe(newProgressRow().id);
  });
});

describe("isFocusSystemJournal()（FS判定シートかどうか）", () => {
  it("FS判定のフラグを持てば真", () => {
    expect(isFocusSystemJournal({ flags: { [SCOPE]: { focusSystem: {} } } })).toBe(true);
  });

  it("持たなければ偽（アクトシートや素のジャーナルを拾わない）", () => {
    expect(isFocusSystemJournal({ flags: { [SCOPE]: { scenes: {} } } })).toBe(false);
    expect(isFocusSystemJournal({})).toBe(false);
    expect(isFocusSystemJournal(null)).toBe(false);
  });
});
