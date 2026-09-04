import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { loadCascadeData, buildSkillCascadeSteps } from "../module/skill-dictionary.mjs";

/**
 * 神業シート。設定タブに「他の神業として使う」(17-5・アイテム側の機能)を持つ:
 * 選び方(なし／参照先から決まる・選ぶ／このアクトで使われた神業から選ぶ)と参照行
 * (条件技能=対決欄と同じ辞典カスケード・識別キー保存・現在名表示／参照先=スタイル→神業と同じ
 * uuid 参照・神業のドロップで設定)。参照行は配列全体を送って更新する(スタイル技能シートの
 * コンボ行と同方式=部分更新で行が消えないように)。対応表(《万能道具》の〈フォルム〉→神業)は
 * コードに持たず、この参照行として辞典データ側に設定する。
 */
export class TokyoNovaMiracleSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "miracle"],
        position: { width: 600, height: 600 },
        actions: {
            asOtherRefAdd:    TokyoNovaMiracleSheet._onAsOtherRefAdd,
            asOtherRefDelete: TokyoNovaMiracleSheet._onAsOtherRefDelete,
            asOtherRefOpen:   TokyoNovaMiracleSheet._onAsOtherRefOpen,
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
        "":   "なし",
        refs: "参照先から決まる・選ぶ",
        log:  "このアクトで使われた神業から選ぶ",
    });

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.enrichedConditionDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.item.system.usageCondition ?? "",
            { relativeTo: this.item, editable: context.editable }
        );

        // 他の神業として使う(17-5): 参照行ごとに条件技能のカスケード段と参照先の現在名(fromUuid)を組む
        const asOther = this.item.system.asOther ?? { mode: "", refs: [] };
        context.asOtherModeOptions = TokyoNovaMiracleSheet.AS_OTHER_MODES;
        context.asOtherIsRefs = asOther.mode === "refs";
        if (context.asOtherIsRefs) {
            const cascadeData = await loadCascadeData();
            context.asOtherRefs = await Promise.all((asOther.refs ?? []).map(async (r, idx) => {
                const cascadeSteps = buildSkillCascadeSteps(cascadeData,
                    { dict: r.skillDict, group: r.skillGroup, sub: r.skillSub, skill: r.name });
                // 2列グリッド: 段数が奇数なら最後の段を全幅にする(参照先は常に全幅の自分の行)
                if (cascadeSteps.length % 2 === 1) cascadeSteps[cascadeSteps.length - 1].full = true;
                let miracle = null;
                if (r.uuid) {
                    try {
                        const doc = await fromUuid(r.uuid);
                        if (doc) miracle = { name: doc.name, img: doc.img };
                    } catch { miracle = null; }
                }
                return { idx, uuid: r.uuid ?? "", cascadeSteps, miracle };
            }));
        }
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        // 閲覧モードでは参照行のプルダウンを読み取り専用にする(追加/削除は CSS で非表示・スタイル技能シートと同じ)
        if (!context.isEditMode) {
            for (const el of this.element.querySelectorAll(".tnx-asother-section .tnx-combo-card select")) el.disabled = true;
            return;
        }

        // 条件技能のカスケード: 上流を変えたら下流をリセットし、配列全体を送る(フォーム送信には流さない)
        for (const sel of this.element.querySelectorAll('.tnx-asother-section select[name^="system.asOther.refs."]')) {
            sel.addEventListener("change", (event) => { event.stopPropagation(); this._onAsOtherRefChange(event); });
        }
        // 参照先の神業: 行ごとのドロップゾーン
        for (const zone of this.element.querySelectorAll('.tnx-import-box--dropzone[data-drop-area^="asother-"]')) {
            zone.addEventListener("dragover", (event) => event.preventDefault());
            zone.addEventListener("drop", (event) => this._onDropAsOtherRef(event, Number(zone.dataset.dropArea.split("-")[1])));
        }
        // 参照先のリンク解除(スタイルシートの神業リンクと同じ右クリックメニュー)
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu-type="asother-ref"]', [{
            name: "リンク解除",
            icon: '<i class="fas fa-unlink"></i>',
            callback: async (target) => {
                const idx = Number(target?.dataset?.index);
                await this._patchAsOtherRef(idx, { uuid: "" });
            },
        }], { jQuery: false, fixed: true });
    }

    /** 参照行の複製(欠けたフィールドを補う)。 */
    _asOtherRefs() {
        return (this.item.system.asOther?.refs ?? []).map(r => ({
            skillDict: r.skillDict ?? "", skillGroup: r.skillGroup ?? "", skillSub: r.skillSub ?? "",
            name: r.name ?? "", uuid: r.uuid ?? "",
        }));
    }

    async _patchAsOtherRef(idx, patch) {
        const list = this._asOtherRefs();
        if (!list[idx]) return;
        list[idx] = { ...list[idx], ...patch };
        await this.item.update({ "system.asOther.refs": list });
    }

    async _onAsOtherRefChange(event) {
        const m = event.currentTarget.name.match(/^system\.asOther\.refs\.(\d+)\.(skillDict|skillGroup|skillSub|name)$/);
        if (!m) return;
        const idx = Number(m[1]);
        const field = m[2];
        const list = this._asOtherRefs();
        if (!list[idx]) return;
        list[idx][field] = event.currentTarget.value;
        if (field === "skillDict")  { list[idx].skillGroup = ""; list[idx].skillSub = ""; list[idx].name = ""; }
        if (field === "skillGroup") { list[idx].skillSub = ""; list[idx].name = ""; }
        if (field === "skillSub")   { list[idx].name = ""; }
        await this.item.update({ "system.asOther.refs": list });
    }

    async _onDropAsOtherRef(event, idx) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (data?.type !== "Item") return;
        const doc = await Item.fromDropData(data);
        if (doc?.type !== "miracle") { ui.notifications.warn("参照先にできるのは「神業」タイプのアイテムのみです。"); return; }
        if (doc.uuid === this.item.uuid) { ui.notifications.warn("自分自身は参照先にできません。"); return; }
        await this._patchAsOtherRef(idx, { uuid: doc.uuid });
    }

    static async _onAsOtherRefAdd() {
        const list = this._asOtherRefs();
        list.push({ skillDict: "", skillGroup: "", skillSub: "", name: "", uuid: "" });
        await this.item.update({ "system.asOther.refs": list });
    }

    static async _onAsOtherRefDelete(_event, target) {
        const idx = Number(target.dataset.index);
        const list = this._asOtherRefs();
        if (!(idx >= 0 && idx < list.length)) return;
        list.splice(idx, 1);
        await this.item.update({ "system.asOther.refs": list });
    }

    static async _onAsOtherRefOpen(_event, target) {
        const idx = Number(target.dataset.index);
        const uuid = this.item.system.asOther?.refs?.[idx]?.uuid;
        if (!uuid) return;
        const doc = await fromUuid(uuid).catch(() => null);
        doc?.sheet?.render({ force: true });
    }
}
