import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

export class TokyoNovaMiracleSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "miracle"],
        position: { width: 600, height: 600 },
        actions: {
            incrementLevel: TokyoNovaMiracleSheet._onIncrementLevel,
            decrementLevel: TokyoNovaMiracleSheet._onDecrementLevel,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.enrichedConditionDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.item.system.usageCondition ?? "",
            { relativeTo: this.item, editable: context.editable }
        );
        return context;
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onIncrementLevel(_event, _target) {
        const usage = this.item.system.usageCount;
        const max = (usage.value || 0) + (usage.mod || 0);
        if (usage.total < max) {
            const updates = { "system.usageCount.total": usage.total + 1 };
            if (usage.total + 1 > 0) updates["system.isUsed"] = false;
            await this.item.update(updates);
        }
    }

    static async _onDecrementLevel(_event, _target) {
        const usage = this.item.system.usageCount;
        if (usage.total > 0) {
            const updates = { "system.usageCount.total": usage.total - 1 };
            if (usage.total - 1 === 0) updates["system.isUsed"] = true;
            await this.item.update(updates);
        }
    }
}
