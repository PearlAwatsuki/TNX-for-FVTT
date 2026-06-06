import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";

export class TokyoNovaGeneralSkillSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "skill"],
        position: { width: 600, height: 650 },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/general-skill-sheet.hbs" },
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
        foundry.utils.mergeObject(context.options, TnxSkillUtils.getSkillOptions());
        const system = foundry.utils.deepClone(this.item.system);
        context.system = system;
        const initialSuit = system.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
                spade:   { label: game.i18n.localize("TNX.Suits.spade"),   disabled: initialSuit === "spade" },
                club:    { label: game.i18n.localize("TNX.Suits.club"),    disabled: initialSuit === "club" },
                heart:   { label: game.i18n.localize("TNX.Suits.heart"),   disabled: initialSuit === "heart" },
                diamond: { label: game.i18n.localize("TNX.Suits.diamond"), disabled: initialSuit === "diamond" },
            },
        };
        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.editable) return;

        // スートチェックボックス: auto-submit に任せつつ level も更新
        for (const input of this.element.querySelectorAll('.suit-selection input[type="checkbox"]')) {
            input.addEventListener("change", (event) => {
                TnxSkillUtils.onSuitChange(event, this);
            });
        }

        // 固有名詞技能 isInitial: combined update のため stop propagation
        const isInitialInput = this.element.querySelector('input[name="system.onomasticSkill.isInitial"]');
        if (isInitialInput) {
            isInitialInput.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onInitialSkillChange(event);
            });
        }

        // セレクト: combined update のため stop propagation
        for (const select of this.element.querySelectorAll("select")) {
            select.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onSelectChange(event);
            });
        }
    }

    async _onSelectChange(event) {
        const select = event.currentTarget;
        const fieldName = select.name;
        const value = select.value;
        const updateData = { [fieldName]: value };

        if (fieldName === "system.initialSkill.initialSuit") {
            const validSuits = ["spade", "club", "heart", "diamond"];
            const oldSuit = this.item.system.initialSkill?.initialSuit;

            if (oldSuit && validSuits.includes(oldSuit) && oldSuit !== value) {
                updateData[`system.suits.${oldSuit}`] = false;
            }
            if (validSuits.includes(value)) {
                updateData[`system.suits.${value}`] = true;
            }

            let newLevel = 0;
            const currentSuits = this.item.system.suits;
            for (const suit of validSuits) {
                let isActive = currentSuits[suit];
                const updateKey = `system.suits.${suit}`;
                if (updateKey in updateData) isActive = updateData[updateKey];
                if (isActive) newLevel++;
            }
            updateData["system.level"] = newLevel;
        }

        if (fieldName === "system.generalSkillCategory") {
            if (value !== "initialSkill") {
                updateData["system.initialSkill.initialSuit"] = "";
                const oldInitialSuit = this.item.system.initialSkill?.initialSuit;
                const validSuits = ["spade", "club", "heart", "diamond"];
                if (oldInitialSuit && validSuits.includes(oldInitialSuit)) {
                    updateData[`system.suits.${oldInitialSuit}`] = false;
                    let newLevel = 0;
                    const currentSuits = this.item.system.suits;
                    for (const suit of validSuits) {
                        let isActive = currentSuits[suit];
                        if (suit === oldInitialSuit) isActive = false;
                        if (isActive) newLevel++;
                    }
                    updateData["system.level"] = newLevel;
                }
            } else {
                if (this.item.system.onomasticSkill?.isInitial) {
                    updateData["system.onomasticSkill.isInitial"] = false;
                    updateData["system.level"] = 0;
                }
            }
        }

        await this.item.update(updateData);
    }

    async _onInitialSkillChange(event) {
        const isChecked = event.currentTarget.checked;
        const updateData = { "system.onomasticSkill.isInitial": isChecked };
        if (isChecked) {
            if (this.item.system.level === 0) updateData["system.level"] = 1;
        } else {
            updateData["system.level"] = 0;
        }
        await this.item.update(updateData);
    }
}
