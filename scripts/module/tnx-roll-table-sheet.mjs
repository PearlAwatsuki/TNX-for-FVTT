import { drawVirtualDoC, DOC_SLOT_LABELS } from "../data/roll-table/tnx-roll-table.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

export class TnxRollTableSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    tabGroups = {};

    static DEFAULT_OPTIONS = {
        classes: ["application", "tokyo-nova", "sheet", "tnx-roll-table-sheet"],
        position: { width: 560, height: 540 },
        tag: "form",
        form: {
            handler: TnxRollTableSheet._onSubmitForm,
            submitOnChange: false,
            closeOnSubmit: false,
        },
        actions: {
            drawDoc:     TnxRollTableSheet._onDrawDoc,
            addEntry:    TnxRollTableSheet._onAddEntry,
            removeEntry: TnxRollTableSheet._onRemoveEntry,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/roll-table/tnx-roll-table-sheet.hbs" },
    };

    /** @override */
    get title() {
        return this.document.name;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.document = this.document;
        context.system   = system;
        context.isDocMode        = system.deckMode !== "configured";
        context.isConfiguredMode = system.deckMode === "configured";

        // DoC スロット一覧
        context.docEntries = Object.entries(DOC_SLOT_LABELS).map(([key, label]) => ({
            key,
            label,
            value: system.docResults[key] ?? "",
        }));

        // 設定デッキモード用 デッキ選択肢
        context.deckOptions = [
            { uuid: "", name: "（なし）" },
            ...(game.cards?.filter(c => c.type === "deck") ?? []).map(d => ({
                uuid: d.uuid,
                name: d.name,
            })),
        ];

        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);

        // モード切替ラジオ: 変更時に即時保存してシートを再描画
        for (const radio of this.element.querySelectorAll('input[name="modeRadio"]')) {
            radio.addEventListener("change", async (ev) => {
                await this.document.update({ "system.deckMode": ev.target.value });
            });
        }
    }

    // ─── フォームハンドラ ──────────────────────────────────────────────────────

    static async _onSubmitForm(_event, _form, formData) {
        const data = formData.object;
        const isConfigured = this.document.system.deckMode === "configured";
        const updateData = {};

        if (!isConfigured) {
            // Doc モード: docResults の 14 スロットだけ保存
            const docResults = {};
            for (const key of Object.keys(DOC_SLOT_LABELS)) {
                docResults[key] = data[`system.docResults.${key}`]
                    ?? data?.system?.docResults?.[key]
                    ?? "";
            }
            updateData["system.docResults"] = docResults;
        } else {
            // Configured モード: deckId + deckResults 配列を保存
            updateData["system.deckId"] = data["system.deckId"] ?? data?.system?.deckId ?? "";

            const deckResults = [];
            let i = 0;
            while (
                (`system.deckResults.${i}.label` in data) ||
                (data?.system?.deckResults?.[i] !== undefined)
            ) {
                const label = data[`system.deckResults.${i}.label`]
                    ?? data?.system?.deckResults?.[i]?.label
                    ?? "";
                const text = data[`system.deckResults.${i}.text`]
                    ?? data?.system?.deckResults?.[i]?.text
                    ?? "";
                deckResults.push({ label, text });
                i++;
                if (i > 200) break; // 安全上限
            }
            updateData["system.deckResults"] = deckResults;
        }

        await this.document.update(updateData);
        ui.notifications.info("ロールテーブルを保存しました。");
    }

    // ─── アクション ──────────────────────────────────────────────────────────

    static async _onDrawDoc() {
        const key   = drawVirtualDoC();
        const label = DOC_SLOT_LABELS[key];
        const text  = this.document.system.docResults[key];

        const content = `<div class="tnx-roll-table-result">
            <strong>${this.document.name}</strong>
            <div class="tnx-result-card-name">カード: <em>${label}</em></div>
            <div class="tnx-result-text">${text || "（結果未設定）"}</div>
        </div>`;

        await ChatMessage.create({ content });
    }

    static async _onAddEntry() {
        const deckResults = foundry.utils.deepClone(this.document.system.deckResults ?? []);
        deckResults.push({ label: "", text: "" });
        await this.document.update({ "system.deckResults": deckResults });
    }

    static async _onRemoveEntry(_event, target) {
        const idx = parseInt(target.dataset.index);
        if (isNaN(idx)) return;
        const deckResults = foundry.utils.deepClone(this.document.system.deckResults ?? []);
        deckResults.splice(idx, 1);
        await this.document.update({ "system.deckResults": deckResults });
    }
}
