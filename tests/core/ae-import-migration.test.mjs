import { describe, expect, it } from "vitest";
import { planImportedItemAEData } from "../../scripts/core/ae-import-migration.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

describe("旧Itemのインポート変換", () => {
    it("コピーのAE型・属性・用途式を変換し、元データを保持する", () => {
        const source = { _id: "w", type: "weapon", system: { slots: [{ kind: "normal" }], actions: [{ damageBonusSelf: "@life.total" }] },
            effects: [{ _id: "e", changes: [{ key: "system.slots.0.count.value", value: "2" }] }] };
        const before = structuredClone(source);
        const plan = planImportedItemAEData(source);
        expect(plan.issues).toEqual([]);
        expect(plan.data.effects[0].type).toBe("enchantment");
        expect(plan.data.effects[0].changes[0].key).toBe("system.slot.capacity");
        expect(plan.data.system.actions[0].damageBonusSelf).toBe("@abilities.life.value");
        expect(source).toEqual(before);
        expect(planImportedItemAEData(plan.data).changed).toBe(false);
    });
    it("準備先フラグは付与型へ変更し、未解決参照のあるItemは全体を保持する", () => {
        const source = { type: "weapon", system: {}, effects: [{ _id: "e", flags: { [SYSTEM_ID]: { applyToParent: true } },
            changes: [{ key: "system.attack", value: "3" }] }] };
        expect(planImportedItemAEData(source).data.effects[0].type).toBe("enchantment");
        source.effects[0].changes[0].value = "@item.missing.system.levelTotal";
        expect(planImportedItemAEData(source)).toMatchObject({ data: source, changed: false });
    });
});
