import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";

export class TokyoNovaStyleSkillSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "skill"],
        position: { width: 600, height: 650 },
        actions: {
            incrementMaxLevel:    TokyoNovaStyleSkillSheet._onIncrementMaxLevel,
            decrementMaxLevel:    TokyoNovaStyleSkillSheet._onDecrementMaxLevel,
            incrementTargetValue: TokyoNovaStyleSkillSheet._onIncrementTargetValue,
            decrementTargetValue: TokyoNovaStyleSkillSheet._onDecrementTargetValue,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.options = TnxSkillUtils.getSkillOptions();
        const system = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        context.system = system;
        context.TNX = {
            SUITS: {
                spade:   { label: "スペード", disabled: false },
                club:    { label: "クラブ",   disabled: false },
                heart:   { label: "ハート",   disabled: false },
                diamond: { label: "ダイヤ",   disabled: false },
            },
        };
        context.view = TnxSkillUtils.prepareStyleSkillView(system, context.options);
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.editable) return;

        for (const input of this.element.querySelectorAll('.suit-selection input[type="checkbox"]')) {
            input.addEventListener("change", (event) => {
                TnxSkillUtils.onSuitChange(event, this);
            });
        }

        for (const select of this.element.querySelectorAll("select")) {
            select.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onSelectChange(event);
            });
        }

        // isLimit チェックボックス: 解除時に uses フィールドをリセット
        this.element.querySelector('input[name="system.uses.isLimit"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onUsesLimitChange(event);
            });

        // isSubstitute チェックボックス: 解除時に substituteTarget をリセット
        this.element.querySelector('input[name="system.isSubstitute"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onIsSubstituteChange(event);
            });

        // works.value チェックボックス: 解除時に organization をリセット
        this.element.querySelector('input[name="system.special.works.value"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onWorksChange(event);
            });

        for (const btn of this.element.querySelectorAll(".tnx-row-btn")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddArrayItem(event);
            });
        }

        for (const btn of this.element.querySelectorAll(".tnx-row-btn--delete")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onDeleteArrayItem(event);
            });
        }
    }

    // ─── スピナーハンドラ ──────────────────────────────────────────────────────

    static async _onIncrementMaxLevel(_event, _target) {
        await this.item.update({ "system.maxLevelNumber": (this.item.system.maxLevelNumber || 0) + 1 });
    }

    static async _onDecrementMaxLevel(_event, _target) {
        await this.item.update({ "system.maxLevelNumber": (this.item.system.maxLevelNumber || 0) - 1 });
    }

    static async _onIncrementTargetValue(_event, _target) {
        await this.item.update({ "system.targetValueNumber": (this.item.system.targetValueNumber || 0) + 1 });
    }

    static async _onDecrementTargetValue(_event, _target) {
        await this.item.update({ "system.targetValueNumber": (this.item.system.targetValueNumber || 0) - 1 });
    }

    // ─── 配列操作ハンドラ ──────────────────────────────────────────────────────

    async _onAddArrayItem(event) {
        const target = event.currentTarget.dataset.target;
        const normalizedSs = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        const updateData = {};

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            list.push({ value: "blank", name: "", isMandatory: false });
            updateData["system.comboSkill"] = list;
        } else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            list.push({ value: "blank", name: "" });
            updateData["system.confrontation"] = list;
        } else if (target === "timing") {
            const list = [...normalizedSs.timing];
            list.push({ value: "blank", actionName: "blank", processName: "blank", timingOther: "" });
            updateData["system.timing"] = list;
        } else if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            list.push("");
            updateData["system.substituteTarget"] = list;
        }

        if (Object.keys(updateData).length) await this.item.update(updateData);
    }

    async _onDeleteArrayItem(event) {
        const target = event.currentTarget.dataset.target;
        const index = Number(event.currentTarget.dataset.index);
        const normalizedSs = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        const updateData = {};

        const spliceList = (list, key) => {
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData[key] = list;
            }
        };

        if (target === "combo")          spliceList([...normalizedSs.comboSkill],       "system.comboSkill");
        else if (target === "confrontation") spliceList([...normalizedSs.confrontation], "system.confrontation");
        else if (target === "timing")    spliceList([...normalizedSs.timing],            "system.timing");
        else if (target === "substitute") spliceList([...normalizedSs.substituteTarget], "system.substituteTarget");

        if (Object.keys(updateData).length) await this.item.update(updateData);
    }

    async _onUsesLimitChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.uses.isLimit": isChecked };
        if (!isChecked) {
            update["system.uses.value"] = 0;
            update["system.uses.max"]   = 0;
            update["system.uses.type"]  = "";
        }
        await this.item.update(update);
    }

    async _onIsSubstituteChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.isSubstitute": isChecked };
        if (!isChecked) update["system.substituteTarget"] = [];
        await this.item.update(update);
    }

    async _onWorksChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.special.works.value": isChecked };
        if (!isChecked) update["system.special.works.organization"] = "-";
        await this.item.update(update);
    }

    async _onSelectChange(event) {
        const select = event.currentTarget;
        const fieldName = select.name;
        const value = select.value;

        // ── スカラーフィールド ────────────────────────────────────────────
        if (fieldName === "system.maxLevel") {
            const d = { [fieldName]: value };
            if (value !== "number") d["system.maxLevelNumber"] = 0;
            if (value !== "other")  d["system.maxLevelOther"]  = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.targetValue") {
            const d = { [fieldName]: value };
            if (value !== "number") d["system.targetValueNumber"] = 0;
            if (value !== "other")  d["system.targetValueOther"]  = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.target") {
            const d = { [fieldName]: value };
            if (value !== "other") d["system.targetOther"] = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.range") {
            const d = { [fieldName]: value };
            if (value !== "other") d["system.rangeOther"] = "";
            await this.item.update(d);
            return;
        }

        // ── 配列フィールド（配列全体を送って index 消失を防ぐ） ──────────
        const ns = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);

        const comboMatch    = fieldName.match(/^system\.comboSkill\.(\d+)\.value$/);
        const confrontMatch = fieldName.match(/^system\.confrontation\.(\d+)\.value$/);
        const timingMatch   = fieldName.match(/^system\.timing\.(\d+)\.value$/);
        const timingSubMatch = fieldName.match(/^system\.timing\.(\d+)\.(actionName|processName)$/);

        if (comboMatch) {
            const idx = Number(comboMatch[1]);
            const list = foundry.utils.deepClone(ns.comboSkill);
            if (list[idx]) {
                list[idx].value = value;
                if (value !== "skillName" && value !== "other") list[idx].name = "";
            }
            await this.item.update({ "system.comboSkill": list });
            return;
        }
        if (confrontMatch) {
            const idx = Number(confrontMatch[1]);
            const list = foundry.utils.deepClone(ns.confrontation);
            if (list[idx]) {
                list[idx].value = value;
                if (value !== "skillName" && value !== "skillNameAsterisk" && value !== "other") list[idx].name = "";
            }
            await this.item.update({ "system.confrontation": list });
            return;
        }
        if (timingMatch) {
            const idx = Number(timingMatch[1]);
            const list = foundry.utils.deepClone(ns.timing);
            if (list[idx]) {
                list[idx].value = value;
                if (value === "action")        { list[idx].processName = "blank"; list[idx].timingOther = ""; }
                else if (value === "process")  { list[idx].actionName  = "blank"; list[idx].timingOther = ""; }
                else if (value === "other")    { list[idx].actionName  = "blank"; list[idx].processName = "blank"; }
                else                           { list[idx].actionName  = "blank"; list[idx].processName = "blank"; list[idx].timingOther = ""; }
            }
            await this.item.update({ "system.timing": list });
            return;
        }
        if (timingSubMatch) {
            const idx = Number(timingSubMatch[1]);
            const list = foundry.utils.deepClone(ns.timing);
            if (list[idx]) list[idx][timingSubMatch[2]] = value;
            await this.item.update({ "system.timing": list });
            return;
        }

        // ── その他（styleSkillCategory / unique 等） ─────────────────────
        await this.item.update({ [fieldName]: value });
    }

    // ─── 静的ヘルパー ──────────────────────────────────────────────────────────

    /** system データの配列フィールドを正規化して返す */
    static _normalizeSystem(item) {
        const system = foundry.utils.deepClone(item.system);

        const ensureArray = (val) => {
            if (Array.isArray(val)) return val;
            if (typeof val === "object" && val !== null && Object.keys(val).length > 0) return Object.values(val);
            if (typeof val === "string" && val !== "" && val !== "-") return [{ value: val }];
            return [];
        };

        system.comboSkill = ensureArray(system.comboSkill);
        if (!system.comboSkill.length) system.comboSkill = [{ value: "blank", name: "", isMandatory: false }];

        system.confrontation = ensureArray(system.confrontation);
        if (!system.confrontation.length) system.confrontation = [{ value: "blank", name: "" }];

        system.timing = ensureArray(system.timing);
        if (!system.timing.length) system.timing = [{ value: "blank", actionName: "blank", processName: "blank", timingOther: "" }];

        if (!Array.isArray(system.substituteTarget)) {
            if (typeof system.substituteTarget === "object" && system.substituteTarget !== null) {
                system.substituteTarget = Object.values(system.substituteTarget);
            } else if (typeof system.substituteTarget === "string" && system.substituteTarget !== "") {
                system.substituteTarget = [system.substituteTarget];
            } else {
                system.substituteTarget = [];
            }
        }
        if (!system.substituteTarget.length) system.substituteTarget = [""];

        return system;
    }
}
