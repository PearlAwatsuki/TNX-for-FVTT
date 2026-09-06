import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

/** 区分に指定できる技能アイテム(〈フォルム〉〈属性〉等)。 */
const SKILL_TYPES = ["generalSkill", "styleSkill"];

/**
 * 神業シート。「効果の参照」タブ(17-5・アイテム側の機能)を持つ: 《万能道具》《神意》は、取得した
 * 区分(〈フォルム〉〈属性〉)によって**効果と経験点の取得条件が指定の神業と同じになる**——
 * その神業「として」使うのではない(2026-09-06 ユーザー訂正)。
 * 表の1行＝[区分の技能][参照する神業]で、**どちらもドロップで結線する**——区分と神業は1対1で
 * 他の候補が入る余地が無いため(選ぶ操作ではない=2026-09-06 の基準)。
 * **《万能道具》はスタイルを設定した時点で固定される**(〈フォルム〉を選ぶ時点=2026-09-06 ユーザー裁定)が、
 * 《半身》のように後で決まるもの(リーダー決定時)もあるため、**効果はいつでも選び直せる**
 * (対応表の行から選ぶプルダウン)。表とプルダウンは設定タブに置く。
 * 行は配列全体を送って更新する(スタイル技能シートのコンボ行と同方式)。対応表はコードに持たず、
 * 辞典データ側にこの表として設定する。
 */
export class TokyoNovaMiracleSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "miracle"],
        position: { width: 600, height: 600 },
        actions: {
            asOtherChoiceAdd:    TokyoNovaMiracleSheet._onAsOtherChoiceAdd,
            asOtherChoiceDelete: TokyoNovaMiracleSheet._onAsOtherChoiceDelete,
            asOtherChoiceOpen:   TokyoNovaMiracleSheet._onAsOtherChoiceOpen,
            asOtherSkillOpen:    TokyoNovaMiracleSheet._onAsOtherSkillOpen,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs" },
    };

    static TABS = {
        primary: {
            // 神業に「効果」タブは置かない——神業に適用される ActiveEffect は無く、事前設定もできない
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }],
            initial: "description",
        },
    };

    /** 選び方の選択肢。見聞きした神業のコピー(《突然変異》)は宣言の効果へ移した(2026-09-06)。 */
    static AS_OTHER_MODES = Object.freeze({
        "":     "なし",
        choice: "区分ごとに参照する神業を決める",
    });

    /** uuid を {name, img} にライブ解決する(削除済みは null)。 */
    static async _resolveRef(uuid) {
        if (!uuid) return null;
        try {
            const doc = await fromUuid(uuid);
            return doc ? { name: doc.name, img: doc.img } : null;
        } catch { return null; }
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.enrichedConditionDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.item.system.usageCondition ?? "",
            { relativeTo: this.item, editable: context.editable }
        );

        // 効果の参照(17-5): 行ごとに区分の技能と参照する神業をライブ解決する(選択中の行はラジオ)
        const asOther = this.item.system.asOther ?? { mode: "", choices: [], selected: "" };
        context.asOtherModeOptions = TokyoNovaMiracleSheet.AS_OTHER_MODES;
        context.asOtherIsChoice = asOther.mode === "choice";
        if (context.asOtherIsChoice) {
            const rows = await Promise.all((asOther.choices ?? []).map(async (c, idx) => ({
                idx,
                uuid: c.uuid ?? "",
                selected: !!c.uuid && c.uuid === asOther.selected,
                skill:   await TokyoNovaMiracleSheet._resolveRef(c.skillUuid),
                miracle: await TokyoNovaMiracleSheet._resolveRef(c.uuid),
            })));
            context.asOtherChoices = rows;
            // 効果は対応表の行から選ぶ。《万能道具》はスタイルを設定した時点で固定されるが、
            // 《半身》のように後で決まるもの(リーダー決定時)はここで選ぶ(2026-09-06)
            context.asOtherSelectOptions = [
                { value: "", label: "（未選択）", selected: !asOther.selected },
                ...rows.filter(r => r.uuid).map(r => ({
                    value: r.uuid,
                    label: r.skill ? `${r.skill.name}：${r.miracle?.name ?? "?"}` : (r.miracle?.name ?? "?"),
                    selected: r.selected,
                })),
            ];
        }
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.isEditMode) return;

        // 区分の技能・参照先の神業: 行ごとのドロップゾーン(どちらもドロップで指定する)
        for (const zone of this.element.querySelectorAll('[data-drop-area^="asother"]')) {
            const [kind, idxRaw] = zone.dataset.dropArea.split("-");
            const idx = Number(idxRaw);
            zone.addEventListener("dragover", (event) => event.preventDefault());
            zone.addEventListener("drop", (event) => (kind === "asotherSkill"
                ? this._onDropAsOtherSkill(event, idx)
                : this._onDropAsOtherMiracle(event, idx)));
        }
        // リンク解除(スタイルシートの神業リンクと同じ右クリックメニュー)
        const CM = foundry.applications.ux.ContextMenu.implementation;
        const unlink = (field) => [{
            name: "リンク解除",
            icon: '<i class="fas fa-unlink"></i>',
            callback: async (target) => {
                await this._patchAsOtherChoice(Number(target?.dataset?.index), { [field]: "" });
            },
        }];
        new CM(this.element, '[data-context-menu-type="asother-skill"]', unlink("skillUuid"), { jQuery: false, fixed: true });
        new CM(this.element, '[data-context-menu-type="asother-choice"]', unlink("uuid"), { jQuery: false, fixed: true });
    }

    /** 選択肢の複製(欠けたフィールドを補う)。 */
    _asOtherChoices() {
        return (this.item.system.asOther?.choices ?? []).map(c => ({ skillUuid: c.skillUuid ?? "", uuid: c.uuid ?? "" }));
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

    /** ドロップされたアイテムを解決する(型が合わなければ警告して null)。 */
    async _dropItemOfTypes(event, types, label) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return null; }
        if (data?.type !== "Item") return null;
        const doc = await Item.fromDropData(data);
        if (!doc || !types.includes(doc.type)) {
            ui.notifications.warn(`${label}をドロップしてください。`);
            return null;
        }
        return doc;
    }

    async _onDropAsOtherSkill(event, idx) {
        const doc = await this._dropItemOfTypes(event, SKILL_TYPES, "技能アイテム");
        if (doc) await this._patchAsOtherChoice(idx, { skillUuid: doc.uuid });
    }

    async _onDropAsOtherMiracle(event, idx) {
        const doc = await this._dropItemOfTypes(event, ["miracle"], "神業アイテム");
        if (!doc) return;
        if (doc.uuid === this.item.uuid) { ui.notifications.warn("自分自身は参照先にできません。"); return; }
        await this._patchAsOtherChoice(idx, { uuid: doc.uuid });
    }

    static async _onAsOtherChoiceAdd() {
        const list = this._asOtherChoices();
        list.push({ skillUuid: "", uuid: "" });
        await this._updateAsOtherChoices(list);
    }

    static async _onAsOtherChoiceDelete(_event, target) {
        const idx = Number(target.dataset.index);
        const list = this._asOtherChoices();
        if (!(idx >= 0 && idx < list.length)) return;
        list.splice(idx, 1);
        await this._updateAsOtherChoices(list);
    }

    /** 参照先の神業のシートを開く。 */
    static async _onAsOtherChoiceOpen(_event, target) {
        await TokyoNovaMiracleSheet._openChoiceRef.call(this, target, "uuid");
    }

    /** 区分の技能のシートを開く。 */
    static async _onAsOtherSkillOpen(_event, target) {
        await TokyoNovaMiracleSheet._openChoiceRef.call(this, target, "skillUuid");
    }

    static async _openChoiceRef(target, field) {
        const uuid = this.item.system.asOther?.choices?.[Number(target.dataset.index)]?.[field];
        if (!uuid) return;
        const doc = await fromUuid(uuid).catch(() => null);
        doc?.sheet?.render({ force: true });
    }
}
