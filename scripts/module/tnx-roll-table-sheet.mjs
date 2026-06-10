/**
 * @fileoverview TnxRollTableSheet - カード引きロールテーブルのカスタムシート
 *
 * RollTable ドキュメントはサブタイプ(type/system フィールド)を持たないため、
 * DataModel は使用せず、データはすべて document flags に保存する。
 * コアの RollTableSheet を unregister して全 RollTable をこのシートで表示する。
 *
 * flag 構造 (flags.tokyo-nova-axleration.rollTable):
 *   deckMode    "doc" | "configured"
 *   deckId      紐付けデッキの UUID(configured モード)
 *   docResults  { joker, two, ..., ace } 仮想 DoC の 14 スロット
 *   deckResults [{ label, text }] カード名ルックアップの動的エントリ
 */

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

const SCOPE = "tokyo-nova-axleration";
const FLAG_KEY = "rollTable";

export const DOC_SLOT_LABELS = {
    joker: "Joker", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    jack: "J", queen: "Q", king: "K", ace: "A",
};

/** flag からテーブルデータを取得する(欠損キーはデフォルトで補完) */
export function getTableFlagData(table) {
    const stored = table.getFlag(SCOPE, FLAG_KEY) ?? {};
    const docResults = {};
    for (const key of Object.keys(DOC_SLOT_LABELS)) {
        docResults[key] = stored.docResults?.[key] ?? "";
    }
    return {
        deckMode: stored.deckMode === "configured" ? "configured" : "doc",
        deckId:   stored.deckId ?? "",
        docResults,
        deckResults: Array.isArray(stored.deckResults)
            ? stored.deckResults.map(e => ({ label: e?.label ?? "", text: e?.text ?? "" }))
            : [],
    };
}

/** 54 枚フルデッキ(Joker×2、各数値×4)から仮想ドローし、スロットキーを返す */
export function drawVirtualDoC() {
    const KEYS = Object.keys(DOC_SLOT_LABELS);
    const idx = Math.floor(Math.random() * 54);
    if (idx < 2) return "joker";
    return KEYS[1 + Math.floor((idx - 2) / 4)];
}

/**
 * HUD ドロー後、開いている TnxRollTableSheet をルックアップしてチャット投稿する。
 * @param {Card}   card           ドローされた Card ドキュメント
 * @param {string} sourceDeckUuid ドロー元デッキの UUID
 */
export async function lookupFromCard(card, sourceDeckUuid) {
    for (const app of foundry.applications.instances.values()) {
        if (!(app instanceof TnxRollTableSheet)) continue;
        const data = getTableFlagData(app.document);
        if (data.deckMode !== "configured") continue;
        if (data.deckId !== sourceDeckUuid) continue;

        const cardName = card.name ?? "";
        const entry = data.deckResults.find(e => {
            if (!e.label) return false;
            return cardName.includes(e.label) || e.label.includes(cardName);
        });
        if (!entry?.text) continue;

        await ChatMessage.create({
            content: `<div class="tnx-roll-table-result">
                <strong>${app.document.name}</strong>
                <div class="tnx-result-card-name">${cardName}</div>
                <div class="tnx-result-text">${entry.text}</div>
            </div>`,
            speaker: { alias: app.document.name },
        });
    }
}

export class TnxRollTableSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

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
        const table = getTableFlagData(this.document);

        context.document = this.document;
        context.table    = table;
        context.isConfiguredMode = table.deckMode === "configured";

        // DoC スロット一覧
        context.docEntries = Object.entries(DOC_SLOT_LABELS).map(([key, label]) => ({
            key,
            label,
            value: table.docResults[key],
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

        // モード切替ラジオ: 変更時に即時保存(flag 更新でシートは自動再描画)
        for (const radio of this.element.querySelectorAll('input[name="modeRadio"]')) {
            radio.addEventListener("change", async (ev) => {
                await this.document.setFlag(SCOPE, `${FLAG_KEY}.deckMode`, ev.target.value);
            });
        }
    }

    // ─── フォームハンドラ ──────────────────────────────────────────────────────

    static async _onSubmitForm(_event, _form, formData) {
        const data = foundry.utils.expandObject(formData.object);
        const current = getTableFlagData(this.document);

        if (current.deckMode === "configured") {
            const raw = data.deckResults ?? {};
            const deckResults = Object.keys(raw)
                .map(Number)
                .filter(i => !isNaN(i))
                .sort((a, b) => a - b)
                .map(i => ({ label: raw[i]?.label ?? "", text: raw[i]?.text ?? "" }));
            await this.document.setFlag(SCOPE, FLAG_KEY, {
                deckId: data.deckId ?? "",
                deckResults,
            });
        } else {
            const docResults = {};
            for (const key of Object.keys(DOC_SLOT_LABELS)) {
                docResults[key] = data.docResults?.[key] ?? "";
            }
            await this.document.setFlag(SCOPE, FLAG_KEY, { docResults });
        }
        ui.notifications.info("ロールテーブルを保存しました。");
    }

    // ─── アクション ──────────────────────────────────────────────────────────

    static async _onDrawDoc() {
        const table = getTableFlagData(this.document);
        const key   = drawVirtualDoC();
        const label = DOC_SLOT_LABELS[key];
        const text  = table.docResults[key];

        await ChatMessage.create({
            content: `<div class="tnx-roll-table-result">
                <strong>${this.document.name}</strong>
                <div class="tnx-result-card-name">カード: <em>${label}</em></div>
                <div class="tnx-result-text">${text || "（結果未設定）"}</div>
            </div>`,
        });
    }

    static async _onAddEntry() {
        const { deckResults } = getTableFlagData(this.document);
        deckResults.push({ label: "", text: "" });
        await this.document.setFlag(SCOPE, `${FLAG_KEY}.deckResults`, deckResults);
    }

    static async _onRemoveEntry(_event, target) {
        const idx = parseInt(target.dataset.index);
        if (isNaN(idx)) return;
        const { deckResults } = getTableFlagData(this.document);
        deckResults.splice(idx, 1);
        await this.document.setFlag(SCOPE, `${FLAG_KEY}.deckResults`, deckResults);
    }
}
