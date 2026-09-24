/** 読取専用パック由来のItemを、作成時のコピー上で移行する。配布元は書き換えない。 */
import { planEffectKeyMigration } from "./ae-key-migration.mjs";
import { planItemFormulaMigration } from "./formula-key-migration.mjs";

export function planImportedItemAEData(source, { items = [] } = {}) {
    const context = { items, bearer: source };
    const formulas = planItemFormulaMigration(source, context);
    const issues = [...formulas.issues];
    const data = formulas.data;
    data.effects = (source.effects ?? []).map(effect => {
        const plan = planEffectKeyMigration(effect, context);
        issues.push(...plan.issues.map(issue => ({ effectId: effect._id, ...issue })));
        if (plan.destination) issues.push({ effectId: effect._id, reason: "別文書へのAE移設が必要なためインポート時には移設しない" });
        return plan.data;
    });
    if (issues.length) return { data: structuredClone(source), changed: false, issues };
    return { data, changed: JSON.stringify(source) !== JSON.stringify(data), issues };
}

export function migrateImportedItem(item, _data, options) {
    if (options?.tnxAEMigration) return;
    const source = item.toObject();
    const plan = planImportedItemAEData(source, { items: item.parent?.items ?? [] });
    if (plan.issues.length) {
        console.warn("TNX | インポートしたItemのAEに未解決の旧キーがあります", item.name, plan.issues);
        ui.notifications.warn(`「${item.name}」の旧AEに自動変換できない参照があります。移行診断で確認してください。`);
        return;
    }
    if (!plan.changed) return;
    const Replacement = foundry.data.operators.ForcedReplacement;
    item.updateSource({ system: Replacement.create(plan.data.system ?? {}), effects: Replacement.create(plan.data.effects) });
}
