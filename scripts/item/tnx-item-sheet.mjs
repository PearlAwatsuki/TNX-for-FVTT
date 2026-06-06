import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { UsageCreationDialog } from "../module/tnx-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Tokyo NOVA アイテムシートの基底クラス。
 * 用途(Actions)タブの処理や共通のエフェクト処理を提供する。
 * PARTS は各サブクラスで定義する。
 */
export class TokyoNovaItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

    /** view/edit モード状態。isOwner でない場合は常に false。 */
    _isEditMode = false;

    /** アクティブタブの状態。 */
    tabGroups = { primary: "description" };

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item"],
        position: { width: 600, height: 650 },
        form: { submitOnChange: true },
        actions: {
            ...EffectsSheetMixin.ACTIONS,
            toggleEditMode: TokyoNovaItemSheet._onToggleEditMode,
        },
    };

    static get usageTypes() {
        return {
            "check": "判定",
            "declaration": "宣言",
            "miracle": "神業",
        };
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = foundry.utils.deepClone(this.item.system);

        context.item = this.item;
        context.system = system;
        context.owner = this.document.isOwner;
        // V1 テンプレートとの互換のため cssClass を提供する
        context.cssClass = this.element?.className ?? "";
        context.options = { usageTypes: this.constructor.usageTypes };
        context.isEditMode = this._isEditMode && context.editable;

        context.enrichedDescription = await TextEditor.enrichHTML(system.description, {
            relativeTo: this.item,
            editable: context.editable,
        });

        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive,
        ];

        return context;
    }

    /** @override */
    _onRender(context, _options) {
        const el = this.element;

        // edit/view モード CSS クラスを同期
        el.classList.toggle("edit-mode", !!context.isEditMode);
        el.classList.toggle("view-mode", !context.isEditMode);

        if (!context.editable) return;

        // 編集モード切替ボタン。window-header は PART 外で永続するが
        // _onRender は毎レンダー呼ばれるので remove → append でリフレッシュする。
        const header = el.querySelector(".window-header");
        if (header) {
            header.querySelector(".edit-mode-toggle")?.remove();
            const btn = document.createElement("a");
            btn.className = "edit-mode-toggle";
            btn.title = "編集モード切替";
            btn.dataset.action = "toggleEditMode";
            header.prepend(btn);
        }

        // usage-list.hbs は変更不可のため data-action ではなく直接リスナーで対応する
        el.querySelector(".action-create")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            TokyoNovaItemSheet._onActionCreate.call(this, ev, ev.currentTarget);
        });
        for (const btn of el.querySelectorAll(".action-delete[data-index]")) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                TokyoNovaItemSheet._onActionDelete.call(this, ev, ev.currentTarget);
            });
        }
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onToggleEditMode(_event, _target) {
        this._isEditMode = !this._isEditMode;
        this.render();
    }

    static async _onActionCreate(_event, _target) {
        const usageTypes = this.constructor.usageTypes;
        const type = await UsageCreationDialog.prompt({ usageTypes });
        if (!type) return;
        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        actions.push({ type, name: "新規用途", description: "" });
        await this.item.update({ "system.actions": actions });
    }

    static async _onActionDelete(_event, target) {
        const index = Number(target.dataset.index);
        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        if (index >= 0 && index < actions.length) {
            actions.splice(index, 1);
            await this.item.update({ "system.actions": actions });
        }
    }
}
