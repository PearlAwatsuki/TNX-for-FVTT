import { describe, it, expect } from "vitest";
import { planEffectKeyMigration } from "../../scripts/core/ae-key-migration.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

describe("AEキー移行の事前計画", () => {
    it("技能の自己実効レベルも正準キーへ変換する", () => {
        const bearer = { type: "generalSkill", system: { identificationKey: "melee" } };
        const plan = planEffectKeyMigration({ _id: "e", changes: [{ key: "system.levelTotal[hack>=3]", value: "2" }] }, { bearer });
        expect(plan.issues).toEqual([]);
        expect(plan.data.changes[0].key).toBe("system.skill.melee.level[hack>=3]");
        expect(planEffectKeyMigration(plan.data, { bearer }).changed).toBe(false);
    });
    it("通常スロットの旧normal表記を条件を保って除く", () => {
        const plan = planEffectKeyMigration({ _id: "e", changes: [{ key: "system.slot.normal.capacity[hack>=3]", value: "2" }] },
            { bearer: { type: "weapon", system: {} } });
        expect(plan.data.changes[0].key).toBe("system.slot.capacity[hack>=3]");
        expect(plan.data.type).toBe("enchantment");
        expect(planEffectKeyMigration(plan.data, { bearer: { type: "weapon", system: {} } }).changed).toBe(false);
    });
    it("V14のchangesとID・優先度・持続を保持し、準備先指定を付与AEへ変換", () => {
        const source = { _id: "e", transfer: false, system: { changes: [{ key: "system.guardValue", type: "add", value: "3", priority: 7 }] }, flags: { [SYSTEM_ID]: { applyToParent: true, stackable: true, tnxDuration: "act" } } };
        const before = structuredClone(source);
        const plan = planEffectKeyMigration(source);
        expect(source).toEqual(before);
        expect(plan.data).toMatchObject({ _id: "e", type: "enchantment", transfer: false, system: { changes: [{ key: "system.guard.value", type: "add", value: "3", priority: 7 }] }, flags: { [SYSTEM_ID]: { applyToParent: true, applyToSelf: false, effectId: "e", stackable: true, tnxDuration: "act" } } });
        expect(planEffectKeyMigration(plan.data).changed).toBe(false);
    });
    it("技能の旧キーを通常AEの技能キーへ変える", () => {
        const plan = planEffectKeyMigration({ _id: "e", changes: [{ key: "item.melee.system.levelTotal", value: "2" }] }, { items: [{ type: "generalSkill", system: { identificationKey: "melee" } }] });
        expect(plan.data.changes[0].key).toBe("system.skill.melee.level");
        expect(plan.data.type).toBeUndefined();
        expect(plan.destination).toBeNull();
    });
    it("アウトフィット指定は配置変更として返し、元IDを保持", () => {
        const plan = planEffectKeyMigration({ _id: "e", changes: [{ key: "item.sword.system.attack.value", value: "2" }] }, { items: [{ type: "weapon", uuid: "Actor.a.Item.w", system: { identificationKey: "sword" } }] });
        expect(plan.destination).toBe("Actor.a.Item.w");
        expect(plan.data).toMatchObject({ _id: "e", type: "enchantment", changes: [{ key: "system.attack.value" }], flags: { [SYSTEM_ID]: { effectId: "e", applyToSelf: true, applyToParent: false } } });
    });
    it.each([{ items: [] }, { items: [{ type: "weapon", system: { identificationKey: "missing" } }, { type: "weapon", system: { identificationKey: "missing" } }] }])("参照先不明・複数候補なら原文全体を保持", ({ items }) => {
        const source = { _id: "e", changes: [{ key: "check.all", value: "1" }, { key: "item.missing.system.attack", value: "2" }] };
        const plan = planEffectKeyMigration(source, { items });
        expect(plan.issues.length).toBeGreaterThan(0);
        expect(plan.data).toEqual(source);
        expect(plan.changed).toBe(false);
    });
    it("ステータスを持つ付与AE候補は削除せず報告", () => {
        const source = { _id: "e", statuses: ["poison"], flags: { [SYSTEM_ID]: { applyToParent: true } } };
        expect(planEffectKeyMigration(source)).toMatchObject({ changed: false, data: source });
    });
});
