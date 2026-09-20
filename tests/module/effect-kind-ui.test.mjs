// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { registerEffectConfigInjection } from "../../scripts/core/effect-config-inject.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
vi.mock("../../scripts/app/part-slot-preset-app.mjs", () => ({ getPartSlotPreset: () => [] }));

let render;
beforeEach(() => {
    vi.stubGlobal("Hooks", { on: vi.fn((name, fn) => { if (name === "renderActiveEffectConfig") render = fn; }) });
    vi.stubGlobal("game", { settings: { get: () => [] } });
    if (!globalThis.CSS?.escape) vi.stubGlobal("CSS", { escape: s => s.replace(/[.]/g, "\\.") });
    registerEffectConfigInjection();
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

function sheet(type, transfer, flags = {}) {
    const root = document.createElement("form");
    root.innerHTML = `<div class="tab" data-tab="details"><div class="form-group"><label>自動適用</label>
        <input name="transfer" type="checkbox" ${transfer ? "checked" : ""}></div></div>`;
    document.body.appendChild(root);
    const effect = { type, transfer, statuses: [], parent: { documentName: "Item" }, getFlag: (_scope, key) => flags[key] };
    render({ document: effect }, root);
    const input = key => root.querySelector(`[name="flags.${SYSTEM_ID}.${key}"]`);
    return { root, parent: input("applyToParent"), self: input("applyToSelf"), transfer: root.querySelector('[name="transfer"]') };
}

describe("付与先チェックのフォーム制御", () => {
    it("手入力した小分類キーもプルダウンと上書きになり、副分類では加算を選べる", () => {
        const s = sheet("enchantment", true, { applyToSelf: true });
        const row = document.createElement("div");
        row.innerHTML = '<input name="system.changes.0.key"><input name="system.changes.0.value" value="melee"><select name="system.changes.0.type"><option value="add">加算</option><option value="override">上書き</option></select>';
        s.root.appendChild(row);
        const key = row.querySelector("input");
        key.value = "system.minorCategory";
        key.dispatchEvent(new Event("input", { bubbles: true }));
        const value = row.querySelector('[name$=".value"]');
        const mode = row.querySelector('[name$=".type"]');
        expect(value.tagName).toBe("SELECT");
        expect(value.value).toBe("melee");
        expect(mode.value).toBe("override");
        expect(mode.options[0].disabled).toBe(true);
        key.value = "system.additionalCategories";
        key.dispatchEvent(new Event("input", { bubbles: true }));
        expect(mode.options[0].disabled).toBe(false);
        expect([...value.options].some(o => o.value === "weapon")).toBe(false);
    });
    it("自動適用オフでも二つのチェックを表示し、両方オフを許可", () => {
        const s = sheet("enchantment", false, { applyToParent: false, applyToSelf: false });
        expect(s.parent.closest(".form-group").hidden).toBe(false);
        expect(s.self.closest(".form-group").hidden).toBe(false);
        expect(s.parent.validity.valid).toBe(true);
        s.parent.click();
        s.self.click();
        expect(s.parent.checked).toBe(false);
        expect(s.self.checked).toBe(true);
        s.self.click();
        expect(s.self.checked).toBe(false);
    });
    it("自動適用中は最後の選択を外さず、もう一方のチェックで切替", () => {
        const s = sheet("enchantment", true, { applyToParent: true, applyToSelf: false });
        s.parent.click();
        expect(s.parent.checked).toBe(true);
        s.self.click();
        expect(s.parent.checked).toBe(false);
        expect(s.self.checked).toBe(true);
    });
    it("両方オフから自動適用をオンにすると保存前に選択を要求", () => {
        const s = sheet("enchantment", false, { applyToParent: false, applyToSelf: false });
        s.transfer.click();
        expect(s.parent.validity.valid).toBe(false);
        s.parent.click();
        expect(s.parent.validity.valid).toBe(true);
    });
    it("通常AEでは付与先を非表示・送信対象外にする", () => {
        const s = sheet("base", true);
        expect(s.parent.closest(".form-group").hidden).toBe(true);
        expect(s.self.disabled).toBe(true);
        expect(new FormData(s.root).has(`flags.${SYSTEM_ID}.applyToSelf`)).toBe(false);
    });
});
