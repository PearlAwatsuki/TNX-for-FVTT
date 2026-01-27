export class TnxSkillUtils {
    /**
     * 技能シートで使用するドロップダウンの選択肢定義を取得します
     */
    static getSkillOptions() {
        return {
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
    }

    /**
     * スタイル技能の表示用データ(view)を生成します
     * @param {Object} systemData アイテムの system データ
     * @param {Object} options getSkillOptions()で取得したオプション
     * @returns {Object} フォーマット済みの view オブジェクト
     */
    static prepareStyleSkillView(systemData, options) {
        const view = {};
        const ss = systemData.styleSkill;

        // 配列変換・正規化ヘルパー
        const ensureArray = (val) => {
            if (Array.isArray(val)) return val;
            // オブジェクト形式の場合、配列に変換
            if (typeof val === 'object' && val !== null) return Object.values(val);
            // 文字列やその他の場合、空配列を返す（あるいは必要に応じて要素1つの配列にする）
            if (val) return [val]; 
            return [];
        };

        // 1. 技能 (Combo Skill)
        const comboList = ensureArray(ss.comboSkill);
        view.comboSkill = comboList.map((s, idx) => {
            let label = "";
            // s がオブジェクトでない場合（古いデータなど）のガード
            const val = s.value || s; 
            const name = s.name || "";

            if (val === 'skillName') {
                label = name ? `〈${name}〉` : "〈〉";
            } else if (val === 'other') {
                label = name || ""; 
            } else {
                label = options.comboSkill[val] || "-";
            }
            
            if (idx > 0) {
                if (val === 'skillName') {
                    return s.isMandatory ? `&${label}` : label;
                } else {
                    return `、${label}`;
                }
            }
            return label;
        }).join("");

        // 2. 対決 (Confrontation)
        const confrontList = ensureArray(ss.confrontation);
        view.confrontation = confrontList.map((s, idx) => {
            let label = "";
            const val = s.value || s;
            const name = s.name || "";

            if (val === 'skillName' || val === 'skillNameAsterisk') {
                label = name ? `〈${name}〉` : "〈〉";
                if (val === 'skillNameAsterisk') label += "※";
            } else if (val === 'other') {
                label = name || "";
            } else {
                label = options.confrontation[val] || "-";
            }
            
            if (idx > 0) {
                if (val === 'skillName' || val === 'skillNameAsterisk') {
                    return label;
                } else {
                    return `、${label}`;
                }
            }
            return label;
        }).join("");

        // 3. タイミング (Timing)
        const timingList = ensureArray(ss.timing);
        view.timing = timingList.map((t, idx) => {
            let label = "";
            const val = t.value || t;

            if (val === 'other') {
                label = t.timingOther || options.timing.other;
            } else if (val === 'action') {
                label = options.actions[t.actionName] || options.timing.action;
            } else if (val === 'process') {
                label = options.processes[t.processName] || options.timing.process;
            } else {
                label = options.timing[val] || "-";
            }
            
            if (idx > 0) return `、${label}`;
            return label;
        }).join("");

        // 4. 上限 (Max Level)
        if (ss.maxLevel === 'number') {
            view.maxLevel = ss.maxLevelNumber;
        } else if(ss.maxLevel === 'other') {
            view.maxLevel = ss.maxLevelOther;
        } else {
            view.maxLevel = options.maxLevel[ss.maxLevel];
        }

        // 5. 対象 (Target)
        let targetLabel = (ss.target === 'other') 
            ? ss.targetOther 
            : options.target[ss.target];
        if (ss.isFixedTarget) targetLabel += "※";
        view.target = targetLabel;

        // 6. 射程 (Range)
        let rangeLabel = (ss.range === 'other') 
            ? ss.rangeOther 
            : options.range[ss.range];
        if (ss.isFixedRange) rangeLabel += "※";
        view.range = rangeLabel;

        // 7. 目標値 (Target Value)
        if (ss.targetValue === 'number') {
            view.targetValue = ss.targetValueNumber;
        } else if(ss.targetValue === 'other') {
            view.targetValue = ss.targetValueOther;
        } else {
            view.targetValue = options.targetValue[ss.targetValue];
        }

        return view;
    }
}