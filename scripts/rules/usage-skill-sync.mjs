import { styleSkillUsageDefaults } from "./style-skill-usage-defaults.mjs";

const flags = ["allowRecheck", "allowSuitChange", "requiresVehicle", "canStun", "grantsInterrupt"];

/** Rebuild supplied settings without evaluating formulas or reading source usages. */
export function syncUsageSkills(usage, parent, getItem) {
    const previous = usage.skillSettingsSync ?? {};
    const ids = [...new Set([parent.id, usage.baseSkillRef?.itemId,
        ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean))];
    const skills = ids.map(id => id === parent.id ? parent : getItem(id))
        .filter(i => i?.type === "styleSkill");
    const settings = skills.map(item => ({ item, data: styleSkillUsageDefaults(item.system, usage) }));
    const sources = new Set([...(previous.sources ?? []),
        ...skills.map(i => i.system.identificationKey).filter(Boolean)]);
    for (const [self, rows] of [["checkBonusSelf", "checkBonuses"], ["damageBonusSelf", "damageBonuses"]]) {
        usage[rows] = (usage[rows] ?? []).filter(r => !sources.has(r.source));
        for (const { item, data } of settings) {
            if (item.id === parent.id) {
                usage[self] = data[self] ?? "";
                usage[`${self}Stackable`] = data[`${self}Stackable`] === true;
                if (self === "damageBonusSelf") usage.damageBonusSelfCondition = data.damageBonusSelfCondition ?? { kind: "none", mode: "exclude", key: "" };
            } else if (data[self] && item.system.identificationKey) {
                const source = item.system.identificationKey;
                usage[rows].push({ source, formula: String(data[self]).replace(/@item\.self\b/g, () => `@item.${source}`),
                    stackable: data[`${self}Stackable`] === true,
                    ...(self === "damageBonusSelf" ? { targetCondition: data.damageBonusSelfCondition ?? { kind: "none", mode: "exclude", key: "" } } : {}) });
            }
        }
    }
    const local = { ...(previous.local ?? {}) };
    for (const key of flags) {
        // Keep explicit usage settings separately from contributions, so removal is reversible.
        if (previous.flags?.[key] === undefined || usage[key] !== previous.flags[key]) local[key] = usage[key] === true;
        if (!previous.flags && (settings.some(s => s.data[key])
            || (key === "allowRecheck" && settings.some(s => s.item.system.checkMode === "grant")))) local[key] = false;
        usage[key] = local[key] === true || settings.some(s => s.data[key] === true);
    }
    if (settings.some(s => s.item.system.allowRecheck || s.item.system.checkMode === "grant")) usage.allowRecheck = true;
    if (settings.some(s => s.data.grantsInterrupt))
        usage.interruptConsumesAr = settings.some(s => s.data.grantsInterrupt && s.data.interruptConsumesAr !== false);
    usage.damageTypeOptions = [...new Set(settings.map(s => s.data.damageType).filter(t => ["S", "P", "I", "X"].includes(t)))];
    if (usage.damageTypeOptions.length) usage.damageType = usage.damageTypeOptions[0];
    else if (previous.damageTypes?.includes(usage.damageType)) usage.damageType = "";
    usage.skillSettingsSync = { sources: skills.map(i => i.system.identificationKey).filter(Boolean), local,
        flags: Object.fromEntries(flags.map(k => [k, usage[k]])), damageTypes: usage.damageTypeOptions };
    return usage;
}
