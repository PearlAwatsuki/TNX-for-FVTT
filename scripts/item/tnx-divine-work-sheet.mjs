import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaDivineWorkSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "divine-work"],
            template: "systems/tokyo-nova-axleration/templates/item/divine-work-sheet.hbs",
            width: 560,
            height: 520,
            // ▼▼▼ tabs 配列に "setting" を追加 ▼▼▼
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.item.system;
        context.enrichedDescription = await TextEditor.enrichHTML(this.item.system.description, { async: true, relativeTo: this.item, editable: this.isEditable });
        context.enrichedConditionDescription = await TextEditor.enrichHTML(this.item.system.usageCondition, { async: true, relativeTo: this.item, editable: this.isEditable });
        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive
        ];
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        EffectsSheetMixin.activateEffectListListeners(html, this.item);
    }
}