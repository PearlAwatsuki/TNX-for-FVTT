import { executionFormOf, isAttackType, attackCategoryOf } from "./usage-types.mjs";

export const SKILL_ATTACK_METHODS = Object.freeze({
    physical: "物理", mental: "精神", social: "社会",
});

export function styleSkillAttackType(system) {
    if (!system?.dealsDamage) return null;
    return { physical: "physicalAttack", mental: "mentalAttack", social: "socialAttack" }[system.attackMethod] ?? "physicalAttack";
}

/** 用途タイプに適用できる技能定義を抽出する。保存用途を書き換えない。 */
export function styleSkillUsageDefaults(system, usage) {
    const patch = {};
    const check = executionFormOf(usage) === "check";
    if (check || usage.type === "declaration") {
        for (const key of ["checkBonusSelf", "checkBonusSelfStackable", "grantsInterrupt", "interruptConsumesAr"])
            if (system[key] !== undefined) patch[key] = system[key];
        patch.allowRecheck = system.allowRecheck === true || system.checkMode === "grant";
        patch.grantRecheck = false;
        patch.modifyCheck = false;
    }
    if (check) {
        for (const key of ["allowRecheck", "allowSuitChange"])
            if (system[key] !== undefined) patch[key] = system[key];
        patch.allowRecheck = (system.allowRecheck === true) || system.checkMode === "grant";
        // 移動用途などのタイプ既定を、未指定の false で消さない。
        if (system.requiresVehicle) patch.requiresVehicle = true;
    }
    if (usage.type === "reaction") {
        for (const key of ["guardBonusSelf", "guardBonusSelfStackable"])
            if (system[key] !== undefined) patch[key] = system[key];
    }
    // 攻撃を発生させるフラグの意味は維持し、修正の提供先だけ独立に制限する。
    if (system.dealsDamage && isAttackType(usage.type)) {
        const applies = system.damageBonusCategories?.[attackCategoryOf(usage.type)] !== false;
        if (applies) {
            for (const key of ["damageBonusSelf", "damageBonusSelfStackable"])
                if (system[key] !== undefined) patch[key] = system[key];
            if (system.damageBonusSelfCondition) patch.damageBonusSelfCondition = { ...system.damageBonusSelfCondition };
        }
        if (usage.type === "physicalAttack") {
            patch.damageType = system.damageType ?? "";
            patch.canStun = system.canStun === true;
        }
    }
    return patch;
}
