import { describe, expect, it } from "vitest";
import { buildParryGuardSnapshot, effectiveGuardValue, effectiveUnarmedGuardValue, isParryWeaponEligible, resolveParryWeapons } from "../../scripts/rules/parry-weapons.mjs";

const weapon = (id, value) => ({ id, uuid: `Actor.a.Item.${id}`, name: id, system: { guardValue: { mode: "value", total: value } } });
const actor = (items, baseGuard = { value: 0, mod: 0 }) => ({ items: new Map(items.map(i => [i.id, i])), system: { baseGuard } });

describe("パリー用途の使用武器", () => {

    it("weaponRefs が空なら生身を武器として解決する", () => {
        const user = actor([], { value: 2, mod: 1 });
        const refs = resolveParryWeapons(user, { weaponRefs: [] });
        const result = buildParryGuardSnapshot(user, { weaponRefs: [] });
        expect(refs).toEqual([{ id: "", item: null, unarmed: true }]);
        expect(effectiveUnarmedGuardValue(user)).toBe(3);
        expect(result.invalid).toEqual([]);
        expect(result.weapons).toEqual([{ itemId: "", uuid: "", name: "生身", guardValue: 3, unarmed: true }]);
        expect(result.base).toBe(3);
    });

    it("戦闘タブを参照せず用途の weaponRefs だけを解決する", () => {
        const a = weapon("a", 3), b = weapon("b", 2), c = weapon("sheet", 99);
        const user = actor([a, b, c]);
        user.system = { weaponRefs: { parryItemId: "sheet" } };
        const refs = resolveParryWeapons(user, { weaponRefs: [{ itemId: "a" }, { itemId: "b" }] });
        expect(refs.map(r => r.id)).toEqual(["a", "b"]);
    });

    it("同じ Item ID を一度だけ合算する", () => {
        const a = weapon("a", 3), b = weapon("b", 2);
        const result = buildParryGuardSnapshot(actor([a, b]), { weaponRefs: [{ itemId: "a" }, { itemId: "a" }, { itemId: "b" }] });
        expect(result.base).toBe(5);
        expect(result.weapons).toHaveLength(2);
    });

    it("受け値0の武器をパリー可能として合算する", () => {
        const zero = { ...weapon("zero", 0), type: "weapon" };
        const result = buildParryGuardSnapshot(actor([zero]), { weaponRefs: [{ itemId: "zero" }] });
        expect(result.invalid).toEqual([]);
        expect(result.base).toBe(0);
        expect(result.weapons).toHaveLength(1);
        expect(isParryWeaponEligible(zero)).toBe(true);
    });

    it("受け値が「-」の参照を不備として返す", () => {
        const bad = { id: "bad", name: "bad", system: {} };
        const result = buildParryGuardSnapshot(actor([bad]), { weaponRefs: [{ itemId: "bad" }] });
        expect(result.base).toBe(0);
        expect(result.invalid).toHaveLength(1);
        expect(effectiveGuardValue(bad)).toBeNull();
    });
});
