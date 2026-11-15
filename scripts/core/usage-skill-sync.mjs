import { syncUsageSkills } from "../rules/usage-skill-sync.mjs";
import { resolveUsageSiblingSkills, updateUsageActions } from "./usage-derivation.mjs";

// SchemaField may reorder keys after persistence. Compare values, not insertion order.
export function settingsFingerprint(value) {
    return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

export async function synchronizeItemUsages(item) {
    if (!item.system?.actions?.length) return;
    const siblings = await resolveUsageSiblingSkills(item);
    const byId = new Map(siblings.map(s => [s.id, s]));
    await updateUsageActions(item, actions => {
        const before = settingsFingerprint(actions);
        for (const usage of actions) syncUsageSkills(usage, item, id => byId.get(id));
        return settingsFingerprint(actions) === before ? null : actions;
    });
}

export function registerUsageSkillSync() {
    const refresh = async (item, _change, _options, userId, deleted = false) => {
        if (userId !== game.user.id) return;
        if (item.type !== "styleSkill" && !item.system?.actions?.length) return;
        try {
            const targets = item.actor ? [...item.actor.items] :
                [...new Set([item, ...(game.items ?? []), ...await resolveUsageSiblingSkills(item)])];
            for (const target of targets) {
                if (deleted && target.uuid === item.uuid) continue;
                if (!target.isOwner || (target.pack && game.packs.get(target.pack)?.locked)) continue;
                if (target.id === item.id || target.system?.actions?.some(u =>
                    u.baseSkillRef?.itemId === item.id || u.skillRefs?.some(r => r.itemId === item.id)
                    || u.skillSettingsSync?.sources?.includes(item.system.identificationKey)))
                    await synchronizeItemUsages(target);
            }
        } catch (error) { console.error("TNX | Usage skill synchronization failed", error); ui.notifications.error("用途への技能設定の反映に失敗しました。"); }
    };
    Hooks.on("updateItem", refresh);
    Hooks.on("createItem", (item, options, userId) => refresh(item, {}, options, userId));
    Hooks.on("deleteItem", (item, options, userId) => refresh(item, {}, options, userId, true));
}
