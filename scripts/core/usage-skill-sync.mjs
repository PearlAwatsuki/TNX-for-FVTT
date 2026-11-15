/** Skill changes invalidate open views; they never rewrite saved usages. */
export function registerUsageSkillSync() {
    const refresh = () => {
        for (const app of foundry.applications.instances?.values() ?? []) {
            if (app._usageId && app._item && app.rendered) app.render({ force: true });
        }
    };
    Hooks.on("updateItem", refresh);
    Hooks.on("createItem", refresh);
    Hooks.on("deleteItem", refresh);
}
