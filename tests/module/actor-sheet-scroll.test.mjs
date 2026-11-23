import { afterEach, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("../../scripts/actor/sheet-context-menus.mjs", () => ({ activateContextMenus() {} }));
afterEach(() => vi.unstubAllGlobals());

it("再描画で親フックを呼び、本文・サイドバー・タブの位置を戻して遷移を再開する", async () => {
    const before = vi.fn(), after = vi.fn();
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.applications.handlebars = { renderTemplate: vi.fn() };
    foundry.applications.sheets = {};
    foundry.applications.sheets.ActorSheetV2 = class { _preRender(...args) { before(...args); } _onRender(...args) { after(...args); } };
    foundry.applications.ux = { DragDrop: { implementation: class { bind() {} } } };
    const { TnxCharacterSheetBase } = await import("../../scripts/actor/tnx-character-sheet-base.mjs");
    const dom = new JSDOM('<main><div class="sheet-body"></div><div class="profile-sidebar"></div><div class="tab" data-tab="history"></div></main>');
    vi.stubGlobal("AbortController", dom.window.AbortController);
    vi.stubGlobal("customElements", dom.window.customElements);
    const sheet = new TnxCharacterSheetBase();
    const root = sheet.element = dom.window.document.querySelector("main");
    sheet.actor = { items: [], effects: [], system: {} };
    sheet._onDragStart = () => {};
    sheet._applyTextSqueezing = () => {};
    vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", cb => frames.push(cb));
    const ctx = {}, options = {};
    [...root.children].forEach((el, i) => { el.scrollTop = i + 12; });
    await sheet._preRender(ctx, options);
    expect(before.mock.calls).toEqual([[ctx, options]]);
    expect(root.classList.contains("tnx-no-transitions")).toBe(true);
    root.replaceChildren(...[...root.children].map(el => el.cloneNode(true)));
    sheet._onRender(ctx, options);
    frames.forEach(cb => cb());
    expect(after.mock.calls).toEqual([[ctx, options]]);
    expect([...root.children].map(el => el.scrollTop)).toEqual([12, 13, 14]);
    expect(root.classList.contains("tnx-no-transitions")).toBe(false);
    dom.window.close();
});
