import { describe, it, expect } from "vitest";
import { applyEnchantmentAttributes, parseEnchantmentAttribute, restoreEnchantmentEditValues } from "../../scripts/rules/enchantment-attributes.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

function outfit(changes, flags = {}) {
    const source = { img: "base.webp", system: { majorCategory: "weapon", minorCategory: "melee", additionalCategories: [], part: [], partRelation: "and", partOptional: false, description: "元", hack: { mode: "value", value: 3 }, uses: { isLimit: false, type: "" } } };
    return { documentName: "Item", type: "weapon", actor: {}, ...structuredClone(source), _source: source,
        effects: [{ id: "e1", type: "enchantment", transfer: true, flags: { [SYSTEM_ID]: flags }, system: { changes } }] };
}
const change = (key, value, type = "override") => ({ key, value, type });

describe("付与AEの構造属性", () => {
    it.each(["system.guard.mode", "system.guardValue.mode"])("受け値の方式は新旧キーを同じ属性として扱う: %s", key => {
        const item = outfit([change(key, "none", "add")]);
        item._source.system.guardValue = { mode: "value", value: 3 };
        item.system.guardValue = { mode: "value", value: 3 };
        applyEnchantmentAttributes(item);
        expect(item.system.guardValue.mode).toBe("none");
        expect(item._source.system.guardValue.mode).toBe("value");
        item.effects = [];
        applyEnchantmentAttributes(item);
        expect(item.system.guardValue.mode).toBe("value");
    });
    it("小分類から大分類も変え、保存元を保持して解除時に復元する", () => {
        const item = outfit([change("system.minorCategory", "bodyArmor")]);
        applyEnchantmentAttributes(item);
        expect(item.system).toMatchObject({ majorCategory: "armor", minorCategory: "bodyArmor" });
        expect(item._source.system.minorCategory).toBe("melee");
        const edit = structuredClone(item.system);
        restoreEnchantmentEditValues(item, edit);
        expect(edit).toMatchObject({ majorCategory: "weapon", minorCategory: "melee" });
        item.effects = [];
        applyEnchantmentAttributes(item);
        expect(item.system).toEqual(item._source.system);
    });
    it("追加カテゴリは小分類のみ受け取り、再準備で累積しない", () => {
        const item = outfit([change("system.additionalCategories", "neuralware", "add"), change("system.description", "追加", "add")]);
        applyEnchantmentAttributes(item);
        applyEnchantmentAttributes(item);
        expect(item.system.additionalCategories).toEqual([{ major: "cyberware", minor: "neuralware" }]);
        expect(item.system.description).toBe("元追加");
        expect(() => parseEnchantmentAttribute("system.additionalCategories", "cyberware")).toThrow();
    });
    it("上書き専用の真偽値は加算モードで渡されても上書きする", () => {
        const item = outfit([change("system.equip.optional", "false", "add"), change("system.uses.isLimit", "true", "add")]);
        item.system.partOptional = true;
        applyEnchantmentAttributes(item);
        expect(item.system.partOptional).toBe(false);
        expect(item.system.uses.isLimit).toBe(true);
    });
    it("部位行・専用条件の不正構造を拒否する", () => {
        expect(() => parseEnchantmentAttribute("system.equip.parts", '[null]')).toThrow();
        expect(() => parseEnchantmentAttribute("system.equip.parts", '[{"kind":"bodyPart","slots":-1}]')).toThrow();
        expect(() => parseEnchantmentAttribute("system.exclusive", '[{"type":"style","key":3}]')).toThrow();
        expect(parseEnchantmentAttribute("system.equip.parts", '[{"kind":"bodyPart","partKey":"hand","slots":1}]')).toHaveLength(1);
    });
    it("準備先用・無効化・ワールドの効果を自身へ適用しない", () => {
        for (const kind of ["parent", "disabled", "world"]) {
            const item = outfit([change("system.minorCategory", "bodyArmor")], kind === "parent" ? { applyToParent: true } : {});
            if (kind === "disabled") item.effects[0].disabled = true;
            if (kind === "world") item.actor = null;
            applyEnchantmentAttributes(item);
            expect(item.system.minorCategory).toBe("melee");
        }
    });
    it("実体化した手動付与は有効で、同一IDの非重複効果は一度だけ加算する", () => {
        const item = outfit([change("system.description", "+", "add")], { grantedFrom: "origin", effectId: "same" });
        item.effects[0].transfer = false;
        item.effects.push(structuredClone(item.effects[0]));
        applyEnchantmentAttributes(item);
        expect(item.system.description).toBe("元+");
    });
    it("条件不成立の変更と未対応値は適用しない", () => {
        const item = outfit([change("system.minorCategory[hack>=9]", "bodyArmor"), change("system.uses.type", "invalid")]);
        applyEnchantmentAttributes(item);
        expect(item.system.minorCategory).toBe("melee");
        expect(item.system.uses.type).toBe("");
    });
    it("画像はDocumentへ適用し、元画像を保持する", () => {
        const item = outfit([change("system.img", "effect.webp")]);
        applyEnchantmentAttributes(item);
        expect(item.img).toBe("effect.webp");
        item.effects = [];
        applyEnchantmentAttributes(item);
        expect(item.img).toBe("base.webp");
    });
});
