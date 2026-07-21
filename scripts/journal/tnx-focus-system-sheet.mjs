/**
 * @fileoverview TnxFocusSystemSheet - FS判定シート。
 *
 * **JournalEntry のシート**である(2026-07-21 是正)。アクトシートと同じ持ち方で、
 * `Journal.registerSheet` で登録し、データは flags に置く。当初 JournalEntryPage の
 * サブタイプとして作ったのは Code の誤読で、JournalEntry はサブタイプを持てないため
 * DataModel ではなく flags ＋ `focus-system-data.mjs` の正規化で表す。
 *
 * FS判定の**設定の置き場と閲覧用**。実行状態(進行値・カット数)は持たない——実行中 FS の
 * 正本はワールド設定側にあり、起動時にスナップショットを取り込む。
 */

import { readFocusSystemData, FOCUS_SYSTEM_FLAG } from "../module/focus-system-data.mjs";
import { buildFocusSystemEditorContext } from "../module/focus-system-form.mjs";
import { bindFocusSystemEditor } from "../module/focus-system-editor.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

export class TnxFocusSystemSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "journal", "tnx-focus-system-sheet"],
        position: { width: 820, height: 780 },
        window: { resizable: true },
        form: { submitOnChange: false, closeOnSubmit: false },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/journal/focus-system-sheet.hbs" },
    };

    /** ウィンドウのタイトルは素のドキュメント名(既定の「Journal Entry: 」接頭辞を出さない)。 */
    get title() {
        return this.document.name;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const data = readFocusSystemData(this.document);
        return {
            ...context,
            ...(await buildFocusSystemEditorContext(data, { editable: this.isEditable })),
            name: this.document.name,
        };
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        if (!el || !this.isEditable) return;

        // 名前はジャーナル名(FS 名を別に持たない)
        el.querySelector('[name="journalName"]')?.addEventListener("change", (event) => {
            this.document.update({ name: event.target.value.trim() || "新規FS判定" });
        });

        // 値・構造の変更はすべて bindFocusSystemEditor が拾い、onChange で保存する
        bindFocusSystemEditor(el.querySelector(".fs-editor"), { onChange: (data) => this._save(data) });
    }

    /** 設定を flags へ保存する(保存すると再描画され、候補や行の並びが更新される)。 */
    async _save(data) {
        await this.document.setFlag(FOCUS_SYSTEM_FLAG.scope, FOCUS_SYSTEM_FLAG.key, data);
    }
}
