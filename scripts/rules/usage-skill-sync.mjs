import { styleSkillUsageDefaults } from "./style-skill-usage-defaults.mjs";

export const USAGE_SETTINGS_VERSION = 1;
const permissions = ["allowRecheck", "allowSuitChange", "canStun", "grantsInterrupt"];
export const USAGE_SKILL_FIELDS = ["checkBonusSelf", "checkBonusSelfStackable", "checkBonuses",
    "damageBonusSelf", "damageBonusSelfStackable", "damageBonusSelfCondition", "damageBonuses",
    ...permissions, "requiresVehicle", "interruptConsumesAr", "damageType", "damageTypeOptions"];
const copy = value => structuredClone(value);

/** An exact match with today's skill is not proof of provenance. */
export function diagnoseUsageSettings(usage) {
    return { needsReview: usage.settingsVersion !== USAGE_SETTINGS_VERSION,
        fields: USAGE_SKILL_FIELDS.filter(key => Object.hasOwn(usage, key)),
        hasSyncHistory: Object.keys(usage.skillSettingsSync ?? {}).length > 0 };
}

/** Pure resolution: local inputs persist; contributions and effective settings do not. */
export function resolveUsageSettings(usage, parent, getItem = () => null) {
    const local = copy(usage.usageSettingsInput ?? usage);
    delete local.usageSettingsInput;
    const effective = copy(local);
    const diagnostics = [];
    const contributions = { checkBonuses: [], damageBonuses: [] };
    effective.usageSettingsInput = copy(local);
    if (diagnoseUsageSettings(local).needsReview) {
        diagnostics.push({ code: "legacy-settings", message: "旧用途の保存値を保持しています。技能由来と用途固有の設定を確認して個別移行してください。" });
        return { local, effective, contributions, diagnostics };
    }
    const ids = [...new Set([parent.id, local.baseSkillRef?.itemId,
        ...(local.skillRefs ?? []).map(ref => ref.itemId)].filter(Boolean))];
    const skills = ids.map(id => id === parent.id ? parent : getItem(id)).filter(item => item?.type === "styleSkill");
    const settings = skills.map(item => ({ item, data: styleSkillUsageDefaults(item.system, local) }));
    for (const [self, rows] of [["checkBonusSelf", "checkBonuses"], ["damageBonusSelf", "damageBonuses"]]) {
        for (const { item, data } of settings) {
            const formula = String(data[self] ?? "").trim();
            if (!formula) continue;
            const source = item.system.identificationKey ?? "";
            if (item.id !== parent.id && !source && /@item\.self\b/.test(formula)) {
                diagnostics.push({ code: "missing-formula-key", error: true, itemId: item.id,
                    message: `「${item.name ?? item.id}」の修正式には識別キーが必要です。` });
                continue;
            }
            contributions[rows].push({ source, label: item.name ?? item.id,
                formula: item.id === parent.id ? formula : formula.replace(/@item\.self\b/g, () => `@item.${source}`),
                stackable: data[`${self}Stackable`] === true,
                origin: { kind: "skill", itemId: item.id, field: self },
                ...(rows === "damageBonuses" ? { targetCondition: copy(data.damageBonusSelfCondition ?? { kind: "none", mode: "exclude", key: "" }) } : {}) });
        }
        // source is attribution, never ownership. Even identical manual rows are preserved.
        effective[rows] = [...(local[rows] ?? []).map((row, index) => ({ ...copy(row),
            origin: { kind: "usage", field: rows, index } })), ...contributions[rows]];
    }
    for (const key of permissions) effective[key] = local[key] === true || settings.some(s => s.data[key] === true);
    // All supplied requirements must be met. This flag is a requirement, not a permission.
    effective.requiresVehicle = local.requiresVehicle === true || settings.some(s => s.data.requiresVehicle === true);
    const providers = [local, ...settings.map(s => s.data)].filter(s => s.grantsInterrupt === true);
    if (providers.length) effective.interruptConsumesAr = providers.some(s => s.interruptConsumesAr !== false);
    const types = [local.damageType, ...(local.damageTypeOptions ?? []), ...settings.map(s => s.data.damageType)].filter(t => ["S", "P", "I", "X"].includes(t));
    effective.damageTypeOptions = [...new Set(types)];
    effective.damageType = local.damageType || effective.damageTypeOptions[0] || "";
    return { local, effective, contributions, diagnostics };
}

/** Compatibility name: no mutation and no persistence. */
export function syncUsageSkills(usage, parent, getItem) {
    return resolveUsageSettings(usage, parent, getItem).effective;
}

/** Explicit decisions, separate from diagnosis. Store the complete original for restoration. */
export function migrateUsageSettings(usage, decisions) {
    if (!diagnoseUsageSettings(usage).needsReview) throw new Error("この用途は移行済みです。");
    const result = copy(usage);
    for (const key of USAGE_SKILL_FIELDS) {
        const choice = decisions[key];
        if (!choice || !["keep", "replace"].includes(choice.action)) throw new Error(`未確認の設定: ${key}`);
        if (choice.action === "replace") result[key] = copy(choice.value);
    }
    result.settingsVersion = USAGE_SETTINGS_VERSION;
    result.settingsBackup = copy(usage);
    delete result.skillSettingsSync;
    return result;
}

export function restoreUsageSettings(usage) {
    if (!usage.settingsBackup) throw new Error("移行前のバックアップがありません。");
    return copy(usage.settingsBackup);
}
