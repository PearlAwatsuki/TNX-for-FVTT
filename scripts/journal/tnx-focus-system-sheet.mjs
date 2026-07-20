/**
 * @fileoverview TnxFocusSystemSheet - FS判定シート(JournalEntryPage type `focusSystem`)
 *
 * FS判定の**設定の置き場と閲覧用**。実行状態は持たない(正本はワールド設定の実行中 FS)。
 * 正本 → llm-wiki の Focus_System_Mechanics.md。
 */

import { loadGroupedGeneralSkillChoices, loadSkillEntries, SKILL_PACKS } from "../module/skill-dictionary.mjs";
import { formatSkillName } from "../module/identification.mjs";
import { PROGRESS_MOD_SOURCES, buildProgressModChoices } from "../module/progress-mod.mjs";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;

const TPL = "systems/tokyo-nova-axleration/templates/journal";

/** 選択済みの項目に selected を立てたグループを返す(テンプレート側で分岐を書かないため)。 */
function markSelected(groups, selectedKey, itemsKey, valueKey) {
    return (groups ?? []).map(g => ({
        ...g,
        [itemsKey]: (g[itemsKey] ?? []).map(o => ({ ...o, selected: o[valueKey] === selectedKey })),
    }));
}

export class TnxFocusSystemSheet extends JournalEntryPageHandlebarsSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-focus-system-sheet"],
        actions: {
            addRow:    TnxFocusSystemSheet._onAddRow,
            deleteRow: TnxFocusSystemSheet._onDeleteRow,
            rowUp:     TnxFocusSystemSheet._onRowUp,
            rowDown:   TnxFocusSystemSheet._onRowDown,
            spinUp:    TnxFocusSystemSheet._onSpin,
            spinDown:  TnxFocusSystemSheet._onSpin,
        },
    };

    static EDIT_PARTS = { content: { template: `${TPL}/focus-system-edit.hbs` } };
    static VIEW_PARTS = { content: { template: `${TPL}/focus-system-view.hbs` } };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const sys = this.document.system;
        const skillGroups = await loadGroupedGeneralSkillChoices();
        const entries = await loadSkillEntries(SKILL_PACKS.general);
        const nameOf = (key) => {
            const hit = entries.find(s => s.identificationKey === key);
            return hit?.name ? formatSkillName(hit.name) : "";
        };

        const rows = (sys.rows ?? []).map((r, index) => {
            const source = r.progressMod?.source ?? "none";
            return {
                ...r,
                index,
                skillGroups:  markSelected(skillGroups, r.skillKey, "skills", "identificationKey"),
                hasParam:     source !== "none",
                paramGroups:  markSelected(buildProgressModChoices(source), r.progressMod?.param, "params", "value"),
                formulaPlaceholder: source === "none" ? "3" : "@param",
                skillLabel:   nameOf(r.skillKey),
                modLabel:     r.progressMod?.formula ?? "",
            };
        });

        return {
            ...context,
            system:            sys,
            isDefeatCut:       (sys.defeatCondition?.type ?? "cut") === "cut",
            skillGroups:       markSelected(skillGroups, sys.supportSkillKey, "skills", "identificationKey"),
            supportSkillLabel: nameOf(sys.supportSkillKey),
            sourceOptions:     PROGRESS_MOD_SOURCES,
            rows,
        };
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        if (!el) return;

        // 敗北条件の種別 → カット数/自由文の切り替え
        const typeSelect = el.querySelector(".fs-defeat-type");
        const syncDefeat = () => {
            const isCut = (typeSelect?.value ?? "cut") === "cut";
            el.querySelector(".fs-defeat-cut")?.toggleAttribute("hidden", !isCut);
            el.querySelector(".fs-defeat-other")?.toggleAttribute("hidden", isCut);
        };
        typeSelect?.addEventListener("change", syncDefeat);

        // 進行修正の参照元 → パラメータ欄の表示切り替え(候補は保存後の再描画で入る)
        for (const sel of el.querySelectorAll(".fs-mod-source")) {
            sel.addEventListener("change", () => {
                const group = sel.closest(".usage-form-section")?.querySelector(".fs-mod-param");
                group?.toggleAttribute("hidden", sel.value === "none");
            });
        }
    }

    // ─── 判定行の操作 ─────────────────────────────────────────────────────────

    /** 現在の判定行のコピーを返す。 */
    _rows() {
        return foundry.utils.deepClone(this.document.system.rows ?? []);
    }

    static async _onAddRow(_event, _target) {
        const rows = this._rows();
        rows.push({
            id: foundry.utils.randomID(),
            threshold: 0, skillKey: "", targetValue: 0,
            progressMod: { source: "none", param: "", formula: "" },
            note: "",
        });
        await this.document.update({ "system.rows": rows });
    }

    static async _onDeleteRow(_event, target) {
        const index = Number(target.closest(".fs-row")?.dataset.index);
        const rows = this._rows();
        if (!Number.isInteger(index) || !rows[index]) return;
        rows.splice(index, 1);
        await this.document.update({ "system.rows": rows });
    }

    static async _onRowUp(_event, target) {
        await this.constructor._moveRow.call(this, target, -1);
    }

    static async _onRowDown(_event, target) {
        await this.constructor._moveRow.call(this, target, 1);
    }

    /** 判定行を手動で並び替える(表・リスト系 UI は既定で並び替え可能=TNX 標準)。 */
    static async _moveRow(target, delta) {
        const index = Number(target.closest(".fs-row")?.dataset.index);
        const rows = this._rows();
        const next = index + delta;
        if (!Number.isInteger(index) || !rows[index] || !rows[next]) return;
        [rows[index], rows[next]] = [rows[next], rows[index]];
        await this.document.update({ "system.rows": rows });
    }

    /** number-input-spinner の ± 。 */
    static _onSpin(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector("input[type=number]");
        if (!input) return;
        if (target.dataset.action === "spinUp") input.stepUp();
        else input.stepDown();
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
}
