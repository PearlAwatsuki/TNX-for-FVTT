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
        // cssClass: edit/view-mode は root 要素で管理するため section には渡さない
        context.cssClass = "";
        context.options = { usageTypes: this.constructor.usageTypes };
        context.isEditMode = this._isEditMode && context.editable;

        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(system.description, {
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

        // V2 はレンダー時に active クラスを DOM に付与しないため、changeTab で補完する。
        // テンプレートは context.tabs を使っていないため毎レンダー後に呼ぶ必要がある。
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* PARTS にそのタブがない場合は無視 */ }
            }
        }

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
            btn.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
            header.prepend(btn);
        }

        const ProseMirrorEl = customElements.get("prose-mirror");
        if (ProseMirrorEl) {
            for (const contentDiv of el.querySelectorAll(".editor-content[data-edit]")) {
                const editorDiv = contentDiv.closest("div.editor");
                if (!editorDiv) continue;
                const fieldName = contentDiv.dataset.edit;
                const pm = ProseMirrorEl.create({
                    name: fieldName,
                    value: foundry.utils.getProperty(this.document, fieldName) ?? "",
                    enriched: contentDiv.innerHTML,
                    toggled: true,
                });
                pm.dataset.documentUuid = this.document.uuid;
                editorDiv.replaceWith(pm);
            }
            for (const btn of el.querySelectorAll(".tnx-editor-section__header .tnx-editor-open[data-field]")) {
                const pm = el.querySelector(`prose-mirror[name="${btn.dataset.field}"]`);
                if (pm) btn.addEventListener("click", (ev) => { ev.preventDefault(); pm.open = true; });
            }
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
