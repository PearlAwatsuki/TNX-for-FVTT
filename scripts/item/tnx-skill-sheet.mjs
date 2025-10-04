import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaSkillSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "skill"],
            template: "systems/tokyo-nova-axleration/templates/item/skill-sheet.hbs",
            width: 600,
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
        
        // EffectsSheetMixinは変更なし
        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive
        ];

        // ▼ 変更点1: HBSでスートの無効化判定を行うためのデータを準備
        const initialSuit = this.item.system.generalSkill?.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
              spade:   { label: "スペード",   disabled: initialSuit === "spade" },
              heart:   { label: "ハート",   disabled: initialSuit === "heart" },
              diamond: { label: "ダイヤ",    disabled: initialSuit === "diamond" },
              club:    { label: "クラブ",    disabled: initialSuit === "club" }
            }
        };
      
        console.log("TnxSkillSheet | getData | context", context);
        
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        EffectsSheetMixin.activateEffectListListeners(html, this.item);

        // ▼ 変更点2: スートのチェックボックスが変更された時のイベントリスナーを追加
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
    }

    /**
     * スートのチェック状態が変更されたときにレベルを自動計算する
     * @param {Event} event 変更イベント
     * @private
     */
    async _onSuitChange(event) {
        // 現在のチェック数を計算
        const checkedSuits = this.form.querySelectorAll('.suit-selection input[type="checkbox"]:checked');
        const newLevel = checkedSuits.length;

        // 現在のアイテムレベルと比較し、異なる場合のみ更新
        if (this.item.system.level !== newLevel) {
            // フォームから直接更新内容を生成して更新する
            const formData = this._getSubmitData();
            formData["system.level"] = newLevel;
            await this.item.update(formData);
            this.render(); // レベル表示を即時反映
        }
    }
}