/**
 * ActiveEffectリストを持つシートに共通の機能を提供するMixin。
 * V2 シートでは ACTIONS を DEFAULT_OPTIONS.actions に展開して使う。
 */
export const EffectsSheetMixin = {

    /**
     * シートの描画コンテキストに分類済みエフェクトを追加する。
     * V1/V2 共通。_prepareContext / getData から呼ぶ。
     * @param {Document} document
     * @param {object} context
     */
    prepareEffectsContext(document, context) {
        const effects = { temporary: [], passive: [], inactive: [] };
        for (const effect of document.effects) {
            if (effect.disabled) effects.inactive.push(effect);
            else if (effect.isTemporary) effects.temporary.push(effect);
            else effects.passive.push(effect);
        }
        context.effects = effects;
    },

    /**
     * V2 DEFAULT_OPTIONS.actions に展開して使うアクションハンドラ群。
     * this = シートインスタンス、target = data-action を持つ要素。
     * active-effects-list.hbs の data-action 値と対応している。
     */
    ACTIONS: {
        async createEffect(_event, _target) {
            const doc = this.document;
            const [effect] = await doc.createEmbeddedDocuments("ActiveEffect", [{
                name: game.i18n.localize("EFFECT.New"),
                img: "icons/svg/aura.svg",
                origin: doc.uuid,
            }]);
            effect?.sheet.render({ force: true });
        },

        async editEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            this.document.effects.get(effectId)?.sheet.render({ force: true });
        },

        async deleteEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            await this.document.effects.get(effectId)?.delete();
        },

        async toggleEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            const effect = this.document.effects.get(effectId);
            await effect?.update({ disabled: !effect.disabled });
        },
    },

    // ─── V1 互換メソッド群 (CastSheet 移行完了後に削除) ──────────────────────

    /** @deprecated V1 only。V2 シートでは ACTIONS を使うこと。 */
    activateEffectListListeners(html, document) {
        html.find(".effect-control").on("click", async (event) => {
            event.preventDefault();
            const a = event.currentTarget;
            const effectId = a.closest(".tnx-item-list__row")?.dataset.effectId;
            const effect = document.effects.get(effectId);
            const action = a.dataset.action;

            switch (action) {
                case "createEffect": {
                    const newEffects = await document.createEmbeddedDocuments("ActiveEffect", [{
                        name: game.i18n.localize("EFFECT.New"),
                        img: "icons/svg/aura.svg",
                        origin: document.uuid,
                    }]);
                    return newEffects[0]?.sheet.render(true);
                }
                case "editEffect":
                    return effect?.sheet.render(true);
                case "deleteEffect":
                    return effect?.delete();
                case "toggleEffect":
                    return effect?.update({ disabled: !effect.disabled });
            }
        });
    },

    /** @deprecated V1 only。 */
    async _onCreateEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const [effect] = await doc.createEmbeddedDocuments("ActiveEffect", [{
            name: game.i18n.localize("EFFECT.New"),
            img: "icons/svg/aura.svg",
            origin: doc.uuid,
        }]);
        effect?.sheet.render(true);
    },

    /** @deprecated V1 only。 */
    async _onEditEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        doc.effects.get(effectId)?.sheet.render(true);
    },

    /** @deprecated V1 only。 */
    async _onDeleteEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        await doc.effects.get(effectId)?.delete();
    },

    /** @deprecated V1 only。 */
    async _onToggleEffect(event) {
        event.preventDefault();
        const doc = this.actor || this.document;
        const effectId = event.currentTarget.closest(".tnx-item-list__row")?.dataset.effectId;
        const effect = doc.effects.get(effectId);
        await effect?.update({ disabled: !effect.disabled });
    },
};
