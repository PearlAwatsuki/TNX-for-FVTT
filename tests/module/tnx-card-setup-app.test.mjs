import { describe, it, expect, vi } from "vitest";

// Foundry の描画処理だけ代替し、操作後に DOM が作り直される状況を再現する。
foundry.applications.api.ApplicationV2 = class {
  _onRender() {}
  render() {
    this.element = makeElement();
    this._onRender({}, {});
  }
};
foundry.applications.api.HandlebarsApplicationMixin = base => base;
const { TnxCardSetupApp } = await import("../../scripts/app/tnx-card-setup-app.mjs");

function makeElement() {
  const makeNode = (tab, button) => {
    const classes = new Set(button
      ? (tab === "playingCards" ? ["active"] : [])
      : (tab === "playingCards" ? [] : ["tnx-hidden"]));
    return {
      dataset: { tab },
      classList: {
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        contains: name => classes.has(name),
      },
    };
  };
  const tabs = ["playingCards", "hands", "trumps", "others"];
  const buttons = tabs.map(tab => makeNode(tab, true));
  const contents = tabs.map(tab => makeNode(tab, false));
  return { querySelectorAll: selector => selector === ".tnx-setup-tab-btn" ? buttons : contents };
}

describe("カード設定のタブ保持", () => {
  it.each([
    ["hands", "_onClearUserHand"],
    ["trumps", "_onClearUserTrump"],
  ])("%s のクリア操作で再描画しても選択中のタブが残る", async (tab, action) => {
    const user = { flags: {}, update: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("game", { users: { get: () => user } });
    const app = new TnxCardSetupApp();
    app.render();
    TnxCardSetupApp._onSwitchTab.call(app, null, { dataset: { tab } });
    const oldElement = app.element;
    await TnxCardSetupApp[action].call(app, null, {
      closest: () => ({ dataset: { userId: "user1" } }),
    });
    expect(user.update).toHaveBeenCalledOnce();
    expect(app.element).not.toBe(oldElement);
    const selected = app.element.querySelectorAll(".tnx-setup-tab-btn")
      .filter(node => node.classList.contains("active"));
    const visible = app.element.querySelectorAll(".tnx-tab-content")
      .filter(node => !node.classList.contains("tnx-hidden"));
    expect(selected.map(node => node.dataset.tab)).toEqual([tab]);
    expect(visible.map(node => node.dataset.tab)).toEqual([tab]);
    vi.unstubAllGlobals();
  });
});
