import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { TnxUsageSheet, USAGE_TYPES } from "../module/tnx-usage-sheet.mjs";

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
            incrementField: TokyoNovaItemSheet._onIncrementField,
            decrementField: TokyoNovaItemSheet._onDecrementField,
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = foundry.utils.deepClone(this.item.system);

        context.item = this.item;
        context.system = system;
        context.owner = this.document.isOwner;
        // cssClass: edit/view-mode は root 要素で管理するため section には渡さない
        context.cssClass = "";
        context.options = {
            usageTypeLabels: USAGE_TYPES,
        };
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
                // トグルボタンをヘッダーへ移動する（Foundry デフォルトはhover時のみ表示・エリア右上絶対配置）
                const section = pm.closest(".tnx-editor-section");
                const sectionHeader = section?.querySelector(".tnx-editor-section__header");
                if (sectionHeader) {
                    const moveBtn = () => {
                        const btn = pm.querySelector("button.toggle");
                        if (btn) sectionHeader.appendChild(btn);
                    };
                    requestAnimationFrame(moveBtn);
                    pm.addEventListener("close", () => requestAnimationFrame(moveBtn));
                }
            }
        }

        // usage-list.hbs は data-action ではなく直接リスナーで対応する
        el.querySelector(".action-create")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            TokyoNovaItemSheet._onActionCreate.call(this, ev, ev.currentTarget);
        });
        for (const btn of el.querySelectorAll(".action-edit[data-usage-id]")) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                TokyoNovaItemSheet._onUsageEdit.call(this, ev, ev.currentTarget);
            });
        }
        for (const btn of el.querySelectorAll(".action-delete[data-usage-id]")) {
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

    /**
     * number-input-spinner の +ボタン。data-field のパスを 1 増やす。
     */
    static async _onIncrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        await this.item.update({ [field]: current + 1 });
    }

    /**
     * number-input-spinner の -ボタン。data-field のパスを 1 減らす。
     */
    static async _onDecrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        let next = current - 1;
        if (target.dataset.min !== undefined) next = Math.max(next, Number(target.dataset.min));
        await this.item.update({ [field]: next });
    }

    /** 用途追加: 種別選択ダイアログ → エントリ作成 → TnxUsageSheet を開く */
    static async _onActionCreate(_event, _target) {
        const type = await TokyoNovaItemSheet._promptUsageType();
        if (!type) return;

        const newId = foundry.utils.randomID();
        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        actions.push({
            _id:         newId,
            type,
            name:        USAGE_TYPES[type] ?? "新規用途",
            description: "",
            timing:      { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
            target:      "blank",
            effects:     [],
            skillRefs:   [],
            weaponRef:   { itemId: "" },
            damageType:  "",
            formula:     "",
            damageCategory: "",
            modifiableParams: [],
        });
        await this.item.update({ "system.actions": actions });

        // 作成直後に編集シートを開く
        const sheet = new TnxUsageSheet(this.item, newId);
        sheet.render({ force: true });
    }

    /** 用途編集: TnxUsageSheet を開く */
    static async _onUsageEdit(_event, target) {
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        // 既に同じ用途のシートが開いていれば前面に出す
        const existing = Object.values(foundry.applications.instances)
            .find(a => a instanceof TnxUsageSheet && a._usageId === usageId);
        if (existing) {
            existing.bringToTop();
            return;
        }

        const sheet = new TnxUsageSheet(this.item, usageId);
        sheet.render({ force: true });
    }

    static async _onActionDelete(_event, target) {
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        const idx = actions.findIndex(a => a._id === usageId);
        if (idx >= 0) {
            actions.splice(idx, 1);
            await this.item.update({ "system.actions": actions });
        }
    }

    // ─── 種別選択ダイアログ ────────────────────────────────────────────────────

    /** 用途タイプを選択させる DialogV2。選択されたキーを返す。 */
    static async _promptUsageType() {
        const options = Object.entries(USAGE_TYPES)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("");

        const content = `
            <div class="usage-type-select-dialog">
                <div class="form-group">
                    <label>用途の種別</label>
                    <select name="usageType">${options}</select>
                </div>
            </div>`;

        return foundry.applications.api.DialogV2.wait({
            window:   { title: "用途の種別を選択" },
            classes:  ["tokyo-nova", "tnx-dialog"],
            position: { width: 340 },
            content,
            buttons: [
                {
                    action: "ok", icon: "fas fa-check", label: "作成", default: true,
                    callback: (_event, _button, dialog) =>
                        dialog.element.querySelector("select[name='usageType']")?.value ?? null,
                },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
    }
}
