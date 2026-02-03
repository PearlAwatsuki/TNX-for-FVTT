import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";

export class TokyoNovaGeneralSkillSheet extends ItemSheet {

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
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
        html.find('select').on('change', this._onSelectChange.bind(this));
        html.find('input[name="system.onomasticSkill.isInitial"]').on('change', this._onInitialSkillChange.bind(this));
    }

    async _onSuitChange(event) {
        // 既存のリスナー (変更なし)
        const checkedSuits = this.form.querySelectorAll('.suit-selection input[type="checkbox"]:checked');
        const newLevel = checkedSuits.length;

        if (this.item.system.level !== newLevel) {
            await this.item.update({"system.level": newLevel});
        }
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

        if (fieldName === "system.initialSkill.initialSuit") {
            const validSuits = ["spade", "club", "heart", "diamond"];
            
            // 変更前の初期スートを取得
            const oldSuit = this.item.system.initialSkill?.initialSuit;

            // 1. 変更前のスートがあり、有効な値なら false (チェック解除) を予約
            //    ※新しい値と同じ場合は無視（通常ありえませんが念のため）
            if (oldSuit && validSuits.includes(oldSuit) && oldSuit !== value) {
                updateData[`system.suits.${oldSuit}`] = false;
            }

            // 2. 新しいスートが有効な値なら true (チェック) を予約
            if (validSuits.includes(value)) {
                updateData[`system.suits.${value}`] = true;
            }

            // 3. レベルの再計算
            // 現在のアイテムの状態(this.item.system.suits)に対し、
            // 今回の updateData による変更を加味してレベルを算出します
            let newLevel = 0;
            const currentSuits = this.item.system.suits;

            for (const suit of validSuits) {
                let isActive = currentSuits[suit]; // 現在の状態

                // updateDataで変更される予定がある場合はその値を優先
                // (注意: updateDataのキーは "system.suits.spade" のような形式)
                const updateKey = `system.suits.${suit}`;
                if (updateKey in updateData) {
                    isActive = updateData[updateKey];
                }

                if (isActive) {
                    newLevel++;
                }
            }
            updateData[`system.level`] = newLevel;
        }

        // 更新実行
        if (Object.keys(updateData).length > 1) { // 自分自身以外の変更がある場合のみ
            await this.item.update(updateData);
        }
    }

    async _onInitialSkillChange(event) {
        const isChecked = event.currentTarget.checked;
        // チェックが入った時、レベルが0であれば1に設定する
        if (isChecked && this.item.system.level === 0) {
            await this.item.update({ "system.level": 1 });
        }
    }
}