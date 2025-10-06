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
                "《社会》": "《社会》",
                "《芸術：任意》": "《芸術：任意》",
                "skillName": "技能名"
            },
            timing: {
                "オート": "オート",
                "メジャー": "メジャー",
                "マイナー": "マイナー",
                "リアクション": "リアクション",
                "other": "その他"
            },
            target: {
                "自身": "自身",
                "単体": "単体",
                "範囲": "範囲",
                "other": "その他"
            },
            range: {
                "至近": "至近",
                "近距離": "近距離",
                "遠距離": "遠距離",
                "シーン": "シーン"
            },
            targetValue: {
                "自動成功": "自動成功",
                "対決": "対決",
                "number": "数字"
            },
            confrontation: {
                "なし": "なし",
                "《回避》": "《回避》",
                "《抵抗》": "《抵抗》",
                "skillName": "技能名",
                "skillNameAsterisk": "技能名※"
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
            context.view.targetValue = (ss.targetValue === 'number' && ss.targetValueOther)
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

        // 既存のリスナー (変更なし)
        EffectsSheetMixin.activateEffectListListeners(html, this.item);
        html.find('.suit-selection input[type="checkbox"]').on('change', this._onSuitChange.bind(this));
    }

    async _onSuitChange(event) {
        // 既存のリスナー (変更なし)
        const checkedSuits = this.form.querySelectorAll('.suit-selection input[type="checkbox"]:checked');
        const newLevel = checkedSuits.length;

        if (this.item.system.level !== newLevel) {
            const formData = this._getSubmitData();
            formData["system.level"] = newLevel;
            await this.item.update(formData);
            this.render();
        }
    }
}