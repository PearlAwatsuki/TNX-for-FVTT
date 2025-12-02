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
        const initialSuit = system.generalSkill?.initialSkill?.initialSuit || "";
        context.TNX = {
            SUITS: {
              spade:   { label: "スペード",   disabled: initialSuit === "spade" },
              heart:   { label: "ハート",   disabled: initialSuit === "heart" },
              diamond: { label: "ダイヤ",    disabled: initialSuit === "diamond" },
              club:    { label: "クラブ",    disabled: initialSuit === "club" }
            }
        };

        // ▼▼▼【ここから追記・修正】▼▼▼
        // --- ドロップダウンの選択肢を定義 ---
        context.options = {
            category: {
                "generalSkill": "一般技能",
                "styleSkill": "スタイル技能"
            },
            generalSkillCategory: {
                "initialSkill": "初期習得技能",
                "onomasticSKill": "固有名詞技能"
            },
            styleSkillCategory: {
                "special": "特技",
                "secret": "秘伝",
                "mystery": "奥義"
            },
            comboSkill: {
                "blank":"-",
                "none": "なし",
                "single": "単独",
                "dodge": "ドッジ",
                "parry": "パリー",
                "skillName": "技能名",
                "any": "任意",
                "explanation":"解説参照",
                "other": "その他"
            },
            timing: {
                "blank":"-",
                "action": "アクション",
                "process": "プロセス",
                "initiativeMajor": "イニシアチブ（メジャー）",
                "always": "常時",
                "alwaysSelect": "常時（選択）",
                "preDamge": "ダメージ算出の直前",
                "postDamge": "ダメージ算出の直後",
                "miracle": "神業",
                "explanation":"解説参照",
                "other": "その他"
            },
            // 【追加】アクションとプロセスの選択肢
            actions: {
                "blank":"-",
                "move": "ムーブ",
                "minor": "マイナー",
                "major": "メジャー",
                "reaction": "リアクション",
                "auto": "オート"
            },
            processes: {
                "blank":"-",
                "setup": "セットアップ",
                "initiative": "イニシアチブ",
                "clean-up": "クリンナップ"
            },
            target: {
                "blank":"-",
                "self": "自身",
                "single": "単体",
                "area": "範囲",
                "areaSelect": "範囲（選択）",
                "scene": "シーン",
                "sceneSelect": "シーン（選択）",
                "team": "チーム",
                "explanation":"解説参照",
                "other": "その他"
            },
            // 上限 (新規)
            maxLevel: {
                "blank": "-",
                "number": "数値",
                "sl": "SL",
                "explanation":"解説参照",
                "other": "その他"
            },
            range: {
                "blank":"-",
                "close": "至近",
                "short": "近",
                "middle": "中",
                "long": "遠",
                "superLong": "超遠",
                "weapon": "武器",
                "none": "なし",
                "explanation":"解説参照",
                "other": "その他"
            },
            targetValue: {
                "blank":"-",
                "none": "なし",
                "number": "数値",
                "control": "制御値",
                "total": "達成値",
                "enterDifficulty": "登場目標値",
                "explanation":"解説参照",
                "other": "その他"
            },
            confrontation: {
                "blank":"-",
                "skillName": "技能名",
                "skillNameAsterisk": "技能名※",
                "none": "なし",
                "cannot": "不可",
                "explanation":"解説参照",
                "other": "その他"
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

        // 既存のリスナー
        EffectsSheetMixin.activateEffectListListeners(html, this.item);
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
        
        // --- 数値入力スピナーのボタン処理 ---
        html.find('.number-input-spinner button').on('click', this._onSpinnerButtonClick.bind(this));
        html.find('.add-array-item').on('click', this._onAddArrayItem.bind(this));
        html.find('.delete-array-item').on('click', this._onDeleteArrayItem.bind(this));
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

        await this.item.update(updateData);
    }

}