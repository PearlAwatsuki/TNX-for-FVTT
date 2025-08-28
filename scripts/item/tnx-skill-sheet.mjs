import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaSkillSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "skill"],
            template: "systems/tokyo-nova-axleration/templates/item/skill-sheet.hbs",
            width: 580,
            height: 650,
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

        // エフェクトタブ用のデータ準備は変更ありません
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

        // アクティブエフェクトのボタンにリスナーを登録 (Mixinから呼び出し)
        EffectsSheetMixin.activateEffectListListeners(html, this.item);
    }
}