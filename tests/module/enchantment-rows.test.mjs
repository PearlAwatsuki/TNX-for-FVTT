// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncEnchantmentRowEditor } from "../../scripts/ui/enchantment-rows.mjs";
vi.mock("../../scripts/dictionary/outfit-dictionary.mjs", () => ({ loadOutfitHostChoices: async () => ({ gun: "銃" }) }));
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", () => ({ STYLE_PACK: "styles", ORGANIZATION_PACK: "organizations", loadSkillChoices: async () => ({ kabuto: "カブト" }) }));
afterEach(() => document.body.replaceChildren());
function input(value = "") {
    const form = document.createElement("form");
    const field = document.createElement("input");
    field.name = "system.changes.0.value";
    field.value = value;
    form.append(field); document.body.append(form);
    return field;
}
const edit = (selector, value) => { selector.value = value; selector.dispatchEvent(new Event("change", { bubbles: true })); };
describe("付与AEの行編集", () => {
    it("部位を追加し、身体部位のキーと表示名を送信する", () => {
        const field = input();
        syncEnchantmentRowEditor(field, "system.equip.parts", { partSlots: [{ key: "hand", value: "片手持ち" }] });
        document.querySelector('[aria-label="行を追加"]').click();
        edit(document.querySelector('[data-field="partKey"]'), "hand");
        expect(JSON.parse(field.value)).toEqual([{ kind: "bodyPart", partKey: "hand", value: "片手持ち", slots: 1, requirement: "and", optional: false }]);
        expect([...new FormData(field.form).keys()]).toEqual(["system.changes.0.value"]);
        document.querySelector('[aria-label="この行を削除"]').click();
        expect(field.value).toBe("[]");
    });
    it("専用条件を辞典から選択し、別キーに変えると行UIを撤去する", async () => {
        const field = input('[{"type":"style","key":""}]');
        syncEnchantmentRowEditor(field, "system.exclusive");
        await Promise.resolve();
        edit(document.querySelector('[data-field="key"]'), "kabuto");
        expect(JSON.parse(field.value)).toEqual([{ type: "style", key: "kabuto" }]);
        syncEnchantmentRowEditor(field, "system.description");
        expect(field.type).toBe("text");
        expect(document.querySelector(".tnx-enchantment-rows")).toBeNull();
    });
    it("壊れた保存値を空の配列で上書きしない", () => {
        const field = input("invalid");
        syncEnchantmentRowEditor(field, "system.equip.parts");
        expect(field.type).toBe("text");
        expect(field.value).toBe("invalid");
    });
});
