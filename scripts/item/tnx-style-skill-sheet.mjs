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
                spade:   { label: game.i18n.localize("TNX.Suits.spade"),   disabled: false },
                club:    { label: game.i18n.localize("TNX.Suits.club"),    disabled: false },
                heart:   { label: game.i18n.localize("TNX.Suits.heart"),   disabled: false },
                diamond: { label: game.i18n.localize("TNX.Suits.diamond"), disabled: false },
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

        for (const btn of this.element.querySelectorAll(".add-array-item")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddArrayItem(event);
            });
        }

        for (const btn of this.element.querySelectorAll(".delete-array-item")) {
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

    async _onSelectChange(event) {
        const select = event.currentTarget;
        const fieldName = select.name;
        const value = select.value;
        const updateData = { [fieldName]: value };

        const resetLogic = (clears) => {
            const targetsToClear = clears[value] || clears["default"] || [];
            for (const prop of targetsToClear) {
                updateData[`system.${prop}`] = prop.includes("Number") ? 0 : "";
            }
        };

        if (fieldName === "system.maxLevel") {
            resetLogic({ number: ["maxLevelOther"], other: ["maxLevelNumber"], default: ["maxLevelNumber", "maxLevelOther"] });
        } else if (fieldName === "system.targetValue") {
            resetLogic({ number: ["targetValueOther"], other: ["targetValueNumber"], default: ["targetValueNumber", "targetValueOther"] });
        } else if (fieldName === "system.target") {
            resetLogic({ other: [], default: ["targetOther"] });
        } else if (fieldName === "system.range") {
            resetLogic({ other: [], default: ["rangeOther"] });
        }

        const comboMatch = fieldName.match(/^system\.comboSkill\.(\d+)\.value$/);
        const confrontMatch = fieldName.match(/^system\.confrontation\.(\d+)\.value$/);
        const timingMatch = fieldName.match(/^system\.timing\.(\d+)\.value$/);

        if (comboMatch) {
            const idx = comboMatch[1];
            resetLogic({ skillName: [], other: [], default: [`comboSkill.${idx}.name`] });
        } else if (confrontMatch) {
            const idx = confrontMatch[1];
            resetLogic({ skillName: [], skillNameAsterisk: [], other: [], default: [`confrontation.${idx}.name`] });
        } else if (timingMatch) {
            const idx = timingMatch[1];
            const prefix = `system.timing.${idx}.`;
            if (value === "action") {
                updateData[`${prefix}processName`] = "blank";
                updateData[`${prefix}timingOther`] = "";
            } else if (value === "process") {
                updateData[`${prefix}actionName`] = "blank";
                updateData[`${prefix}timingOther`] = "";
            } else if (value === "other") {
                updateData[`${prefix}actionName`] = "blank";
                updateData[`${prefix}processName`] = "blank";
            } else {
                updateData[`${prefix}actionName`] = "blank";
                updateData[`${prefix}processName`] = "blank";
                updateData[`${prefix}timingOther`] = "";
            }
        }

        await this.item.update(updateData);
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
