// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { syncOutfitRowOperationEditor } from "../../scripts/ui/outfit-row-operation-editor.mjs";
import { syncEnchantmentRowEditor } from "../../scripts/ui/enchantment-rows.mjs";
import { parseRowOperation } from "../../scripts/rules/outfit-row-operations.mjs";

afterEach(() => document.body.replaceChildren());
const edit = (el, value) => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); };
const item = { id: "i1", name: "装備", type: "weapon", system: { majorCategory: "weapon", minorCategory: "melee",
    additionalCategories: [{ rowId: "c1", major: "cyberware", minor: "neuralware" }],
    part: [{ rowId: "p1", kind: "bodyPart", value: "片腕", partKey: "arm", requirement: "and", optional: false, slots: 1 }] } };
function start(key, op) {
    const form = document.createElement("form"), input = document.createElement("input");
    input.name = "system.changes.0.value"; input.value = op ? JSON.stringify(op) : "";
    form.append(input); document.body.append(form);
    syncOutfitRowOperationEditor(input, key, { item, partSlots: [{ key: "arm", value: "片腕" }] });
    return input;
}
const field = name => document.querySelector(`[data-field="${name}"]`);

describe("分類・部位AEの操作フォーム", () => {
    it("副分類の特定行と変更内容を選び、JSONだけ送信する", () => {
        const input = start("system.outfitCategories", { operation: "update", selector: { mode: "id", id: "c1" }, changes: {} });
        expect(field("rowId").selectedOptions[0].textContent).toContain("ニューラルウェア");
        edit(field("minor"), "reference");
        expect(JSON.parse(input.value)).toEqual({ operation: "update", selector: { mode: "id", id: "c1" }, changes: { minor: "reference" } });
        expect([...new FormData(input.form).keys()]).toEqual(["system.changes.0.value"]);
        expect(document.querySelector('[role="status"]').textContent).toContain("検証しました");
    });
    it("部位の任意だけ変更し、ほかの項目は変更しない", () => {
        const input = start("system.equip.rows", { operation: "update", selector: { mode: "id", id: "p1" }, changes: {} });
        edit(field("optional"), "true");
        expect(parseRowOperation(input.value, "part").changes).toEqual({ optional: true });
        edit(field("optional"), "__keep__");
        expect(JSON.parse(input.value).changes).toEqual({});
        expect(document.querySelector('[role="status"]').textContent).toContain("変更する項目");
    });
    it("副分類の追加で小分類を選ぶと大分類も補完する", () => {
        const input = start("system.outfitCategories");
        [...document.querySelectorAll("button")].find(b => b.textContent === "行を追加").click();
        edit(field("minor"), "neuralware");
        expect(JSON.parse(input.value).rows[0]).toMatchObject({ major: "cyberware", minor: "neuralware" });
        expect(field("major").value).toBe("cyberware");
    });
    it("条件指定と一致全行指定を区別して保存する", () => {
        const input = start("system.equip.rows", { operation: "remove", selector: { mode: "condition", match: {}, all: false } });
        edit(field("partKey"), "arm"); edit(field("all"), "true");
        expect(parseRowOperation(input.value, "part").selector).toEqual({ mode: "condition", match: { partKey: "arm" }, all: true });
    });
    it("全体置換の主分類行・副分類行を編集できる", () => {
        const input = start("system.outfitCategories");
        edit(field("operation"), "replace");
        expect([...document.querySelectorAll("legend")].some(l => l.textContent === "主分類")).toBe(true);
        edit(field("minor"), "bodyArmor");
        expect(parseRowOperation(input.value, "category").rows).toEqual([{ rowId: expect.any(String), major: "armor", minor: "bodyArmor" }]);
    });
    it("対象行が削除済みなら値を保持して理由を表示する", () => {
        const input = start("system.equip.rows", { operation: "remove", selector: { mode: "id", id: "gone" } });
        expect(field("rowId").value).toBe("gone");
        expect(document.querySelector('[role="status"]').textContent).toContain("対象行がありません");
        expect(JSON.parse(input.value).selector.id).toBe("gone");
    });
    it("別のAE属性に変更するとフォームを撤去する", () => {
        const input = start("system.equip.rows");
        syncEnchantmentRowEditor(input, "system.description");
        expect(input.type).toBe("text"); expect(input.validationMessage).toBe("");
        expect(document.querySelector(".tnx-enchantment-rows")).toBeNull();
    });
    it("旧属性の値が残る場合は消さず、新しい操作への切替を用意する", () => {
        const form = document.createElement("form"), input = document.createElement("input");
        input.value = "melee"; form.append(input); document.body.append(form);
        syncEnchantmentRowEditor(input, "system.outfitCategories", { item });
        expect(input.value).toBe("melee"); expect(input.type).toBe("text");
        document.querySelector("button").click();
        expect(input.type).toBe("hidden"); expect(field("operation").value).toBe("add");
    });
});
