import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";

export class TokyoNovaGeneralSkillSheet extends TokyoNovaItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "skill"],
            template: "systems/tokyo-nova-axleration/templates/item/general-skill-sheet.hbs",
            width: 600,
            height: 650,
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        foundry.utils.mergeObject(context.options, TnxSkillUtils.getSkillOptions());
        const system = foundry.utils.deepClone(this.item.system);
        context.system = system; // hbsで system を使えるように

        // スートの無効化判定ロジック (変更なし)
        const initialSuit = system.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
                spade:   { label: game.i18n.localize("TNX.Suits.spade"),   disabled: initialSuit === "spade" },
                club:    { label: game.i18n.localize("TNX.Suits.club"),    disabled: initialSuit === "club" },
                heart:   { label: game.i18n.localize("TNX.Suits.heart"),   disabled: initialSuit === "heart" },
                diamond: { label: game.i18n.localize("TNX.Suits.diamond"),    disabled: initialSuit === "diamond" }
            }
        };
      
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
        html.find('.suit-selection input[type="checkbox"]').on('change', (event) => {TnxSkillUtils.onSuitChange(event, this)});
        html.find('select').on('change', this._onSelectChange.bind(this));
        html.find('input[name="system.onomasticSkill.isInitial"]').on('change', this._onInitialSkillChange.bind(this));
    }

    /**
     * ドロップダウン変更時に、選択されなかったモードの入力値をリセットする汎用処理
     */
    async _onSelectChange(event) {
        event.preventDefault();
        const select = event.currentTarget;
        const fieldName = select.name;
        const value = select.value;

        // 更新用データオブジェクト
        const updateData = {};
        updateData[fieldName] = value; // まず自分自身の変更を適用

        // 1. 初期スート変更時の処理 (既存ロジック)
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
            updateData[`system.level`] = newLevel;
        }

        // 2. 一般技能カテゴリ変更時の処理
        if (fieldName === "system.generalSkillCategory") {
            // Case A: 無条件取得技能(initialSkill)「以外」に変更された場合
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
            }
            // Case B: 無条件取得技能(initialSkill)「へ」変更された場合
            else {
                // 固有名詞技能などの「初期習得」チェックが入っていたら外す
                // チェックが入っている＝レベルが1になっているはずなので、0に戻す
                if (this.item.system.onomasticSkill?.isInitial) {
                    updateData["system.onomasticSkill.isInitial"] = false;
                    updateData["system.level"] = 0; 
                }
            }
        }

        await this.item.update(updateData);
    }

    async _onInitialSkillChange(event) {
        // デフォルトの挙動による二重更新を防ぐ場合があるため、明示的に処理します
        event.preventDefault();

        const isChecked = event.currentTarget.checked;
        
        // 更新用オブジェクトを作成し、まずはチェックボックスの状態をセット
        const updateData = {
            "system.onomasticSkill.isInitial": isChecked
        };

        // 1. チェックが入った時 (true)
        //    レベルが 0 であれば 1 に設定する（既存の処理）
        if (isChecked) {
            if (this.item.system.level === 0) {
                updateData["system.level"] = 1;
            }
        } 
        // 2. チェックが外れた時 (false)
        //    レベルを 0 に設定する（追加の処理）
        else {
            updateData["system.level"] = 0;
        }

        // 変更を一括適用
        await this.item.update(updateData);
    }
}