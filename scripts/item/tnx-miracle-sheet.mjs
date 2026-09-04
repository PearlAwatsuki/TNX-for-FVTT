import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

/**
 * 神業シート。設定タブに「他の神業として使う」(17-5・アイテム側の機能)を持つ:
 * 選び方(なし／指定の選択肢から選んで固定／このアクトで使われた神業から選ぶ)と、選択肢(区分の
 * ラベル＋参照先の神業=スタイル→神業と同じ uuid 参照・神業のドロップで設定)、そして**選んだ効果**
 * (《万能道具》は〈フォルム〉を選ぶときに、《半身》はリーダー決定時に、ここで選んで固定する。
 * スタイル→神業→スタイル技能の順を保つため、使用時に取得技能から導かない=ユーザー訂正 2026-09-04)。
 * 選択肢の行は配列全体を送って更新する(スタイル技能シートのコンボ行と同方式)。対応表(《万能道具》の
 * 〈フォルム〉→神業)はコードに持たず、この選択肢として辞典データ側に設定する。
 */
export class TokyoNovaMiracleSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "miracle"],
        position: { width: 600, height: 600 },
        actions: {
            asOtherChoiceAdd:    TokyoNovaMiracleSheet._onAsOtherChoiceAdd,
            asOtherChoiceDelete: TokyoNovaMiracleSheet._onAsOtherChoiceDelete,
            asOtherChoiceOpen:   TokyoNovaMiracleSheet._onAsOtherChoiceOpen,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** 選び方の選択肢。 */
    static AS_OTHER_MODES = Object.freeze({
        "":     "なし",
        choice: "指定の選択肢から選んで固定する",
        log:    "このアクトで使われた神業から選ぶ",
    });

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.enrichedConditionDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.item.system.usageCondition ?? "",
            { relativeTo: this.item, editable: context.editable }
        );

        // 他の神業として使う(17-5): 選択肢ごとに参照先の現在名(fromUuid)を引き、「効果」の選択肢を組む
        const asOther = this.item.system.asOther ?? { mode: "", choices: [], selected: "" };
        context.asOtherModeOptions = TokyoNovaMiracleSheet.AS_OTHER_MODES;
        context.asOtherIsChoice = asOther.mode === "choice";
        if (context.asOtherIsChoice) {
            const rows = await Promise.all((asOther.choices ?? []).map(async (c, idx) => {
                let miracle = null;
                if (c.uuid) {
                    try {
                        const doc = await fromUuid(c.uuid);
                        if (doc) miracle = { name: doc.name, img: doc.img };
                    } catch { miracle = null; }
                }
                return { idx, label: c.label ?? "", uuid: c.uuid ?? "", miracle };
            }));
            context.asOtherChoices = rows;
            context.asOtherSelectOptions = [
                { value: "", label: "（未選択）", selected: !asOther.selected },
                ...rows.filter(r => r.uuid).map(r => ({
                    value: r.uuid,
                    label: r.label ? `${r.label}: ${r.miracle?.name ?? "?"}` : (r.miracle?.name ?? "?"),
                    selected: r.uuid === asOther.selected,
                })),
            ];
        }
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        // 閲覧モードでは選択肢の入力を読み取り専用にする(追加/削除は CSS で非表示・スタイル技能シートと同じ)
        if (!context.isEditMode) {
            for (const el of this.element.querySelectorAll(".tnx-asother-section .tnx-combo-card input")) el.disabled = true;
            return;
        }
        // 区分のラベル: name を持たない入力=フォーム送信には乗らず、配列全体を送って更新する
        for (const input of this.element.querySelectorAll(".tnx-asother-section input[data-asother-label]")) {
            input.addEventListener("change", (event) => {
                event.stopPropagation();
                this._patchAsOtherChoice(Number(input.dataset.asotherLabel), { label: event.currentTarget.value });
            });
        }
        // 参照先の神業: 行ごとのドロップゾーン
        for (const zone of this.element.querySelectorAll('.tnx-import-box--dropzone[data-drop-area^="asother-"]')) {
            zone.addEventListener("dragover", (event) => event.preventDefault());
            zone.addEventListener("drop", (event) => this._onDropAsOtherChoice(event, Number(zone.dataset.dropArea.split("-")[1])));
        }
        // 参照先のリンク解除(スタイルシートの神業リンクと同じ右クリックメニュー)
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu-type="asother-choice"]', [{
            name: "リンク解除",
            icon: '<i class="fas fa-unlink"></i>',
            callback: async (target) => {
                const idx = Number(target?.dataset?.index);
                await this._patchAsOtherChoice(idx, { uuid: "" });
            },
        }], { jQuery: false, fixed: true });
    }

    /** 選択肢の複製(欠けたフィールドを補う)。 */
    _asOtherChoices() {
        return (this.item.system.asOther?.choices ?? []).map(c => ({ label: c.label ?? "", uuid: c.uuid ?? "" }));
    }

    /** 選択肢の更新。選んだ効果(selected)が選択肢から消えたら未選択に戻す。 */
    async _updateAsOtherChoices(list) {
        const selected = this.item.system.asOther?.selected ?? "";
        const update = { "system.asOther.choices": list };
        if (selected && !list.some(c => c.uuid === selected)) update["system.asOther.selected"] = "";
        await this.item.update(update);
    }

    async _patchAsOtherChoice(idx, patch) {
        const list = this._asOtherChoices();
        if (!list[idx]) return;
        list[idx] = { ...list[idx], ...patch };
        await this._updateAsOtherChoices(list);
    }

    async _onDropAsOtherChoice(event, idx) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (data?.type !== "Item") return;
        const doc = await Item.fromDropData(data);
        if (doc?.type !== "miracle") { ui.notifications.warn("参照先にできるのは「神業」タイプのアイテムのみです。"); return; }
        if (doc.uuid === this.item.uuid) { ui.notifications.warn("自分自身は参照先にできません。"); return; }
        await this._patchAsOtherChoice(idx, { uuid: doc.uuid });
    }

    static async _onAsOtherChoiceAdd() {
        const list = this._asOtherChoices();
        list.push({ label: "", uuid: "" });
        await this._updateAsOtherChoices(list);
    }

    static async _onAsOtherChoiceDelete(_event, target) {
        const idx = Number(target.dataset.index);
        const list = this._asOtherChoices();
        if (!(idx >= 0 && idx < list.length)) return;
        list.splice(idx, 1);
        await this._updateAsOtherChoices(list);
    }

    static async _onAsOtherChoiceOpen(_event, target) {
        const idx = Number(target.dataset.index);
        const uuid = this.item.system.asOther?.choices?.[idx]?.uuid;
        if (!uuid) return;
        const doc = await fromUuid(uuid).catch(() => null);
        doc?.sheet?.render({ force: true });
    }
}
