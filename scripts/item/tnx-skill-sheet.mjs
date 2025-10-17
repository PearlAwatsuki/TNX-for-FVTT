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
        const system = this.item.system; // systemデータを取得
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
                "none": "なし",
                "single": "単独",
                "dodge": "ドッジ",
                "parry": "パリー",
                "skillName": "技能名",
                "any": "任意"                
            },
            timing: {
                "action": "アクション",
                "process": "プロセス",
                "initiativeMajor": "イニシアチブ（メジャー）",
                "always": "常時",
                "alwaysSelect": "常時（選択）",
                "preDamge": "ダメージ算出の直前",
                "postDamge": "ダメージ算出の直後",
                "miracle": "神業",
                "other": "その他"
            },
            target: {
                "self": "自身",
                "single": "単体",
                "area": "範囲",
                "areaSelect": "範囲（選択）",
                "scene": "シーン",
                "sceneSelect": "シーン（選択）",
                "team": "チーム",
                "other": "その他"
            },
            range: {
                "close": "至近",
                "short": "近",
                "middle": "中",
                "long": "遠",
                "superLong": "超遠",
                "weapon": "武器",
                "none": "なし"
            },
            targetValue: {
                "none": "なし",
                "number": "数字",
                "control": "制御値",
                "total": "達成値",
                "enterDifficulty": "登場目標値"
            },
            confrontation: {
                "skillName": "技能名",
                "skillNameAsterisk": "技能名※",
                "none": "なし",
                "cannot": "不可"
            }
        };

        // --- 説明タブでの表示用データを準備 ---
        context.view = {};
        const ss = system.styleSkill; // styleSkillのエイリアス

        if (system.category === 'styleSkill') {
            // 技能
            context.view.comboSkill = (ss.comboSkill === 'skillName' && ss.comboSkillOther)
                ? `〈${ss.comboSkillOther}〉`
                : ss.comboSkill;

            // 対決
            if (ss.confrontation === 'skillName' && ss.confrontationOther) {
                context.view.confrontation = `〈${ss.confrontationOther}〉`;
            } else if (ss.confrontation === 'skillNameAsterisk' && ss.confrontationOther) {
                context.view.confrontation = `〈${ss.confrontationOther}〉※`;
            } else {
                context.view.confrontation = ss.confrontation;
            }
            
            // 目標値
            context.view.targetValue = (ss.targetValue === 'number' && (ss.targetValueOther || ss.targetValueOther === 0))
                ? ss.targetValueOther
                : ss.targetValue;
            
            // その他（特殊な処理が不要な項目）
            context.view.timing = (ss.timing === 'other' && ss.timingOther) ? ss.timingOther : ss.timing;
            context.view.target = (ss.target === 'other' && ss.targetOther) ? ss.targetOther : ss.target;
            context.view.range = ss.range; // 射程はそのまま表示
        }
        // ▲▲▲【ここまで追記・修正】▲▲▲
      
        console.log("TnxSkillSheet | getData | context", context);
        
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        // 既存のリスナー
        EffectsSheetMixin.activateEffectListListeners(html, this.item);
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
        
        // ▼▼▼【ここから追記】▼▼▼
        // --- 数値入力スピナーのボタン処理 ---
        html.find('.number-input-spinner button').on('click', this._onSpinnerButtonClick.bind(this));
        // ▲▲▲【ここまで追記】▲▲▲
    }
    
    // ▼▼▼【ここから追記】▼▼▼
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
                updateData['system.styleSkill.maxLevel'] = (ss.maxLevel || 0) + 1;
                break;
            case 'decrement-max-level':
                updateData['system.styleSkill.maxLevel'] = (ss.maxLevel || 0) - 1;
                break;
            case 'increment-target-value':
                updateData['system.styleSkill.targetValueOther'] = (ss.targetValueOther || 0) + 1;
                break;
            case 'decrement-target-value':
                updateData['system.styleSkill.targetValueOther'] = (ss.targetValueOther || 0) - 1;
                break;
            default:
                return;
        }

        await this.item.update(updateData);
    }
    // ▲▲▲【ここまで追記】▲▲▲

    async _onSuitChange(event) {
        // 既存のリスナー (変更なし)
        const checkedSuits = this.form.querySelectorAll('.suit-selection input[type="checkbox"]:checked');
        const newLevel = checkedSuits.length;

        if (this.item.system.level !== newLevel) {
            await this.item.update({"system.level": newLevel});
        }
    }

}