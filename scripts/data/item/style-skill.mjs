/**
 * @fileoverview StyleSkillDataModel - スタイル技能 Item の DataModel
 *
 * 使用 template: base + usage + skillBase
 * 固有フィールド: styleSkillCategory / unique / style / comboSkill / maxLevel /
 *               timing / target / range / targetValue / confrontation /
 *               isFixedRange / isFixedTarget / isEssentialSkill / isSubstitute /
 *               substituteTarget / RewrittenTarget / rewritingMiracleName /
 *               rewritingMiracleId / uses / special / performance / secret / mystery
 *
 * 準拠データ: template.json > Item.styleSkill(削除済み)
 *
 * 設計判断:
 * - template.json の配列フィールド(comboSkill / confrontation / timing)は
 *   "配列であること"しか表現できない制約による近似(値は文字列配列 ["blank"] 等)。
 *   DataModel では、シート実装(getData() の ensureArray 正規化・_onSelectChange の
 *   保存構造)が参照する実際の要素構造を真実の源として SchemaField で定義する。
 *   詳細: llm-wiki/02_System/Design_Review_Entries.md B-7b
 *
 * - template.json に未定義だがシートが参照するフィールド(★)を明示定義する:
 *   maxLevelNumber / maxLevelOther / targetOther / rangeOther /
 *   targetValueNumber / targetValueOther / comboSkillOther / confrontationOther
 *   未定義のままにするとシートの _onSelectChange でバリデーションエラーになる。
 *
 * - unique の initial は "none"。template.json は "" だが、シートの選択肢定義
 *   (TnxSkillUtils.getSkillOptions)で先頭が "none" であり、これが正しいデフォルト値。
 *
 * - RewrittenTarget / rewritingMiracleId: KI-018/KI-019 で旧 typo 名(RewritedTarget /
 *   RewritingMiracle_ID)から正規化済み。テンプレート・ロジックの参照なしのため移行不要。
 *
 * - styleSkillCategory / unique の enum 型化は将来フェーズで対応。
 *
 * - 配列フィールドの initial は空配列(ArrayField デフォルト)。
 *   getData() の ensureArray が表示時に最低1要素を補う仕組みのため DataModel 側の
 *   初期化は空でよい。
 *
 * - uses SchemaField は outfitBase.uses と同型だが styleSkill 固有の別フィールド。
 *   OutfitBaseTemplate とは共用せず inline 定義する。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { SkillBaseTemplate } from "./common/skill-base.mjs";

export class StyleSkillDataModel extends SystemDataModel.mixin(BaseTemplate, UsageTemplate, SkillBaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),

      // フリガナ
      furigana: new fields.StringField({ initial: "" }),

      // カテゴリ・分類
      styleSkillCategory: new fields.StringField({ initial: "special" }),
      unique:             new fields.StringField({ initial: "none" }),
      style:              new fields.StringField({ initial: "-" }),

      // コンボ技能(実態: {value, name, isMandatory} の配列。template.json は ["blank"] で近似)
      comboSkill: new fields.ArrayField(
        new fields.SchemaField({
          value:       new fields.StringField({ initial: "blank" }),
          name:        new fields.StringField({ initial: "" }),
          isMandatory: new fields.BooleanField({ initial: false }),
        })
      ),
      comboSkillOther: new fields.StringField({ initial: "" }), // ★ 互換フィールド(ensureArray 参照)

      // 上限レベル
      maxLevel:       new fields.StringField({ initial: "blank" }),
      maxLevelNumber: new fields.NumberField({ initial: 0 }),   // ★ template.json 未定義
      maxLevelOther:  new fields.StringField({ initial: "" }),  // ★ 同上

      // タイミング(実態: {value, actionName, processName, timingOther} の配列)
      timing: new fields.ArrayField(
        new fields.SchemaField({
          value:       new fields.StringField({ initial: "blank" }),
          actionName:  new fields.StringField({ initial: "blank" }),
          processName: new fields.StringField({ initial: "blank" }),
          timingOther: new fields.StringField({ initial: "" }),
        })
      ),

      // 対象
      target:      new fields.StringField({ initial: "blank" }),
      targetOther: new fields.StringField({ initial: "" }),   // ★ template.json 未定義

      // 射程
      range:      new fields.StringField({ initial: "blank" }),
      rangeOther: new fields.StringField({ initial: "" }),    // ★ 同上

      // 目標値
      targetValue:       new fields.StringField({ initial: "blank" }),
      targetValueNumber: new fields.NumberField({ initial: 0 }),   // ★ 同上
      targetValueOther:  new fields.StringField({ initial: "" }),  // ★ 同上

      // 対決(実態: {value, name} の配列)
      confrontation: new fields.ArrayField(
        new fields.SchemaField({
          value: new fields.StringField({ initial: "blank" }),
          name:  new fields.StringField({ initial: "" }),
        })
      ),
      confrontationOther: new fields.StringField({ initial: "" }), // ★ 互換フィールド(ensureArray 参照)

      // フラグ
      isFixedRange:     new fields.BooleanField({ initial: false }),
      isFixedTarget:    new fields.BooleanField({ initial: false }),
      isEssentialSkill: new fields.BooleanField({ initial: false }),
      isSubstitute:     new fields.BooleanField({ initial: false }),

      // 代替ターゲット(単純な文字列配列。シートコメント: "単純な文字列の配列として扱います")
      substituteTarget: new fields.ArrayField(new fields.StringField()),

      // 書き換え神業関連(KI-018/KI-019: typo・命名揺れを正規化済み)
      RewrittenTarget:      new fields.StringField({ initial: "" }),
      rewritingMiracleName: new fields.StringField({ initial: "" }),
      rewritingMiracleId:   new fields.StringField({ initial: "" }),

      // 使用回数(outfitBase.uses と同型だが styleSkill 固有の別フィールド)
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        value:   new fields.NumberField({ initial: 0 }),
        max:     new fields.NumberField({ initial: 0 }),
      }),

      // スキルカテゴリ別経験点コスト
      special: new fields.SchemaField({
        expCost: new fields.NumberField({ initial: 10 }),
        works: new fields.SchemaField({
          organization: new fields.StringField({ initial: "-" }),
        }),
      }),
      performance: new fields.SchemaField({
        expCost: new fields.NumberField({ initial: 2 }),
      }),
      secret: new fields.SchemaField({
        expCost: new fields.NumberField({ initial: 20 }),
      }),
      mystery: new fields.SchemaField({
        expCost: new fields.NumberField({ initial: 50 }),
      }),
    };
  }
}
