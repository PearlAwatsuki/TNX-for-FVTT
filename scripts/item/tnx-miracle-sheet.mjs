import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaMiracleSheet extends TokyoNovaItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "miracle"],
            template: "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs",
            width: 600,
            height: 600,
            // ▼▼▼ tabs 配列に "setting" を追加 ▼▼▼
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.item.system;
        context.enrichedConditionDescription = await TextEditor.enrichHTML(this.item.system.usageCondition, { async: true, relativeTo: this.item, editable: this.isEditable });
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        EffectsSheetMixin.activateEffectListListeners(html, this.item);

        // 使用回数操作ボタンのリスナーを追加
        html.find('[data-action="increment-level"]').on('click', this._onIncrementLevel.bind(this));
        html.find('[data-action="decrement-level"]').on('click', this._onDecrementLevel.bind(this));
    }

    /**
     * 残り回数を増やす処理
     */
    async _onIncrementLevel(event) {
        event.preventDefault();
        const usage = this.item.system.usageCount;
        const max = (usage.value || 0) + (usage.mod || 0);
        // 上限（母数+修正値）を超えない範囲で+1
        if (usage.total < max) {
             const updates = { "system.usageCount.total": usage.total + 1 };
             // 回数が0より大きくなるなら、使用済みフラグを解除する
             if (usage.total + 1 > 0) updates["system.isUsed"] = false;
             await this.item.update(updates);
        }
    }

    /**
     * 残り回数を減らす処理
     */
    async _onDecrementLevel(event) {
        event.preventDefault();
        const usage = this.item.system.usageCount;
        // 0未満にならない範囲で-1
        if (usage.total > 0) {
             const updates = { "system.usageCount.total": usage.total - 1 };
             // 回数が0になるなら、使用済みフラグを立てる
             if (usage.total - 1 === 0) updates["system.isUsed"] = true;
             await this.item.update(updates);
        }
    }
}