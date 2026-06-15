export class TnxSkillUtils {

    /** キャスト一般技能の正規ソート順（固有名詞技能はプレフィックスで代表） */
    static GENERAL_SKILL_SORT_PREFIXES = [
        "medicine", "ranged", "perception", "cybertech",
        "craft",
        "psychology", "will", "negotiation",
        "art",
        "athletics", "evasion",
        "operate",
        "melee", "intrigue", "stature", "stealth",
        "society",
        "contact",
    ];

    /**
     * identificationKey の正規ソートリスト内位置を返します。
     * "craft_food" → 4、"craft" → 4、未知文字列・空文字 → Infinity
     */
    static getSkillSortPosition(identificationKey) {
        if (!identificationKey) return Infinity;
        for (let i = 0; i < this.GENERAL_SKILL_SORT_PREFIXES.length; i++) {
            const p = this.GENERAL_SKILL_SORT_PREFIXES[i];
            if (identificationKey === p || identificationKey.startsWith(p + "_")) return i;
        }
        return Infinity;
    }

    /**
     * 技能シートで使用するドロップダウンの選択肢定義を取得します
     */
    static getSkillOptions() {
        return {
            initialSuit: {
                "default": "-",
                "spade":   "スペード",
                "club":    "クラブ",
                "heart":   "ハート",
                "diamond": "ダイヤ"
            },
            generalSkillCategory: {
                "initialSkill":   "無条件取得技能",
                "onomasticSkill": "固有名詞技能"
            },
            styleSkillCategory: {
                "special":     "特技",
                "performance": "演出特技",
                "secret":      "秘技",
                "mystery":     "奥義"
            },
            unique: {
                "none":             "-",
                "damageIncrease":   "ダメージ増加技能",
                "damageReduction":  "ダメージ軽減技能",
                "additionalAction": "追加行動技能",
                "abilityChange":    "能力値変更技能",
                "clone":            "模造技能",
                "RSC":              "RSC技能",
                "modification":     "改造技能",
                "miracleChange":    "神業書き換え技能"
            },
            comboSkill: {
                "blank":       "-",
                "none":        "なし",
                "single":      "単独",
                "dodge":       "ドッジ",
                "parry":       "パリー",
                "skillName":   "技能名",
                "any":         "任意",
                "explanation": "解説参照",
                "other":       "その他"
            },
            timing: {
                "blank":           "-",
                "action":          "アクション",
                "process":         "プロセス",
                "initiativeMajor": "イニシアチブ（メジャー）",
                "always":          "常時",
                "alwaysSelect":    "常時（選択）",
                "preDamge":        "ダメージ算出の直前",
                "postDamge":       "ダメージ算出の直後",
                "miracle":         "神業",
                "explanation":     "解説参照",
                "other":           "その他"
            },
            actions: {
                "blank":       "-",
                "move":        "ムーブ",
                "minor":       "マイナー",
                "major":       "メジャー",
                "reaction":    "リアクション",
                "auto":        "オート",
                "explanation": "解説参照",
                "other":       "その他"
            },
            processes: {
                "blank":       "-",
                "setup":       "セットアップ",
                "initiative":  "イニシアチブ",
                "clean-up":    "クリンナップ",
                "explanation": "解説参照",
                "other":       "その他"
            },
            target: {
                "blank":       "-",
                "self":        "自身",
                "single":      "単体",
                "area":        "範囲",
                "areaSelect":  "範囲（選択）",
                "scene":       "シーン",
                "sceneSelect": "シーン（選択）",
                "team":        "チーム",
                "explanation": "解説参照",
                "other":       "その他"
            },
            range: {
                "blank":       "-",
                "close":       "至近",
                "short":       "近",
                "middle":      "中",
                "long":        "遠",
                "superLong":   "超遠",
                "weapon":      "武器",
                "none":        "なし",
                "explanation": "解説参照",
                "other":       "その他"
            },
            targetValue: {
                "blank":           "-",
                "none":            "なし",
                "number":          "数字",
                "control":         "制御値",
                "total":           "達成値",
                "enterDifficulty": "登場目標値",
                "explanation":     "解説参照",
                "other":           "その他"
            },
            maxLevel: {
                "blank":       "-",
                "number":      "数字",
                "sl":          "SL",
                "explanation": "解説参照",
                "other":       "その他"
            },
            confrontation: {
                "blank":              "-",
                "skillName":          "技能名",
                "skillNameAsterisk":  "技能名※",
                "none":               "なし",
                "cannot":             "不可",
                "explanation":        "解説参照",
                "other":              "その他"
            },
            usesType: {
                "":      "-",
                "act":   "アクト",
                "scene": "シーン",
                "cut":   "カット"
            }
        };
    }

    /**
     * タイミング配列({value, actionName, processName, timingOther})を表示用ラベルに整形します。
     * スタイル技能とアウトフィット(フェーズ6-1)で共用。
     * @param {Array|Object} timingList timing 配列(オブジェクトマップも許容)
     * @param {Object} options getSkillOptions()で取得したオプション
     * @returns {string} 「、」区切りの表示ラベル
     */
    static formatTimingLabel(timingList, options) {
        const list = Array.isArray(timingList) ? timingList
            : (typeof timingList === "object" && timingList !== null) ? Object.values(timingList)
            : timingList ? [timingList] : [];

        return list.map((t, idx) => {
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
    }

    /**
     * スタイル技能の表示用データ(view)を生成します
     * @param {Object} systemData アイテムの system データ
     * @param {Object} options getSkillOptions()で取得したオプション
     * @returns {Object} フォーマット済みの view オブジェクト
     */
    static prepareStyleSkillView(systemData, options) {
        const view = {};

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
        const comboList = ensureArray(systemData.comboSkill);
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
        const confrontList = ensureArray(systemData.confrontation);
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

        // 3. タイミング (Timing) — 整形ロジックは formatTimingLabel に共通化(フェーズ6-1)
        view.timing = TnxSkillUtils.formatTimingLabel(ensureArray(systemData.timing), options);

        // 4. 上限 (Max Level)
        if (systemData.maxLevel === 'number') {
            view.maxLevel = systemData.maxLevelNumber;
        } else if(systemData.maxLevel === 'other') {
            view.maxLevel = systemData.maxLevelOther;
        } else {
            view.maxLevel = options.maxLevel[systemData.maxLevel];
        }

        // 5. 対象 (Target)
        let targetLabel = (systemData.target === 'other') 
            ? systemData.targetOther 
            : options.target[systemData.target];
        if (systemData.isFixedTarget) targetLabel += "※";
        view.target = targetLabel;

        // 6. 射程 (Range)
        let rangeLabel = (systemData.range === 'other') 
            ? systemData.rangeOther 
            : options.range[systemData.range];
        if (systemData.isFixedRange) rangeLabel += "※";
        view.range = rangeLabel;

        // 7. 目標値 (Target Value)
        if (systemData.targetValue === 'number') {
            view.targetValue = systemData.targetValueNumber;
        } else if(systemData.targetValue === 'other') {
            view.targetValue = systemData.targetValueOther;
        } else {
            view.targetValue = options.targetValue[systemData.targetValue];
        }

        return view;
    }

    /**
     * スートのチェックボックス変更時にレベルを再計算して更新する共通処理
     * @param {Event} event 発生したイベント
     * @param {ItemSheet} sheet 呼び出し元のアイテムシートインスタンス
     */
    static async onSuitChange(event, sheet) {
        // シート内のチェックされているスートを取得
        const checkedSuits = sheet.form.querySelectorAll('.suit-selection input[type="checkbox"]:checked');
        const newLevel = checkedSuits.length;

        // レベルが変更されていれば更新を実行
        if (sheet.item.system.level !== newLevel) {
            await sheet.item.update({"system.level": newLevel});
        }
    }
}