import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";
import {
    ONOMASTIC_TYPES, SOCIETY_CLASSES, onomasticTypeOf, composeOnomasticName, stripSkillCategory,
} from "../module/skill-dictionary.mjs";

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
        // 固有名詞技能の区分・社会下位区分(2026-08-26 裁定)。区分はフィールド優先・プレフィックス導出
        context.options.onomasticType = { "": "-", ...ONOMASTIC_TYPES };
        context.options.societyClass  = { "": "-", ...SOCIETY_CLASSES };
        const onomType = onomasticTypeOf(system);
        const typeLabel = ONOMASTIC_TYPES[onomType] ?? "";
        context.onomastic = {
            active: system.generalSkillCategory !== "initialSkill" && !!typeLabel,
            type: onomType,
            isSociety: onomType === "society",
            prefix: typeLabel ? `${typeLabel}：` : "",
            // 名前欄には固有名詞部分だけを出す(保存形はフル名のまま)。現在のプレフィックスで
            // 始まらない旧い名前はそのまま出し、次にこの欄を編集したときだけ正規形へ合成される
            suffix: typeLabel ? stripSkillCategory(this.item.name ?? "", typeLabel) : (this.item.name ?? ""),
        };
        const initialSuit = system.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
                spade:   { label: "スペード", disabled: initialSuit === "spade" },
                club:    { label: "クラブ",   disabled: initialSuit === "club" },
                heart:   { label: "ハート",   disabled: initialSuit === "heart" },
                diamond: { label: "ダイヤ",   disabled: initialSuit === "diamond" },
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

        // 固有名詞のアイテム名: プレフィックス(区分ラベル)＋固有名詞で合成して保存する(2026-08-26)。
        // 入力欄は name 属性を持たない(フォーム自動送信で固有名詞部分が素の名前として保存される
        // のを防ぐ)ため、ここで合成して明示 update する。空にされたら表示を戻すだけ(名前は消さない)
        this.element.querySelector("[data-onomastic-name]")?.addEventListener("change", (event) => {
            event.stopPropagation();
            const suffix = String(event.currentTarget.value ?? "").trim();
            if (!suffix) return void this.render();
            const composed = composeOnomasticName(onomasticTypeOf(this.item.system), suffix);
            this.item.update({ name: composed || suffix });
        });

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

        if (fieldName === "system.onomasticType") {
            // 区分の切り替え(2026-08-26): ①識別キーが空ならプレフィックスをプレフィル
            // ②名前が旧区分の正規形なら新区分で合成し直す(合わない名前は触らない)
            if (value && !this.item.system.identificationKey) {
                updateData["system.identificationKey"] = `${value}_`;
            }
            if (value !== "society") updateData["system.societyClass"] = "";
            const oldType = onomasticTypeOf(this.item.system);
            const oldLabel = ONOMASTIC_TYPES[oldType] ?? "";
            const name = this.item.name ?? "";
            if (oldLabel && name.startsWith(`${oldLabel}：`)) {
                const composed = composeOnomasticName(value, stripSkillCategory(name, oldLabel));
                if (composed) updateData.name = composed;
            }
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
