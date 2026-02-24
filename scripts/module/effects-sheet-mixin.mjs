/**
 * ActiveEffectリストを持つシートに共通の機能を提供するMixin
 */
export const EffectsSheetMixin = {

    /**
     * シートの描画コンテキストに、分類済みのエフェクトオブジェクトを追加する
     * @param {Document} document - ActorまたはItemドキュメント
     * @param {object} context  - シートの描画コンテキストオブジェクト
     */
    prepareEffectsContext(document, context) {
        const effects = {
            temporary: [],
            passive: [],
            inactive: []
        };
        for (const effect of document.effects) {
            if (effect.statuses && effect.statuses.size > 0) {
                continue; 
            }

            if (effect.disabled) {
                effects.inactive.push(effect);
            } else if (effect.isTemporary) {
                effects.temporary.push(effect);
            } else {
                effects.passive.push(effect);
            }
        }
        context.effects = effects;
    },

    /**
     * エフェクトリストのコントロールボタンにイベントリスナーを登録する
     * @param {HTMLElement} html   - シートのHTML要素
     * @param {Document} document - ActorまたはItemドキュメント
     */
    activateEffectListListeners(html, document) {
        html.find(".effect-control").on("click", async (event) => {
            event.preventDefault();
            const a = event.currentTarget;
            const effectId = a.closest(".tnx-item-list__row")?.dataset.effectId;
            const effect = document.effects.get(effectId);
            const action = a.dataset.action;

            switch (action) {
                case "create":
                    const newEffects = await document.createEmbeddedDocuments("ActiveEffect", [{
                        name: game.i18n.localize("EFFECT.New"),
                        img: "icons/svg/aura.svg",
                        origin: document.uuid,
                    }]);
                    return newEffects[0]?.sheet.render(true);
                case "edit":
                    return effect?.sheet.render(true);
                case "delete":
                    return effect?.delete();
                case "toggle":
                    return effect?.update({ disabled: !effect.disabled });
            }
        });
    },

    async _onCreateEffect(event) {
        event.preventDefault();
        // this.actor または this.document を使用
        const doc = this.actor || this.document; 
        return await doc.createEmbeddedDocuments("ActiveEffect", [{
            name: game.i18n.localize("EFFECT.New"),
            img: "icons/svg/aura.svg",
            origin: doc.uuid,
        }]).then(effects => effects[0]?.sheet.render(true));
    },

    async _onEditEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        const effect = doc.effects.get(effectId);
        return effect?.sheet.render(true);
    },

    async _onDeleteEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        const effect = doc.effects.get(effectId);
        return await effect?.delete();
    },

    async _onToggleEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        const effect = doc.effects.get(effectId);
        return await effect?.update({ disabled: !effect.disabled });
    }
};