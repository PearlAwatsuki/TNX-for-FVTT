import { describe, it, expect } from "vitest";
import { toPublicEffectKey, toRuntimeEffectKey, actorEffectKeySuggestions } from "../../scripts/rules/ae-public-keys.mjs";
import { parseEffectTargetKey, itemChangeTargets, resolveItemTotalPath } from "../../scripts/data/item/helpers.mjs";
import { buildFormulaData } from "../../scripts/rules/tnx-formula.mjs";

describe("AE公開キー", () => {
    it.each(["check.all", "damage.taken.S", "ignore.bs.poison", "system.ability.life", "system.control.reason", "system.partSlot.arm", "name"])("%s は既存の適用先と条件を保持する", key => {
        const old = `${key}[hack>=3]`;
        const next = toPublicEffectKey(old);
        expect(parseEffectTargetKey(next)).toEqual(parseEffectTargetKey(old));
        expect(toPublicEffectKey(next)).toBe(next);
        expect(toRuntimeEffectKey(next)).toBe(old);
    });
    it("技能専用キーを同じ識別キーのアウトフィットへ転送しない", () => {
        const parsed = parseEffectTargetKey("system.skill.melee.level");
        expect(itemChangeTargets(parsed, { type: "generalSkill", system: { identificationKey: "melee" } })).toBe(true);
        expect(itemChangeTargets(parsed, { type: "weapon", system: { identificationKey: "melee" } })).toBe(false);
    });
    it("スロットを配列位置でなく種別から解決し、不在なら適用しない", () => {
        const system = { slots: [{ kind: "software" }, { kind: "normal" }] };
        expect(resolveItemTotalPath("slot.capacity", system)).toBe("slots.1.count.total");
        expect(resolveItemTotalPath("slot.software.capacity", system)).toBe("slots.0.count.total");
        expect(resolveItemTotalPath("slot.hardware.capacity", system)).toBeNull();
    });
    it("技能の実キー・名称を候補にし、空キーやアウトフィットは除く", () => {
        const skill = { type: "generalSkill", name: "白兵", system: { identificationKey: "melee" } };
        const rows = actorEffectKeySuggestions({ items: [skill, skill, { ...skill, system: {} }, { type: "weapon", system: { identificationKey: "sword" } }] });
        expect(rows.filter(r => r.key === "system.skill.melee.level")).toEqual([{ key: "system.skill.melee.level", label: "白兵 技能レベル melee" }]);
        expect(rows.some(r => r.key.includes("sword") || r.key.includes("<key>"))).toBe(false);
    });
    it("式の技能・能力・アウトフィット参照は実効値を返す", () => {
        const data = buildFormulaData({ system: { life: { value: 3, total: 6 } }, items: [
            { type: "generalSkill", system: { identificationKey: "melee", level: 1, levelTotal: 4 } },
            { type: "weapon", system: { identificationKey: "sword", attack: { value: 2, total: 7 } } },
        ] }, { diff: 5 });
        expect(data.abilities.life).toMatchObject({ value: 6, base: 3 });
        expect(data.skill.melee.level).toBe(4);
        expect(data.outfit.sword.attack.value).toBe(7);
        expect(data.check.margin).toBe(5);
    });
});
