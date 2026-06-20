/**
 * @fileoverview UsageTemplate - 用途(Action)リストを定義する template クラス
 *
 * 使用 Item type: miracle / generalSkill / styleSkill /
 *                weapon / armor / ianus / cyborg / tron / tap /
 *                vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * actions[].type の値域:
 *   "check"        - 判定（技能判定）
 *   "attack"       - 攻撃（weaponRef・damageType・skillRefs）
 *   "declaration"  - 宣言（神業を含む）
 *   "damageBoost"  - ダメージ増加（formula・damageCategory）
 *   "damageReduce" - ダメージ軽減（formula・damageCategory）
 *   "modification" - 改造（modifiableParams）
 *
 * タイプは作成時に固定。UI 上で切り替え不可。
 * 全タイプ共通: _id / name / description / timing / target / effects
 *
 * skillRefs: check・attack タイプで使用。組み合わせ技能の item ID リスト。
 *   ベース技能は用途を所持するアイテム自身のため skillRefs に含まない。
 */

import { SystemDataModel } from "../../abstract.mjs";

export class UsageTemplate extends SystemDataModel {
    /** @override */
    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            actions: new fields.ArrayField(
                new fields.SchemaField({
                    _id:         new fields.StringField({ initial: () => foundry.utils.randomID() }),
                    type:        new fields.StringField({ initial: "check" }),
                    name:        new fields.StringField({ initial: "" }),
                    description: new fields.StringField({ initial: "" }),

                    // タイミング (getSkillOptions().timing + actions/processes 準拠)
                    timing: new fields.SchemaField({
                        value:       new fields.StringField({ initial: "blank" }),
                        actionName:  new fields.StringField({ initial: "blank" }),
                        processName: new fields.StringField({ initial: "blank" }),
                        timingOther: new fields.StringField({ initial: "" }),
                    }),

                    // 対象 (getSkillOptions().target 準拠。スタイル技能の target/targetOther/isFixedTarget と同形)
                    target:        new fields.StringField({ initial: "blank" }),
                    targetOther:   new fields.StringField({ initial: "" }),   // target === "other" の自由入力
                    isFixedTarget: new fields.BooleanField({ initial: false }), // 変更不可（※）: AE による対象変更を抑止（実機能はフェーズ13）

                    // 射程 (getSkillOptions().range 準拠)
                    range:        new fields.StringField({ initial: "blank" }),
                    rangeOther:   new fields.StringField({ initial: "" }),    // range === "other" の自由入力
                    isFixedRange: new fields.BooleanField({ initial: false }), // 変更不可（※）: AE による射程変更を抑止（実機能はフェーズ13）

                    // 目標値 (getSkillOptions().targetValue 準拠。number / other でサブ入力)
                    targetValue:       new fields.StringField({ initial: "blank" }),
                    targetValueNumber: new fields.NumberField({ initial: 0 }),
                    targetValueOther:  new fields.StringField({ initial: "" }),

                    // 対決不可: 対象がこの判定に対決（リアクション）できない状態（実機能はフェーズ13、現状は保持のみ）
                    isUnopposable: new fields.BooleanField({ initial: false }),

                    // この用途使用時に付与する ActiveEffect の参照
                    effects: new fields.ArrayField(
                        new fields.SchemaField({
                            effectId: new fields.StringField({ initial: "" }),
                        })
                    ),

                    // check・attack: ベース技能参照（用途が明示的に保持。作成時に親アイテムのIDで自動設定）
                    baseSkillRef: new fields.SchemaField({
                        itemId: new fields.StringField({ initial: "" }),
                    }),

                    // check・attack: 組み合わせ技能 item ID リスト（ベース技能は含まない）
                    skillRefs: new fields.ArrayField(
                        new fields.SchemaField({
                            itemId: new fields.StringField({ initial: "" }),
                        })
                    ),

                    // attack: 使用武器参照
                    weaponRef: new fields.SchemaField({
                        itemId: new fields.StringField({ initial: "" }),
                    }),

                    // attack: ダメージ種別 ("S" | "P" | "I")
                    damageType: new fields.StringField({ initial: "" }),

                    // damageBoost・damageReduce: 効果量（計算式 or 固定値文字列）
                    formula: new fields.StringField({ initial: "" }),

                    // damageBoost・damageReduce: 適用カテゴリ ("physical" | "mental")
                    damageCategory: new fields.StringField({ initial: "" }),

                    // modification: 改造可能なパラメータ名リスト
                    modifiableParams: new fields.ArrayField(
                        new fields.StringField({ initial: "" })
                    ),
                })
            ),
        };
    }

    /**
     * 旧データ移行: _id が無い既存エントリに randomID を付与する。
     * @override
     */
    static migrateData(source) {
        if (Array.isArray(source.actions)) {
            source.actions = source.actions.map(a => {
                const migrated = a._id ? a : { ...a, _id: foundry.utils.randomID() };
                if (!migrated.baseSkillRef) migrated.baseSkillRef = { itemId: "" };
                return migrated;
            });
        }
        return source;
    }
}
