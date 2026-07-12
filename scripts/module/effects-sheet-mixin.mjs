/**
 * ActiveEffectリストを持つシートに共通の機能を提供するMixin。
 * V2 シートでは ACTIONS を DEFAULT_OPTIONS.actions に展開して使う。
 */
export const EffectsSheetMixin = {

    /**
     * シートの描画コンテキストに分類済みエフェクトを追加する。
     * V1/V2 共通。_prepareContext / getData から呼ぶ。
     *
     * アクターでは allApplicableEffects()(自身の効果＋所有アイテムから転送された効果)を
     * 列挙する。legacyTransferral=false では転送効果が actor.effects に入らないため、
     * これを使わないと「アイテム効果がキャストに反映されているのに一覧に出ない」状態になる。
     * アイテム等 allApplicableEffects を持たないドキュメントは自身の effects を使う。
     * @param {Document} document
     * @param {object} context
     */
    prepareEffectsContext(document, context) {
        const effects = { temporary: [], passive: [], inactive: [] };
        const source = (typeof document.allApplicableEffects === "function")
            ? document.allApplicableEffects()
            : document.effects;
        // ActiveEffect ドキュメントは変異させない(sourceName 等は読み取り専用ゲッター)。
        // 転送元の判別が必要なら template 側で組み込みの effect.sourceName を使う。
        for (const effect of source) {
            // ダメージ/カスケード由来の状態は AE 本体をリスト非表示にする(供給元が浮くため。
            // 状態自体はトークンのステータスアイコンで見える。技能由来 BS はフラグなし=表示)。
            if (effect.flags?.["tokyo-nova-axleration"]?.hideFromList) continue;
            if (effect.disabled) effects.inactive.push(effect);
            else if (effect.isTemporary) effects.temporary.push(effect);
            else effects.passive.push(effect);
        }
        context.effects = effects;
    },

    /**
     * 効果 ID から効果ドキュメントを解決する。自身の effects に無ければ所有アイテムを探す
     * (アクターに表示された転送効果は所有アイテム上にあるため)。
     * @param {Document} document
     * @param {string} effectId
     * @returns {ActiveEffect|null}
     */
    resolveEffect(document, effectId) {
        if (!effectId) return null;
        const own = document.effects?.get(effectId);
        if (own) return own;
        for (const item of (document.items ?? [])) {
            const e = item.effects?.get(effectId);
            if (e) return e;
        }
        return null;
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
                name: "新規効果",
                img: "icons/svg/aura.svg",
                origin: doc.uuid,
            }]);
            effect?.sheet.render({ force: true });
        },

        async editEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            EffectsSheetMixin.resolveEffect(this.document, effectId)?.sheet.render({ force: true });
        },

        async deleteEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            await EffectsSheetMixin.resolveEffect(this.document, effectId)?.delete();
        },

        async toggleEffect(_event, target) {
            const effectId = target.closest(".tnx-item-list__row")?.dataset.effectId;
            const effect = EffectsSheetMixin.resolveEffect(this.document, effectId);
            await effect?.update({ disabled: !effect.disabled });
        },
    },

    // ─── V1 互換メソッド群 (CastSheet 移行完了後に削除) ──────────────────────

    /** @deprecated V1 only。V2 シートでは ACTIONS を使うこと。 */
    activateEffectListListeners(html, document) {
        html.find(".tnx-icon-ctrl").on("click", async (event) => {
            event.preventDefault();
            const a = event.currentTarget;
            const effectId = a.closest(".tnx-item-list__row")?.dataset.effectId;
            const effect = document.effects.get(effectId);
            const action = a.dataset.action;

            switch (action) {
                case "createEffect": {
                    const newEffects = await document.createEmbeddedDocuments("ActiveEffect", [{
                        name: "新規効果",
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
            name: "新規効果",
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
