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
        // 残り使用回数 = uses.max − spent(2026-07-18 uses 一本化)。実効 max は system(AE込み)から
        const uses = this.item.system.uses ?? {};
        context.miracleMax       = Math.max(0, Number(uses.max) || 0);
        context.miracleRemaining = Math.max(0, context.miracleMax - (Number(uses.spent) || 0));
        return context;
    }

    // ─── アクションハンドラ(残り使用回数の増減 = spent の調整) ──────────────────

    static async _onIncrementLevel(_event, _target) {
        const uses = this.item.system.uses ?? {};
        const spent = Number(uses.spent) || 0;
        if (spent > 0) {   // 残りを+1 = spent を1減らす
            await this.item.update({ "system.uses.spent": spent - 1, "system.isUsed": false });
        }
    }

    static async _onDecrementLevel(_event, _target) {
        const uses = this.item.system.uses ?? {};
        const max = Math.max(0, Number(uses.max) || 0);
        const spent = Number(uses.spent) || 0;
        if (spent < max) {   // 残りを-1 = spent を1増やす
            const newSpent = spent + 1;
            await this.item.update({ "system.uses.spent": newSpent, "system.isUsed": newSpent >= max });
        }
    }
}
