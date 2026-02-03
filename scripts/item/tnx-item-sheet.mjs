import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { UsageCreationDialog } from "../module/tnx-dialog.mjs";


/**
 * Tokyo NOVA アイテムシートの基底クラス
 * 用途(Actions)タブの処理や共通のエフェクト処理を提供します。
 */
export class TokyoNovaItemSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            width: 600,
            height: 650,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }]
        });
    }

    /**
     * 用途の種類の定義
     */
    static get usageTypes() {
        return {
            "check": "判定",
            "declaration": "宣言",
            "miracle": "神業"
        };
    }

    async getData(options) {
        const context = await super.getData(options);
        const system = foundry.utils.deepClone(this.item.system);
        context.system = system;
        
        // context.options を初期化し、usageTypes を設定
        context.options = context.options || {};
        context.options.usageTypes = this.constructor.usageTypes;

        // 解説のエンリッチ
        context.enrichedDescription = await TextEditor.enrichHTML(system.description, { async: true, relativeTo: this.item, editable: this.isEditable });

        // エフェクトタブの共通処理
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

        html.find('.action-create').on('click', this._onActionCreate.bind(this));
        html.find('.action-delete').on('click', this._onActionDelete.bind(this));
    }

    async _onActionCreate(event) {
        event.preventDefault();
        
        // クラス定義から用途のリストを取得
        const usageTypes = this.constructor.usageTypes;

        // 専用ダイアログを呼び出し
        const type = await UsageCreationDialog.prompt({ usageTypes });

        // 追加ボタンが押された場合（nullでない場合）のみ処理を実行
        if (type) {
            const actions = foundry.utils.deepClone(this.item.system.actions || []);
            
            actions.push({
                type: type,
                name: "新規用途",
                description: ""
            });

            await this.item.update({ "system.actions": actions });
        }
    }

    async _onActionDelete(event) {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        const actions = foundry.utils.deepClone(this.item.system.actions || []);
        if (index >= 0 && index < actions.length) {
            actions.splice(index, 1);
            await this.item.update({ "system.actions": actions });
        }
    }
}