import { executionFormOf, isAttackType } from "./usage-types.mjs";

export const SKILL_ATTACK_METHODS = Object.freeze({
    physical: "物理", mental: "精神", social: "社会",
});

export function styleSkillAttackType(system) {
    if (!system?.dealsDamage) return null;
    return { physical: "physicalAttack", mental: "mentalAttack", social: "socialAttack" }[system.attackMethod] ?? "physicalAttack";
}

/** 親技能の設定を新しい用途へ一度だけ複写する。組み合わせ技能の修正値はここでは加算しない。 */
export function styleSkillUsageDefaults(system, usage) {
    const patch = {};
    const check = executionFormOf(usage) === "check";
    if (check || usage.type === "declaration") {
        for (const key of ["checkBonusSelf", "checkBonusSelfStackable", "grantsInterrupt", "interruptConsumesAr"])
            if (system[key] !== undefined) patch[key] = system[key];
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
    if (system.dealsDamage && isAttackType(usage.type)) {
        for (const key of ["damageBonusSelf", "damageBonusSelfStackable"])
            if (system[key] !== undefined) patch[key] = system[key];
        if (system.damageBonusSelfCondition) patch.damageBonusSelfCondition = { ...system.damageBonusSelfCondition };
        if (usage.type === "physicalAttack") {
            patch.damageType = system.damageType ?? "";
            patch.canStun = system.canStun === true;
        }
    }
    return patch;
}

/** 新しく参加した技能だけを一度読み取る。親自身は用途の専用欄で扱う。 */
export function applyRegisteredSkillDefaults(previous, usage, parentId, getItem) {
    const members = value => new Set([
        parentId, value.baseSkillRef?.itemId, ...(value.skillRefs ?? []).map(ref => ref.itemId),
    ].filter(Boolean));
    const before = members(previous);
    for (const id of members(usage)) {
        if (before.has(id)) continue;
        const item = getItem(id);
        if (item?.type !== "styleSkill") continue;
        const system = item.system;
        const defaults = styleSkillUsageDefaults(system, usage);
        for (const key of ["allowRecheck", "allowSuitChange", "requiresVehicle", "canStun"])
            if (defaults[key]) usage[key] = true;
        if (defaults.grantsInterrupt) {
            usage.grantsInterrupt = true;
            usage.interruptConsumesAr = defaults.interruptConsumesAr !== false;
        }
        if (defaults.grantRecheck || defaults.modifyCheck) {
            usage.grantRecheck = defaults.grantRecheck;
            usage.modifyCheck = defaults.modifyCheck;
        }
        if (defaults.damageType) usage.damageType = defaults.damageType;
        for (const [self, rows] of [["checkBonusSelf", "checkBonuses"], ["damageBonusSelf", "damageBonuses"]]) {
            const formula = String(defaults[self] ?? "").trim();
            if (!formula) continue;
            const source = system.identificationKey;
            if (!source) throw new Error(`ボーナス供給元「${item.name}」に識別キーを設定してください。`);
            const row = {
                formula: formula.replace(/@item\.self\b/g, () => `@item.${source}`),
                source, stackable: defaults[`${self}Stackable`] === true,
                ...(rows === "damageBonuses" ? { targetCondition: { ...defaults.damageBonusSelfCondition } } : {}),
            };
            const current = usage[rows] ?? [];
            if (!current.some(existing => existing.source === source && existing.formula === row.formula))
                usage[rows] = [...current, row];
        }
    }
}
