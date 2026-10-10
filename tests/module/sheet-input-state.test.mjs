import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { isValueEntry, syncViewModeCheckboxes } from "../../scripts/ui/sheet-input-state.mjs";
import { HistoryInputStateMixin } from "../../scripts/ui/history-input-state.mjs";

// Run the actual sheet hooks against DOM elements without importing the full Foundry class graph.
beforeEach(() => vi.stubGlobal("CSS", { escape: value => value }));
afterEach(() => vi.unstubAllGlobals());

class Base {
    _preSyncPartState(_id, _next, prior, state) {
        const input = prior.ownerDocument.activeElement;
        state.focus = input?.name ? `[name="${input.name}"]` : undefined;
    }
    _syncPartState(_id, next, _prior, state) {
        if (state.focus) next.querySelector(state.focus)?.focus();
    }
}
function sheetHooks(path) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const hooks = ["_preSyncPartState", "_syncPartState"].map(name => {
        const start = source.indexOf(`    ${name}(`);
        const end = source.indexOf("\n    }", start) + 6;
        return source.slice(start, end);
    }).join("\n");
    return new Function("Base", "isValueEntry", "CSS", `return class extends Base { ${hooks} }`)(
        Base, isValueEntry, { escape: value => value });
}
const sheets = [
    ["item", sheetHooks("../../scripts/item/tnx-item-sheet.mjs")],
    ["actor", sheetHooks("../../scripts/actor/tnx-character-sheet-base.mjs")],
    ["history", HistoryInputStateMixin(Base)],
];

// Match value attribute handling in Foundry FormDataExtended and BooleanField.
function storedBoolean(input) {
    const value = input.hasAttribute("value") ? (input.checked ? input.value : null) : input.checked;
    return typeof value === "string" ? value === "true" : Boolean(value);
}

describe.each(sheets)("%s input state", (_name, Sheet) => {
    it("keeps earlier selections when selecting three traits across renders", () => {
        const dom = new JSDOM('<form><input type="checkbox" name="system.isAction"><input type="checkbox" name="system.usesBounty"><input type="checkbox" name="system.isActLimited"></form>');
        const doc = dom.window.document;
        const sheet = new Sheet();
        for (let index = 0; index < 3; index++) {
            const prior = doc.querySelector("form");
            const inputs = prior.querySelectorAll("input");
            inputs[index].click();
            inputs[index].focus();
            expect([...inputs].map(storedBoolean)).toEqual([0, 1, 2].map(i => i <= index));
            const next = prior.cloneNode(true);
            const state = {};
            sheet._preSyncPartState("main", next, prior, state);
            prior.replaceWith(next);
            sheet._syncPartState("main", next, prior, state);
            expect([...next.querySelectorAll("input")].every(i => !i.hasAttribute("value"))).toBe(true);
        }
        const inputs = doc.querySelectorAll("input");
        inputs[1].click();
        expect([...inputs].map(storedBoolean)).toEqual([true, false, true]);
        dom.window.close();
    });

    it("preserves unsaved text and selection", () => {
        const dom = new JSDOM('<form><input name="name" value="saved"></form>');
        const prior = dom.window.document.querySelector("form");
        const next = prior.cloneNode(true);
        const input = prior.firstChild;
        input.value = "draft";
        input.focus();
        input.setSelectionRange(1, 3);
        const sheet = new Sheet();
        const state = {};
        sheet._preSyncPartState("main", next, prior, state);
        prior.replaceWith(next);
        sheet._syncPartState("main", next, prior, state);
        expect(next.firstChild.value).toBe("draft");
        expect(next.firstChild.selectionStart).toBe(1);
        expect(next.firstChild.selectionEnd).toBe(3);
        dom.window.close();
    });
});

describe("view mode checkboxes", () => {
    it("blocks direct and label clicks, preserving pre-existing disabled controls", () => {
        const dom = new JSDOM('<form><label><input type="checkbox" checked>Trait</label><input type="checkbox" disabled><input type="radio"></form>');
        const form = dom.window.document.querySelector("form");
        const [input, locked, radio] = form.querySelectorAll("input");
        syncViewModeCheckboxes(form, false);
        syncViewModeCheckboxes(form, false);
        input.click();
        form.querySelector("label").click();
        expect(input.checked).toBe(true);
        expect(input.disabled).toBe(true);
        expect(radio.disabled).toBe(true);
        syncViewModeCheckboxes(form, true);
        expect(input.disabled).toBe(false);
        expect(locked.disabled).toBe(true);
        expect(radio.disabled).toBe(false);
        form.querySelector("label").click();
        expect(input.checked).toBe(false);
        dom.window.close();
    });
});
