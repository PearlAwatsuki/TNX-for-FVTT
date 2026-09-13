import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { bindListDragDrop, dropListEntry } from "../../scripts/ui/list-drag-drop.mjs";
import { EffectsSheetMixin } from "../../scripts/ui/effects-sheet-mixin.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

function item(uuid, actions = []) {
    return {
        id: uuid.split(".").at(-1), uuid, documentName: "Item", isOwner: true,
        system: { actions }, effects: new Map(),
        update: vi.fn(async function(patch) { this.system.actions = patch["system.actions"]; }),
        setFlag: vi.fn(),
        createEmbeddedDocuments: vi.fn(async () => [{ id: "copy", uuid: `${uuid}.ActiveEffect.copy` }]),
    };
}

function sheet(document, html = "") {
    const dom = new JSDOM(`<section>${html}</section>`);
    return { document, isEditable: true, element: dom.window.document.querySelector("section"), dom };
}

function eventFor(s, selector) {
    return { target: selector ? s.element.querySelector(selector) : s.element, clientY: 0 };
}

beforeEach(() => {
    vi.stubGlobal("fromUuid", vi.fn());
    foundry.utils.randomID = () => "newUsage";
    foundry.utils.deepClone = value => structuredClone(value);
});

describe("usage and effect list drag/drop", () => {
    it("moves a usage before a row or to the end without changing its ID", async () => {
        const doc = item("Item.a", [{ _id: "a", name: "old" }, { _id: "b" }, { _id: "c" }]);
        const s = sheet(doc, '<li class="tnx-item-list__row" data-usage-id="a"></li>');
        fromUuid.mockResolvedValue(doc);
        await dropListEntry(s, { type: "TnxUsage", uuid: doc.uuid, usageId: "c" }, eventFor(s, "li"));
        expect(doc.system.actions.map(a => a._id)).toEqual(["c", "a", "b"]);
        await dropListEntry(s, { type: "TnxUsage", uuid: doc.uuid, usageId: "c" }, eventFor(s));
        expect(doc.system.actions.map(a => a._id)).toEqual(["a", "b", "c"]);
    });

    it("copies usage settings and referenced parent effects with fresh IDs", async () => {
        const original = { _id: "u", name: "attack", baseSkillRef: { itemId: "a" },
            effects: [{ itemId: "", effectId: "e" }], damageEffects: [{ itemId: "a", effectId: "e" }] };
        const source = item("Item.a", [original]);
        source.effects.set("e", { id: "e", toObject: () => ({ _id: "e", name: "effect", changes: [{ key: "x", value: "2" }] }) });
        const destination = item("Item.b");
        const s = sheet(destination);
        fromUuid.mockResolvedValue(source);
        await dropListEntry(s, { type: "TnxUsage", uuid: source.uuid, usageId: "u" }, eventFor(s));
        expect(destination.system.actions[0]).toMatchObject({ _id: "newUsage", name: "attack",
            baseSkillRef: { itemId: "b" }, effects: [{ effectId: "copy" }], damageEffects: [{ effectId: "copy" }] });
        expect(destination.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
        expect(original.effects[0].effectId).toBe("e");
        expect(source.update).not.toHaveBeenCalled();
    });

    it("saves effect order on the sheet document and uses it across enabled/disabled groups", async () => {
        const doc = item("Item.a");
        const a = { id: "a", uuid: "Effect.a", parent: doc, documentName: "ActiveEffect" };
        const b = { id: "b", uuid: "Effect.b", parent: doc, documentName: "ActiveEffect", disabled: true };
        doc.effects = [a, b];
        const s = sheet(doc, '<li class="tnx-item-list__row" data-effect-id="a" data-effect-uuid="Effect.a"></li><li class="tnx-item-list__row" data-effect-id="b" data-effect-uuid="Effect.b"></li>');
        fromUuid.mockResolvedValue(b);
        await dropListEntry(s, { type: "ActiveEffect", uuid: b.uuid }, eventFor(s, "li"));
        expect(doc.setFlag).toHaveBeenCalledWith(SYSTEM_ID, "effectOrder", [b.uuid, a.uuid]);
        doc.getFlag = () => [b.uuid, a.uuid];
        const context = {};
        EffectsSheetMixin.prepareEffectsContext(doc, context);
        expect(context.allEffects.map(e => e.id)).toEqual(["b", "a"]);
        expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("copies an effect independently and refuses writes on a read-only destination", async () => {
        const doc = item("Item.b");
        const s = sheet(doc);
        fromUuid.mockResolvedValue({ documentName: "ActiveEffect", uuid: "Effect.a", toObject: () => ({
            _id: "a", disabled: true, flags: { [SYSTEM_ID]: { transferredFrom: "original", custom: 5 } },
        }) });
        await dropListEntry(s, { type: "ActiveEffect", uuid: "Effect.a" }, eventFor(s));
        expect(doc.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [{
            origin: doc.uuid, disabled: true, flags: { [SYSTEM_ID]: { custom: 5 } },
        }]);
        doc.createEmbeddedDocuments.mockClear();
        s.isEditable = false;
        await dropListEntry(s, { type: "ActiveEffect", uuid: "Effect.a" }, eventFor(s));
        expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("rebinds after render and handles nested drag targets without swallowing unrelated drops", () => {
        const s = sheet(item("Item.a"), '<li class="tnx-item-list__row" data-usage-id="u"><h4>Use</h4></li>');
        vi.stubGlobal("AbortController", s.dom.window.AbortController);
        bindListDragDrop(s);
        bindListDragDrop(s);
        const transfer = { setData: vi.fn() };
        const event = new s.dom.window.Event("dragstart", { bubbles: true });
        Object.defineProperty(event, "dataTransfer", { value: transfer });
        s.element.querySelector("h4").dispatchEvent(event);
        expect(transfer.setData).toHaveBeenCalledTimes(1);
        expect(JSON.parse(transfer.setData.mock.calls[0][1])).toEqual({ type: "TnxUsage", uuid: "Item.a", usageId: "u" });
        const fallback = vi.fn();
        s.element.addEventListener("drop", fallback);
        const drop = new s.dom.window.Event("drop", { bubbles: true });
        Object.defineProperty(drop, "dataTransfer", { value: { getData: () => '{"type":"Item"}' } });
        s.element.dispatchEvent(drop);
        expect(fallback).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });
});
