import { describe, it, expect } from "vitest";
import { applyTriggerDisable, DISABLED_TRIGGER_CLASS } from "../../scripts/module/ui-trigger-disable.mjs";

/** DOM 非依存で util を検証するための最小要素モック(classList/属性/title のみ)。 */
function fakeEl({ classes = ["check-trigger"], dataAction = "startSkillCheck", dataset = {} } = {}) {
  const classSet = new Set(classes);
  const attrs = new Map();
  if (dataAction !== null) attrs.set("data-action", dataAction);
  return {
    dataset,
    title: "",
    classList: {
      add:      (c) => classSet.add(c),
      remove:   (c) => classSet.delete(c),
      contains: (c) => classSet.has(c),
    },
    removeAttribute: (k) => attrs.delete(k),
    setAttribute:    (k, v) => attrs.set(k, v),
    getAttribute:    (k) => (attrs.has(k) ? attrs.get(k) : null),
  };
}
const fakeRoot = (els) => ({ querySelectorAll: () => els });

describe("applyTriggerDisable()", () => {
  it("evaluate が理由を返した要素をグレーアウト＋クリック不能にする", () => {
    const el = fakeEl();
    const n = applyTriggerDisable(fakeRoot([el]), "sel", () => ({ reason: "使用不可" }));
    expect(n).toBe(1);
    expect(el.classList.contains(DISABLED_TRIGGER_CLASS)).toBe(true);
    expect(el.classList.contains("check-trigger")).toBe(false); // 起動トリガーの見た目を外す
    expect(el.getAttribute("data-action")).toBeNull();          // アクション発火を止める
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.title).toBe("使用不可");
  });

  it("evaluate が falsy を返した要素は一切変更しない", () => {
    const el = fakeEl();
    const n = applyTriggerDisable(fakeRoot([el]), "sel", () => null);
    expect(n).toBe(0);
    expect(el.classList.contains(DISABLED_TRIGGER_CLASS)).toBe(false);
    expect(el.classList.contains("check-trigger")).toBe(true);
    expect(el.getAttribute("data-action")).toBe("startSkillCheck");
    expect(el.title).toBe("");
  });

  it("reason 省略でも無効化はする(title は据え置き)", () => {
    const el = fakeEl();
    applyTriggerDisable(fakeRoot([el]), "sel", () => ({}));
    expect(el.classList.contains(DISABLED_TRIGGER_CLASS)).toBe(true);
    expect(el.getAttribute("data-action")).toBeNull();
    expect(el.title).toBe("");
  });

  it("root が querySelectorAll を持たない/evaluate が関数でないなら 0(例外を投げない)", () => {
    expect(applyTriggerDisable(null, "sel", () => ({}))).toBe(0);
    expect(applyTriggerDisable(fakeRoot([fakeEl()]), "sel", "notfn")).toBe(0);
  });
});
