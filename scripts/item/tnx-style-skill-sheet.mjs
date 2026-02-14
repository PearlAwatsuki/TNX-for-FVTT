import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";

export class TokyoNovaStyleSkillSheet extends TokyoNovaItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "skill"],
            template: "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs",
            width: 600,
            height: 650,
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        // 基底クラスのデータを取得（解説のエンリッチ、エフェクト、用途タイプ等はここで準備される）
        const context = await super.getData(options);
        const system = context.system;

        // スート選択肢の定義（スタイル技能には初期スートによる無効化はないため、disabledは常にfalse）
        context.TNX = {
            SUITS: {
                spade:   { label: game.i18n.localize("TNX.Suits.spade"),   disabled: false },
                club:    { label: game.i18n.localize("TNX.Suits.club"),    disabled: false },
                heart:   { label: game.i18n.localize("TNX.Suits.heart"),   disabled: false },
                diamond: { label: game.i18n.localize("TNX.Suits.diamond"), disabled: false }
            }
        };

        // --- ドロップダウンの選択肢を定義 ---
        context.options = TnxSkillUtils.getSkillOptions();

        // 配列ライクなオブジェクト（Foundryの更新データ）を配列に変換するヘルパー
        const ensureArray = (val, defaultNameProp) => {
            if (Array.isArray(val)) return val;
            if (typeof val === 'object' && val !== null && Object.keys(val).length > 0) {
                return Object.values(val);
            }
            if (typeof val === 'string' && val !== "" && val !== "-") {
                const item = { value: val };
                if (defaultNameProp) item.name = defaultNameProp;
                if (defaultNameProp === system.comboSkillOther) item.isMandatory = false; 
                return [item];
            }
            return [];
        };

        // 1. 技能 (Combo Skill)
        system.comboSkill = ensureArray(system.comboSkill, system.comboSkillOther);
        if (system.comboSkill.length === 0) {
            system.comboSkill = [{ value: "blank", name: "", isMandatory: false }];
        }

        // 2. 対決 (Confrontation)
        system.confrontation = ensureArray(system.confrontation, system.confrontationOther);
        if (system.confrontation.length === 0) {
            system.confrontation = [{ value: "blank", name: "" }];
        }

        // 3. タイミング (Timing)
        system.timing = ensureArray(system.timing, null);
        if (system.timing.length === 0) {
            system.timing = [{
                value: "blank",
                actionName: "blank",
                processName: "blank",
                timingOther: ""
            }];
        }

        // substituteTarget は単純な文字列の配列として扱います
        if (!Array.isArray(system.substituteTarget)) {
            if (typeof system.substituteTarget === 'object' && system.substituteTarget !== null) {
                system.substituteTarget = Object.values(system.substituteTarget);
            } else if (typeof system.substituteTarget === 'string' && system.substituteTarget !== "") {
                system.substituteTarget = [system.substituteTarget];
            } else {
                system.substituteTarget = [];
            }
        }
        if (system.substituteTarget.length === 0) {
            system.substituteTarget = [""];
        }

        // 表示用ビューの生成をUtilsに委譲
        context.view = TnxSkillUtils.prepareStyleSkillView(system, context.options);

        return context;
    }

    activateListeners(html) {
        super.activateListeners(html); // 基底クラスのリスナーを有効化
        if (!this.isEditable) return;

        // スート変更時の共通処理 (Utilsへ委譲)
        html.find('.suit-selection input[type="checkbox"]').on('change', (event) => {TnxSkillUtils.onSuitChange(event, this);});

        // スタイル技能固有のリスナー
        html.find('.number-input-spinner button').on('click', this._onSpinnerButtonClick.bind(this));
        html.find('.add-array-item').on('click', this._onAddArrayItem.bind(this));
        html.find('.delete-array-item').on('click', this._onDeleteArrayItem.bind(this));
        html.find('select').on('change', this._onSelectChange.bind(this));
    }
    
    /**
     * 数値入力スピナーのボタンクリックを処理します。
     * @private
     */
    async _onSpinnerButtonClick(event) {
        event.preventDefault();
        const button = event.currentTarget;
        const action = button.dataset.action;
        const system = this.item.system;
        let updateData = {};

        switch (action) {
            case 'increment-max-level':
                updateData['system.maxLevelNumber'] = (system.maxLevelNumber || 0) + 1;
                break;
            case 'decrement-max-level':
                updateData['system.maxLevelNumber'] = (system.maxLevelNumber || 0) - 1;
                break;
            case 'increment-target-value':
                updateData['system.targetValueNumber'] = (system.targetValueNumber || 0) + 1;
                break;
            case 'decrement-target-value':
                updateData['system.targetValueNumber'] = (system.targetValueNumber || 0) - 1;
                break;
            default:
                return;
        }

        await this.item.update(updateData);
    }

    /**
     * 配列に行を追加する処理
     */
    async _onAddArrayItem(event) {
        event.preventDefault();
        const target = event.currentTarget.dataset.target; // "combo", "confrontation", "timing"
        
        // getDataを通した正規化済みデータを取得
        const context = await this.getData();
        const normalizedSs = context.system;
        let updateData = {};

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            list.push({ value: "blank", name: "", isMandatory: false });
            updateData['system.comboSkill'] = list;
        } 
        else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            list.push({ value: "blank", name: "" });
            updateData['system.confrontation'] = list;
        }
        else if (target === "timing") {
            const list = [...normalizedSs.timing];
            list.push({ value: "blank", actionName: "blank", processName: "blank", timingOther: "" });
            updateData['system.timing'] = list;
        }

        if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            list.push(""); // 空文字を追加
            updateData['system.substituteTarget'] = list;
        }

        await this.item.update(updateData);
    }

    /**
     * 配列から行を削除する処理
     */
    async _onDeleteArrayItem(event) {
        event.preventDefault();
        const target = event.currentTarget.dataset.target;
        const index = Number(event.currentTarget.dataset.index);
        
        // データ取得（正規化済み）
        const context = await this.getData();
        const normalizedSs = context.system;
        let updateData = {};

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.comboSkill'] = list;
            }
        } 
        else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.confrontation'] = list;
            }
        }
        else if (target === "timing") {
            const list = [...normalizedSs.timing];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.timing'] = list;
            }
        }

        if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.substituteTarget'] = list;
            }
        }

        await this.item.update(updateData);
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

        // --- リセットルールの定義 ---
        const resetLogic = (clears, basePrefix = "system.") => {
            const targetsToClear = clears[value] || clears["default"] || [];
            targetsToClear.forEach(prop => {
                const clearValue = prop.includes("Number") ? 0 : "";
                updateData[`${basePrefix}${prop}`] = clearValue;
            });
        };

        // 1. スカラー項目（上限、目標値、対象、射程）の処理
        if (fieldName === "system.maxLevel") {
            resetLogic({
                "number": ["maxLevelOther"],
                "other":  ["maxLevelNumber"],
                "default":["maxLevelNumber", "maxLevelOther"]
            });
        }
        else if (fieldName === "system.targetValue") {
            resetLogic({
                "number": ["targetValueOther"],
                "other":  ["targetValueNumber"],
                "default":["targetValueNumber", "targetValueOther"]
            });
        }
        else if (fieldName === "system.target") {
            resetLogic({
                "other":  [], 
                "default":["targetOther"]
            });
        }
        else if (fieldName === "system.range") {
            resetLogic({
                "other":  [],
                "default":["rangeOther"]
            });
        }

        // 2. 配列項目（技能、対決、タイミング）の処理
        const comboMatch = fieldName.match(/^system\.styleSkill\.comboSkill\.(\d+)\.value$/);
        const confrontMatch = fieldName.match(/^system\.styleSkill\.confrontation\.(\d+)\.value$/);
        const timingMatch = fieldName.match(/^system\.styleSkill\.timing\.(\d+)\.value$/);

        if (comboMatch) {
            const idx = comboMatch[1];
            resetLogic({
                "skillName": [],
                "other":     [],
                "default":   [`comboSkill.${idx}.name`] 
            }, "system."); 
        }
        else if (confrontMatch) {
            const idx = confrontMatch[1];
            resetLogic({
                "skillName": [],
                "skillNameAsterisk": [],
                "other":     [],
                "default":   [`confrontation.${idx}.name`]
            }, "system.");
        }
        else if (timingMatch) {
            const idx = timingMatch[1];
            const prefix = `timing.${idx}.`;
            
            if (value === "action") {
                updateData[`system.${prefix}processName`] = "blank";
                updateData[`system.${prefix}timingOther`] = "";
            } else if (value === "process") {
                updateData[`system.${prefix}actionName`] = "blank";
                updateData[`system.${prefix}timingOther`] = "";
            } else if (value === "other") {
                updateData[`system.${prefix}actionName`] = "blank";
                updateData[`system.${prefix}processName`] = "blank";
            } else {
                updateData[`system.${prefix}actionName`] = "blank";
                updateData[`system.${prefix}processName`] = "blank";
                updateData[`system.${prefix}timingOther`] = "";
            }
        }

        if (Object.keys(updateData).length > 1) {
            await this.item.update(updateData);
        }
    }
}