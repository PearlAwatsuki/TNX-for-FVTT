import { describe, it, expect } from "vitest";
import { planFormulaKeyMigration, planItemFormulaMigration } from "../../scripts/core/formula-key-migration.mjs";
import { planEffectKeyMigration } from "../../scripts/core/ae-key-migration.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
const skill = { _id: "s", type: "generalSkill", system: { identificationKey: "melee" } };
const outfit = { _id: "w", type: "weapon", system: { identificationKey: "sword" } };
describe("式キーの移行", () => {
    it("旧部位指定の関係と消費数を新キーへ分ける", () => {
        const plan = planEffectKeyMigration({ changes: [{ key: "system.part.hand[hack>=3]", value: "or:2" }] }, { bearer: outfit });
        expect(plan.data.changes[0]).toMatchObject({ key: "system.equip.alternative.hand[hack>=3]", value: "2" });
    });
    it("素値と実効値を区別し、算術・空白を維持する", () => {
        const formula = "floor(@system.life.total / 2) + @diff + @item.self.system.levelTotal";
        const plan = planFormulaKeyMigration(formula, { bearer: skill });
        expect(plan.value).toBe("floor(@abilities.life.value / 2) + @check.margin + @skill.melee.level");
        expect(planFormulaKeyMigration("@system.life.value + @item.self.system.level", { bearer: skill }).value).toBe("@abilities.life.base + @skill.melee.base");
        expect(planFormulaKeyMigration(plan.value, { bearer: skill }).changed).toBe(false);
    });
    it("不明参照を含む式を部分変換しない", () => {
        const formula = "@diff + @item.unknown.system.attack.total";
        expect(planFormulaKeyMigration(formula)).toMatchObject({ value: formula, changed: false });
        expect(planFormulaKeyMigration(formula).issues).toHaveLength(1);
    });
    it("アウトフィットの識別キー参照は維持し、自己参照と区別", () => {
        expect(planFormulaKeyMigration("@item.sword.system.attack.total + @item.self.system.attack.value", { items: [outfit], bearer: outfit }).value)
            .toBe("@outfit.sword.attack.value + @item.attack.base");
    });
    it("用途・使用回数だけを書き換え、説明文は変更しない", () => {
        const source = { ...skill, system: { ...skill.system, description: "@diff の説明", uses: { max: "@item.self.system.levelTotal" }, actions: [{ _id: "u", checkBonusSelf: "@card", damageBonuses: [{ formula: "@diff", stackable: true }] }] } };
        const plan = planItemFormulaMigration(source);
        expect(plan.data.system.description).toBe("@diff の説明");
        expect(plan.data.system.uses.max).toBe("@skill.melee.level");
        expect(plan.data.system.actions[0]).toMatchObject({ _id: "u", checkBonusSelf: "@check.card", damageBonuses: [{ formula: "@check.margin", stackable: true }] });
        expect(source.system.actions[0].checkBonusSelf).toBe("@card");
    });
    it("AE移設で旧保持元への相対参照を付与先参照に変えてしまわない", () => {
        const target = { _id: "t", type: "weapon", system: { identificationKey: "target" } };
        const source = { _id: "e", changes: [{ key: "item.target.system.attack.value", value: "@item.self.system.attack.total" }] };
        const plan = planEffectKeyMigration(source, { items: [outfit, target], bearer: outfit });
        expect(plan.destination).toBe("t");
        expect(plan.data.changes[0].value).toBe("@outfit.sword.attack.value");
    });
    it("旧自己属性を付与AEへ移し、既存の手動ドロップ設定は保持する", () => {
        const source = { _id: "e", changes: [{ key: "system.attack.value", value: "2" }] };
        const plan = planEffectKeyMigration(source, { bearer: outfit });
        expect(plan.data.type).toBe("enchantment");
        expect(plan.data.flags[SYSTEM_ID].applyToSelf).toBe(true);
        const manual = { ...plan.data, transfer: false, flags: { [SYSTEM_ID]: { applyToSelf: false, applyToParent: false } } };
        expect(planEffectKeyMigration(manual, { bearer: outfit }).data.flags[SYSTEM_ID].applyToSelf).toBe(false);
    });
    it("条件付きの旧技能属性を条件を失わず移す", () => {
        const plan = planEffectKeyMigration({ _id: "e", changes: [{ key: "item.melee[hack>=3].system.level", value: "2" }] }, { items: [skill] });
        expect(plan.data.changes[0].key).toBe("system.skill.melee.level[hack>=3]");
    });
});
