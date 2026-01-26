import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaSkillSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "skill"],
            template: "systems/tokyo-nova-axleration/templates/item/skill-sheet.hbs",
            width: 600,
            height: 650,
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        const system = foundry.utils.deepClone(this.item.system);
        context.system = system; // hbsで system を使えるように
        
        context.enrichedDescription = await TextEditor.enrichHTML(system.description, { async: true, relativeTo: this.item, editable: this.isEditable });
        
        // EffectsSheetMixinの既存ロジック (変更なし)
        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive
        ];

        // スートの無効化判定ロジック (変更なし)
        const initialSuit = system.generalSkill.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
              spade:   { label: game.i18n.localize("TNX.Suits.spade"),   disabled: initialSuit === "spade" },
              club:    { label: game.i18n.localize("TNX.Suits.club"),    disabled: initialSuit === "club" },
              heart:   { label: game.i18n.localize("TNX.Suits.heart"),   disabled: initialSuit === "heart" },
              diamond: { label: game.i18n.localize("TNX.Suits.diamond"),    disabled: initialSuit === "diamond" }
            }
        };

        // ▼▼▼【ここから追記・修正】▼▼▼
        // --- ドロップダウンの選択肢を定義 ---
        context.options = {
            initialSuit: {
                "default": "-",
                "spade": game.i18n.localize("TNX.Suits.spade"),
                "club": game.i18n.localize("TNX.Suits.club"),
                "heart": game.i18n.localize("TNX.Suits.heart"),
                "diamond": game.i18n.localize("TNX.Suits.diamond")
            },
            category: {
                "generalSkill": game.i18n.localize("TNX.Item.Skill.Category.General"),
                "styleSkill": game.i18n.localize("TNX.Item.Skill.Category.Style")
            },
            generalSkillCategory: {
                "initialSkill": game.i18n.localize("TNX.Item.Skill.GeneralType.Initial"),
                "onomasticSkill": game.i18n.localize("TNX.Item.Skill.GeneralType.Onomastic")
            },
            styleSkillCategory: {
                "special": game.i18n.localize("TNX.Item.Skill.StyleType.Special"),
                "secret": game.i18n.localize("TNX.Item.Skill.StyleType.Secret"),
                "mystery": game.i18n.localize("TNX.Item.Skill.StyleType.Mystery")
            },
            unique: {
                "none": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "damageIncrease": game.i18n.localize("TNX.Item.Skill.UniqueType.DamageIncrease"),
                "damageReduction": game.i18n.localize("TNX.Item.Skill.UniqueType.DamageReduction"),
                "additionalAction": game.i18n.localize("TNX.Item.Skill.UniqueType.AdditionalAction"),
                "abilityChange": game.i18n.localize("TNX.Item.Skill.UniqueType.AbilityChange"),
                "clone": game.i18n.localize("TNX.Item.Skill.UniqueType.Clone"),
                "RSC": game.i18n.localize("TNX.Item.Skill.UniqueType.RSC"),
                "modification": game.i18n.localize("TNX.Item.Skill.UniqueType.Modification"),
                "miracleChange": game.i18n.localize("TNX.Item.Skill.UniqueType.MiracleChange")
            },
            comboSkill: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "none": game.i18n.localize("TNX.Item.Skill.Options.Common.None"),
                "single": game.i18n.localize("TNX.Item.Skill.Options.Combo.Single"),
                "dodge": game.i18n.localize("TNX.Item.Skill.Options.Combo.Dodge"),
                "parry": game.i18n.localize("TNX.Item.Skill.Options.Combo.Parry"),
                "skillName": game.i18n.localize("TNX.Item.Skill.Options.Combo.SkillName"),
                "any": game.i18n.localize("TNX.Item.Skill.Options.Combo.Any"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            timing: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "action": game.i18n.localize("TNX.Item.Skill.Options.Timing.Action"),
                "process": game.i18n.localize("TNX.Item.Skill.Options.Timing.Process"),
                "initiativeMajor": game.i18n.localize("TNX.Item.Skill.Options.Timing.InitiativeMajor"),
                "always": game.i18n.localize("TNX.Item.Skill.Options.Timing.Always"),
                "alwaysSelect": game.i18n.localize("TNX.Item.Skill.Options.Timing.AlwaysSelect"),
                "preDamge": game.i18n.localize("TNX.Item.Skill.Options.Timing.PreDamage"),
                "postDamge": game.i18n.localize("TNX.Item.Skill.Options.Timing.PostDamage"),
                "miracle": game.i18n.localize("TNX.Item.Skill.Options.Timing.Miracle"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            actions: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "move": game.i18n.localize("TNX.Item.Skill.Options.Action.Move"),
                "minor": game.i18n.localize("TNX.Item.Skill.Options.Action.Minor"),
                "major": game.i18n.localize("TNX.Item.Skill.Options.Action.Major"),
                "reaction": game.i18n.localize("TNX.Item.Skill.Options.Action.Reaction"),
                "auto": game.i18n.localize("TNX.Item.Skill.Options.Action.Auto"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            processes: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "setup": game.i18n.localize("TNX.Item.Skill.Options.Process.Setup"),
                "initiative": game.i18n.localize("TNX.Item.Skill.Options.Process.Initiative"),
                "clean-up": game.i18n.localize("TNX.Item.Skill.Options.Process.Cleanup"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            target: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "self": game.i18n.localize("TNX.Item.Skill.Options.Target.Self"),
                "single": game.i18n.localize("TNX.Item.Skill.Options.Target.Single"),
                "area": game.i18n.localize("TNX.Item.Skill.Options.Target.Area"),
                "areaSelect": game.i18n.localize("TNX.Item.Skill.Options.Target.AreaSelect"),
                "scene": game.i18n.localize("TNX.Item.Skill.Options.Target.Scene"),
                "sceneSelect": game.i18n.localize("TNX.Item.Skill.Options.Target.SceneSelect"),
                "team": game.i18n.localize("TNX.Item.Skill.Options.Target.Team"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            range: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "close": game.i18n.localize("TNX.Item.Skill.Options.Range.Close"),
                "short": game.i18n.localize("TNX.Item.Skill.Options.Range.Short"),
                "middle": game.i18n.localize("TNX.Item.Skill.Options.Range.Middle"),
                "long": game.i18n.localize("TNX.Item.Skill.Options.Range.Long"),
                "superLong": game.i18n.localize("TNX.Item.Skill.Options.Range.SuperLong"),
                "weapon": game.i18n.localize("TNX.Item.Skill.Options.Range.Weapon"),
                "none": game.i18n.localize("TNX.Item.Skill.Options.Common.None"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            targetValue: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "none": game.i18n.localize("TNX.Item.Skill.Options.Common.None"),
                "number": game.i18n.localize("TNX.Item.Skill.Options.Common.Number"),
                "control": game.i18n.localize("TNX.Item.Skill.Options.TargetValue.Control"),
                "total": game.i18n.localize("TNX.Item.Skill.Options.TargetValue.Total"),
                "enterDifficulty": game.i18n.localize("TNX.Item.Skill.Options.TargetValue.EnterDifficulty"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            maxLevel: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "number": game.i18n.localize("TNX.Item.Skill.Options.Common.Number"),
                "sl": game.i18n.localize("TNX.Item.Skill.Options.MaxLevel.SL"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            },
            confrontation: {
                "blank": game.i18n.localize("TNX.Item.Skill.Options.Common.Blank"),
                "skillName": game.i18n.localize("TNX.Item.Skill.Options.Confrontation.SkillName"),
                "skillNameAsterisk": game.i18n.localize("TNX.Item.Skill.Options.Confrontation.SkillNameAsterisk"),
                "none": game.i18n.localize("TNX.Item.Skill.Options.Common.None"),
                "cannot": game.i18n.localize("TNX.Item.Skill.Options.Confrontation.Cannot"),
                "explanation": game.i18n.localize("TNX.Item.Skill.Options.Common.Explanation"),
                "other": game.i18n.localize("TNX.Item.Skill.Options.Common.Other")
            }
        };

        if (system.category === 'styleSkill') {
            const ss = system.styleSkill;

            // 配列ライクなオブジェクト（Foundryの更新データ）を配列に変換するヘルパー
            const ensureArray = (val, defaultNameProp) => {
                if (Array.isArray(val)) return val;
                // オブジェクト形式（{0:Val, 1:Val}）の場合、配列に変換
                if (typeof val === 'object' && val !== null && Object.keys(val).length > 0) {
                    return Object.values(val);
                }
                // 旧データ(String)または空の場合のレガシー処理
                if (typeof val === 'string' && val !== "" && val !== "-") {
                    const item = { value: val };
                    if (defaultNameProp) item.name = defaultNameProp;
                    // 他のプロパティ初期値
                    if (defaultNameProp === ss.comboSkillOther) item.isMandatory = false; 
                    return [item];
                }
                // 完全な空なら空配列を返す
                return [];
            };

            // 1. 技能 (Combo Skill)
            ss.comboSkill = ensureArray(ss.comboSkill, ss.comboSkillOther);
            // 初期値（空の場合）は1行追加
            if (ss.comboSkill.length === 0) {
                ss.comboSkill = [{ value: "blank", name: "", isMandatory: false }];
            }

            // 2. 対決 (Confrontation)
            ss.confrontation = ensureArray(ss.confrontation, ss.confrontationOther);
            if (ss.confrontation.length === 0) {
                ss.confrontation = [{ value: "blank", name: "" }];
            }

            // 3. タイミング (Timing)
            ss.timing = ensureArray(ss.timing, null);
            if (ss.timing.length === 0) {
                ss.timing = [{
                    value: "blank",
                    actionName: "blank",
                    processName: "blank",
                    timingOther: ""
                }];
            }

            // substituteTarget は単純な文字列の配列として扱います
            if (!Array.isArray(ss.substituteTarget)) {
                if (typeof ss.substituteTarget === 'object' && ss.substituteTarget !== null) {
                    ss.substituteTarget = Object.values(ss.substituteTarget);
                } else if (typeof ss.substituteTarget === 'string' && ss.substituteTarget !== "") {
                    ss.substituteTarget = [ss.substituteTarget];
                } else {
                    ss.substituteTarget = [];
                }
            }
            // 空の場合は入力欄を1つ表示
            if (ss.substituteTarget.length === 0) {
                ss.substituteTarget = [""];
            }
        }

        // --- 説明タブでの表示用データを準備 ---
        context.view = {};
        const ss = system.styleSkill;
        const skillOptions = context.options;

        if (system.category === 'styleSkill') {
            
            // 技能 (Combo)
            context.view.comboSkill = ss.comboSkill.map((s, idx) => {
                let label = "";
                if (s.value === 'skillName') {
                    label = s.name ? `〈${s.name}〉` : "〈〉";
                } else if (s.value === 'other') {
                    // ★その他: そのまま表示
                    label = s.name || ""; 
                } else {
                    label = skillOptions.comboSkill[s.value] || "-";
                }
                
                // 2つ目以降の結合処理
                if (idx > 0) {
                    if (s.value === 'skillName') {
                        return s.isMandatory ? `&${label}` : label;
                    } else {
                        // その他やドッジなどは「、」で区切る
                        return `、${label}`;
                    }
                }
                return label;
            }).join("");

            // 対決 (Confrontation)
            context.view.confrontation = ss.confrontation.map((s, idx) => {
                let label = "";
                if (s.value === 'skillName' || s.value === 'skillNameAsterisk') {
                    label = s.name ? `〈${s.name}〉` : "〈〉";
                    if (s.value === 'skillNameAsterisk') label += "※";
                } else if (s.value === 'other') {
                    // ★その他: そのまま表示
                    label = s.name || "";
                } else {
                    label = skillOptions.confrontation[s.value] || "-";
                }
                
                // 2つ目以降の結合処理
                if (idx > 0) {
                    if (s.value === 'skillName' || s.value === 'skillNameAsterisk') {
                        return label;
                    } else {
                        return `、${label}`;
                    }
                }
                return label;
            }).join("");

            // タイミング (Timing)
            context.view.timing = ss.timing.map((t, idx) => {
                let label = "";
                if (t.value === 'other') {
                    label = t.timingOther || skillOptions.timing.other;
                } else if (t.value === 'action') {
                    label = skillOptions.actions[t.actionName] || skillOptions.timing.action;
                } else if (t.value === 'process') {
                    label = skillOptions.processes[t.processName] || skillOptions.timing.process;
                } else {
                    label = skillOptions.timing[t.value] || "-";
                }
                
                // タイミングなど「技能以外」は「、」で区切る（前回の指示を維持）
                if (idx > 0) return `、${label}`;
                return label;
            }).join("");

            // ▼▼▼【上限 (Max Level) の表示処理】▼▼▼
            // モードが「数値」か「その他」なら Other の値を表示する
            if (ss.maxLevel === 'number') {
                context.view.maxLevel = ss.maxLevelNumber;
            } else if(ss.maxLevel === 'other') {
                context.view.maxLevel = ss.maxLevelOther;
            } else {
                context.view.maxLevel = skillOptions.maxLevel[ss.maxLevel];
            }

            // ▼▼▼【対象 (Target) の表示処理】▼▼▼
            let targetLabel = (ss.target === 'other') 
                ? ss.targetOther 
                : skillOptions.target[ss.target];
            if (ss.isFixedTarget) targetLabel += "※";
            context.view.target = targetLabel;

            // ▼▼▼【射程 (Range) の表示処理】▼▼▼
            let rangeLabel = (ss.range === 'other') 
                ? ss.rangeOther 
                : skillOptions.range[ss.range];
            if (ss.isFixedRange) rangeLabel += "※";
            context.view.range = rangeLabel;

            // ▼▼▼【目標値 (Target Value) の表示処理】▼▼▼
            if (ss.targetValue === 'number') {
                context.view.targetValue = ss.targetValueNumber;
            } else if(ss.targetValue === 'other') {
                context.view.targetValue = ss.targetValueOther;
            } else {
                context.view.targetValue = skillOptions.targetValue[ss.targetValue];
            }
        }
      
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
        EffectsSheetMixin.activateEffectListListeners(html, this.item);
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
        html.find('.number-input-spinner button').on('click', this._onSpinnerButtonClick.bind(this));
        html.find('.add-array-item').on('click', this._onAddArrayItem.bind(this));
        html.find('.delete-array-item').on('click', this._onDeleteArrayItem.bind(this));
        html.find('select').on('change', this._onSelectChange.bind(this));
        html.find('input[name="system.generalSkill.onomasticSkill.isInitial"]').on('change', this._onInitialSkillChange.bind(this));
    }
    
    /**
     * 数値入力スピナーのボタンクリックを処理します。
     * @param {Event} event クリックイベント
     * @private
     */
    async _onSpinnerButtonClick(event) {
        event.preventDefault();
        const button = event.currentTarget;
        const action = button.dataset.action;
        const ss = this.item.system.styleSkill;
        let updateData = {};

        switch (action) {
            case 'increment-max-level':
                updateData['system.styleSkill.maxLevelNumber'] = (ss.maxLevelNumber || 0) + 1;
                break;
            case 'decrement-max-level':
                updateData['system.styleSkill.maxLevelNumber'] = (ss.maxLevelNumber || 0) - 1;
                break;
            case 'increment-target-value':
                updateData['system.styleSkill.targetValueNumber'] = (ss.targetValueNumber || 0) + 1;
                break;
            case 'decrement-target-value':
                updateData['system.styleSkill.targetValueNumber'] = (ss.targetValueNumber || 0) - 1;
                break;
            default:
                return;
        }

        await this.item.update(updateData);
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
     * 配列に行を追加する処理
     */
    async _onAddArrayItem(event) {
        event.preventDefault();
        const target = event.currentTarget.dataset.target; // "combo", "confrontation", "timing"
        const ss = this.item.system.styleSkill;
        let updateData = {};
        
        // 現在のデータを取得（getDataでの正規化前なので、生データをチェック）
        // もし生データが配列でなければ初期化する
        const ensureArray = (val, defaultObj) => {
            if (Array.isArray(val) && val.length > 0) return [...val];
            // 既存が単一値ならそれを1つ目に入れる移行措置
            if (val) return [val]; // 注: 実際はオブジェクト構造が違うのでgetDataのようなマッピングが必要だが、
                                   // ここでは簡易的に「保存済みデータはgetDataで正規化されて表示されている」前提で、
                                   // フォーム送信により配列化されていることを期待するか、
                                   // あるいは明示的に空配列からスタートさせる。
                                   // 今回は「追加」ボタンを押したときの挙動なので、
                                   // 既存配列 + 新規要素 で更新する。
            return [defaultObj]; 
        };

        // getDataを通していないので this.item.system の値は古い構造の可能性がある。
        // 安全のため、getData内でやった正規化ロジックと同様の変換をここでも通すか、
        // あるいは `this.getData()` を呼んで正規化済みデータを取得するのが確実。
        const context = await this.getData();
        const normalizedSs = context.system.styleSkill;

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            list.push({ value: "blank", name: "", isMandatory: false });
            updateData['system.styleSkill.comboSkill'] = list;
        } 
        else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            list.push({ value: "blank", name: "" });
            updateData['system.styleSkill.confrontation'] = list;
        }
        else if (target === "timing") {
            const list = [...normalizedSs.timing];
            list.push({ value: "blank", actionName: "blank", processName: "blank", timingOther: "" });
            updateData['system.styleSkill.timing'] = list;
        }

        if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            list.push(""); // 空文字を追加
            updateData['system.styleSkill.substituteTarget'] = list;
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
        const normalizedSs = context.system.styleSkill;
        let updateData = {};

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.styleSkill.comboSkill'] = list;
            }
        } 
        else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.styleSkill.confrontation'] = list;
            }
        }
        else if (target === "timing") {
            const list = [...normalizedSs.timing];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.styleSkill.timing'] = list;
            }
        }

        if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData['system.styleSkill.substituteTarget'] = list;
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

        if (fieldName === "system.generalSkill.initialSkill.initialSuit") {
            const validSuits = ["spade", "club", "heart", "diamond"];
            
            // 変更前の初期スートを取得
            const oldSuit = this.item.system.generalSkill.initialSkill?.initialSuit;

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

        // --- リセットルールの定義 ---
        // key: 監視するフィールド名（またはパターン）
        // clear: { "モード名": ["削除するプロパティ名"...], "default": [...] }
        // ※プロパティ名は、fieldNameからの相対パスではなく絶対パス、あるいは置換用トークンを使用
        
        const resetLogic = (clears, basePrefix = "system.styleSkill.") => {
            // 現在のモード(value)に対応するクリアリストを取得（なければdefault、それもなければ空）
            const targetsToClear = clears[value] || clears["default"] || [];
            
            targetsToClear.forEach(prop => {
                // 数値型のリセットは 0、それ以外（文字列）は "" にする
                // ここでは簡易的に、プロパティ名に "Number" が含まれていれば 0、それ以外は "" とする
                const clearValue = prop.includes("Number") ? 0 : "";
                updateData[`${basePrefix}${prop}`] = clearValue;
            });
        };

        // 1. スカラー項目（上限、目標値、対象、射程）の処理
        if (fieldName === "system.styleSkill.maxLevel") {
            resetLogic({
                "number": ["maxLevelOther"],
                "other":  ["maxLevelNumber"],
                "default":["maxLevelNumber", "maxLevelOther"] // SL, blank等
            });
        }
        else if (fieldName === "system.styleSkill.targetValue") {
            resetLogic({
                "number": ["targetValueOther"],
                "other":  ["targetValueNumber"],
                "default":["targetValueNumber", "targetValueOther"]
            });
        }
        else if (fieldName === "system.styleSkill.target") {
            resetLogic({
                "other":  [], // その他を選んだ時は消さない
                "default":["targetOther"] // それ以外は targetOther を消す
            });
        }
        else if (fieldName === "system.styleSkill.range") {
            resetLogic({
                "other":  [],
                "default":["rangeOther"]
            });
        }

        // 2. 配列項目（技能、対決、タイミング）の処理
        // 正規表現でインデックスを取得
        const comboMatch = fieldName.match(/^system\.styleSkill\.comboSkill\.(\d+)\.value$/);
        const confrontMatch = fieldName.match(/^system\.styleSkill\.confrontation\.(\d+)\.value$/);
        const timingMatch = fieldName.match(/^system\.styleSkill\.timing\.(\d+)\.value$/);

        if (comboMatch) {
            const idx = comboMatch[1];
            resetLogic({
                "skillName": [],
                "other":     [],
                "default":   [`comboSkill.${idx}.name`] // 技能名・その他以外なら name を消す
            }, "system.styleSkill."); 
        }
        else if (confrontMatch) {
            const idx = confrontMatch[1];
            resetLogic({
                "skillName": [],
                "skillNameAsterisk": [],
                "other":     [],
                "default":   [`confrontation.${idx}.name`]
            }, "system.styleSkill.");
        }
        else if (timingMatch) {
            const idx = timingMatch[1];
            // タイミングは項目が多いので少し細かく制御
            // action -> actionName以外を消す
            // process -> processName以外を消す
            // other -> timingOther以外を消す
            const prefix = `timing.${idx}.`;
            
            if (value === "action") {
                updateData[`system.styleSkill.${prefix}processName`] = "blank";
                updateData[`system.styleSkill.${prefix}timingOther`] = "";
            } else if (value === "process") {
                updateData[`system.styleSkill.${prefix}actionName`] = "blank";
                updateData[`system.styleSkill.${prefix}timingOther`] = "";
            } else if (value === "other") {
                updateData[`system.styleSkill.${prefix}actionName`] = "blank";
                updateData[`system.styleSkill.${prefix}processName`] = "blank";
            } else {
                // それ以外（blank, always等）なら全部消す
                updateData[`system.styleSkill.${prefix}actionName`] = "blank";
                updateData[`system.styleSkill.${prefix}processName`] = "blank";
                updateData[`system.styleSkill.${prefix}timingOther`] = "";
            }
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