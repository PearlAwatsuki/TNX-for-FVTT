/**
 * @fileoverview FS判定の起動フォーム(2026-07-21 作り直し)。
 *
 * **FS判定シートと同じエディタ部品を使う**。当初は判定要求ダイアログの見た目だけを写して
 * スカラー項目を並べ、判定行を持たなかったため、手動設定で開始した FS判定は進行判定も
 * 支援判定も要求できない抜け殻になっていた(有効行が無いと要求が組めない)。
 * 同じ部品を使えば、この種の取りこぼしは構造的に起きない。
 *
 * 読み込み元に FS判定シートを選ぶと、その内容が**エディタへ流し込まれてそのまま直せる**
 * (以前は見えない変数に持っていた)。開始後は実行中 FS の正本がワールド設定側に移るため、
 * シートを編集しても実行中の FS は変わらない。
 */

import { readFocusSystemData, defaultFocusSystemData, isFocusSystemJournal } from "./focus-system-data.mjs";
import { buildFocusSystemEditorContext, readFocusSystemForm } from "./focus-system-form.mjs";
import { bindFocusSystemEditor } from "./focus-system-editor.mjs";
import { captureScrollTop, restoreScrollTop } from "./scroll-preserve.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SCROLL_SELECTOR = ".tnx-focus-system-sheet__body";

/**
 * ワールドの FS判定シートを列挙する(読み込み元)。
 * FS判定シートは JournalEntry なので、設定フラグの有無で見分ける。
 */
export function listFocusSystemJournals() {
    return game.journal
        .filter(j => isFocusSystemJournal(j))
        .map(j => ({ uuid: j.uuid, name: j.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export class TnxFocusSystemStartApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-focus-system-start",
        tag: "form",
        classes: ["tokyo-nova", "sheet", "tnx-focus-system-sheet"],
        window: { title: "FS判定を開始", resizable: true },
        position: { width: 820, height: 780 },
        form: {
            handler: TnxFocusSystemStartApp._onSubmit,
            closeOnSubmit: true,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/focus-system-start.hbs" },
    };

    constructor({ onStart, ...options } = {}) {
        super(options);
        this._onStart = onStart;
        this._data = defaultFocusSystemData();
        this._name = "";
        this._sourceUuid = "";
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return {
            ...context,
            ...(await buildFocusSystemEditorContext(this._data, { editable: true })),
            name: this._name,
            sourceUuid: this._sourceUuid,
            sources: listFocusSystemJournals().map(j => ({ ...j, selected: j.uuid === this._sourceUuid })),
        };
    }

    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._scrollTop = captureScrollTop(this.element, SCROLL_SELECTOR);
    }

    _onRender(context, options) {
        super._onRender(context, options);
        restoreScrollTop(this.element, SCROLL_SELECTOR, this._scrollTop);
        const el = this.element;

        el.querySelector('[name="sourceUuid"]')?.addEventListener("change", async (event) => {
            await this._loadSource(event.target.value);
        });
        el.querySelector('[name="name"]')?.addEventListener("change", (event) => {
            this._name = event.target.value;
        });

        const editor = el.querySelector(".fs-editor");
        bindFocusSystemEditor(editor, { onChange: (data) => this._replace(data) });
    }

    /** 読み込み元の内容をエディタへ流し込む(手動設定なら空に戻す)。 */
    async _loadSource(uuid) {
        this._sourceUuid = uuid ?? "";
        const journal = uuid ? await fromUuid(uuid) : null;
        this._data = journal ? readFocusSystemData(journal) : defaultFocusSystemData();
        if (journal) this._name = journal.name;
        this.render();
    }

    /** 手元の設定を差し替えて描き直す(行や技能の増減で候補が変わるため)。 */
    _replace(data) {
        this._data = data;
        this.render();
    }

    static async _onSubmit(event, form, _formData) {
        const editor = form.querySelector(".fs-editor");
        const data = editor ? readFocusSystemForm(editor) : this._data;
        const name = form.querySelector('[name="name"]')?.value?.trim() || "FS判定";
        await this._onStart?.({ name, data }, this._sourceUuid || null);
    }
}
