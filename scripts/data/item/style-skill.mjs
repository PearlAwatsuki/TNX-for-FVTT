/**
 * @fileoverview StyleSkillDataModel - スタイル技能 Item の DataModel
 *
 * 使用 template: base + usage + skillBase
 * 固有フィールド: styleSkillCategory / unique / style / comboSkill / maxLevel /
 *               timing / target / range / targetValue / confrontation /
 *               isFixedRange / isFixedTarget / isEssentialSkill / isSubstitute /
 *               substituteTarget / miracleRewrite / uses / special / performance /
 *               secret / mystery
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
 * - miracleRewrite: 神業書き換え技能(神業と同じタイミングで使い、その1回の効果を書き換える)の設定。
 *   旧 RewrittenTarget / rewritingMiracleName / rewritingMiracleId(KI-018/KI-019 で typo 名から
 *   正規化したが配線されないまま残っていた3つ)を置き換えた。旧フィールドは読み手ゼロで、
 *   シートの「書き換え対象の神業」の手入力だけが値を持ちえた——移行はせず捨てる(ユーザー承認済み)。
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
import { migrateUsesValueToSpent } from "./helpers.mjs";
import { migrateUsesMaxToString, computeUsesMaxTotal } from "./uses.mjs";
import { resolveLevelRef } from "../../module/style-skill-acquisition.mjs";

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
          // 技能名カスケードのパス(辞典区分/グループ/小分類)。最終技能は name に格納
          // (identificationKey または @カテゴリ全体トークン)。部位の hostMajor/hostMinor と同方式。
          skillDict:   new fields.StringField({ initial: "" }),
          skillGroup:  new fields.StringField({ initial: "" }),
          skillSub:    new fields.StringField({ initial: "" }),
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

      // 対決(実態: {value, name, skillDict, skillGroup, skillSub} の配列)
      // 「技能名」「技能名※」では comboSkill と同じ辞典カスケードで技能を選択する(最終技能は name に識別キーで格納)
      confrontation: new fields.ArrayField(
        new fields.SchemaField({
          value: new fields.StringField({ initial: "blank" }),
          name:  new fields.StringField({ initial: "" }),
          skillDict:  new fields.StringField({ initial: "" }),
          skillGroup: new fields.StringField({ initial: "" }),
          skillSub:   new fields.StringField({ initial: "" }),
        })
      ),
      confrontationOther: new fields.StringField({ initial: "" }), // ★ 互換フィールド(ensureArray 参照)

      // フラグ
      isFixedRange:     new fields.BooleanField({ initial: false }),
      isFixedTarget:    new fields.BooleanField({ initial: false }),
      isEssentialSkill: new fields.BooleanField({ initial: false }),
      isSubstitute:     new fields.BooleanField({ initial: false }),
      // 報酬点を使用可能(一般技能の usesBounty と同一。代用時も含め一貫してこの技能自身の値を使う)
      usesBounty:       new fields.BooleanField({ initial: false }),
      // 組み合わせ不可(この技能を使う組み合わせ判定自体が不可=単独判定のみ。用途でコンボ追加を抑止)
      noCombo:          new fields.BooleanField({ initial: false }),

      // 代替ターゲット(単純な文字列配列。シートコメント: "単純な文字列の配列として扱います")
      substituteTarget: new fields.ArrayField(new fields.StringField()),

      // 指定技能の充足宣言(2026-08-26 裁定)。「特定種別の判定で、条件を満たす指定技能として
      // 扱える」効果の構造表現(例: 情報収集判定であらゆる業界社会として扱える)。
      // **代用技能(substituteTarget)とは別系統**——同一性は与えず、組み合わせ機構からは一切
      // 参照されない。消費点は判定の応答選択肢ビルダー(designation-response-logic)のみ。
      // kinds: 判定種別(infoGathering/appearance・拡張可能)
      // condition: 条件(society=あらゆる社会 / SOCIETY_CLASSES のキー=下位区分)
      designationStandIn: new fields.ArrayField(new fields.SchemaField({
        kinds:     new fields.ArrayField(new fields.StringField()),
        condition: new fields.StringField({ initial: "society" }),
      })),

      // 神業書き換え(unique="miracleChange"・神業と同じタイミングで使い、**その1回の使用に限り**
      // 神業の効果を書き換える)。ルール上の4種類を2軸で表す:
      //   effect             = 書き換え後の効果の出どころ("ref"=別の神業と同じ / "own"=この技能の用途)
      //   rewriteCondition   = 経験点の取得条件も書き換えるか(オフ=元の神業の条件のまま)
      // **効果文は必ず書き換わる**(選択を持たない・2026-09-07 ユーザー指摘「元の効果文のままと
      // いうのはありえない」)。選べるのは取得条件だけ＝ルールに「条件は変わらない」型があるため。
      // description = 独自効果型の効果文。**技能の解説は使わない**——技能の解説はその技能の説明で
      // あって、書き換えた後の神業の効果文ではない(2026-09-07 ユーザー指摘)
      // target = 対応する神業(この神業をロールしたときに書き換えを申し出る)。**空欄ならどの神業でも**
      // 候補に出す(組み合わせの可否は卓が決めるという規範を残すため)。照合は識別キー優先・
      // 無ければ名前(辞典の1件とアクターの写しの照合と同じ規則=miracleIdentityMatches)。
      // uuid は表示のライブ解決用・name は削除時のフォールバック表示と照合の予備。
      // condition = 独自効果型で取得条件も書き換えるときの条件文(神業の usageCondition と同じ器)。
      // アイテムには何も書き込まない実行時の差し替えで、《万能道具》の「実体を写す」(方針A)とは別物。
      // 旧 RewrittenTarget / rewritingMiracleName / rewritingMiracleId(template.json 時代の遺物・
      // 読み手ゼロ)はここに置き換えた
      miracleRewrite: new fields.SchemaField({
        target: new fields.SchemaField({
          uuid: new fields.StringField({ initial: "" }),
          key:  new fields.StringField({ initial: "" }),
          name: new fields.StringField({ initial: "" }),
        }),
        effect:             new fields.StringField({ initial: "" }),
        refUuid:            new fields.StringField({ initial: "" }),
        description:        new fields.StringField({ initial: "" }),
        rewriteCondition:   new fields.BooleanField({ initial: false }),
        condition:          new fields.StringField({ initial: "" }),
      }),

      // 使用回数(outfitBase.uses と同型だが styleSkill 固有の別フィールド)
      // spent = 消費済み回数（D&D 方式）。残り = max - spent
      // max は**数値も式も受ける**(2026-08-09「1シーンにレベル回」)。実効値は派生 uses.maxTotal(uses.mjs)
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        spent:   new fields.NumberField({ initial: 0 }),
        max:     new fields.StringField({ initial: "" }),
        type:    new fields.StringField({ initial: "" }),
      }),

      identificationKey: new fields.StringField({ initial: "" }),

      // 自動取得(フェーズ10-2): 習得時に取得する対象。
      // - acquiresOutfit: 「取得と同時にアウトフィットを取得する」トグル。ON で取得アイテム欄を表示・自動取得。
      // - autoAcquireItems: 武器取得技能の対象アイテム(UUID)。取得時に複製生成。
      // name は元が削除された場合の表示フォールバック(UUID 解決失敗時)。
      // ※旧 autoAcquireActors(トループ取得技能の対象アクター)は 2026-07-08 廃止——
      //   取得対象は NPC取得用途側(usage.acquireActorRef)で設定する(migrateData で除去)。
      acquiresOutfit: new fields.BooleanField({ initial: false }),
      autoAcquireItems: new fields.ArrayField(
        new fields.SchemaField({
          uuid: new fields.StringField({ initial: "" }),
          name: new fields.StringField({ initial: "" }),
        })
      ),
      // 取得武器の使用義務(true=この武器で判定しなければならない / false=取得のみ・使用は任意)
      weaponUseMandatory: new fields.BooleanField({ initial: false }),

      // 経験点消費なしで取得可(10-3): 自動習得(クロガネのフォルム等)・2技能セットの相方自動習得用。
      // EXP 集計・レベル変更コストを 0 にする(取得・成長に経験点を消費しない)。
      expFree: new fields.BooleanField({ initial: false }),

      // 取得数カウントから除外(10-3): 秘技/奥義の取得数表示(表示のみ・非強制)から外す。
      // 特殊な取得条件・取得方法の技能用。種別(secret/mystery)に応じて表示ラベルを出し分ける。
      excludeFromCount: new fields.BooleanField({ initial: false }),

      // 他スタイル技能レベルの自動参照(10-3): 模造技能・血脈〈魔性〉など、便宜上の別ブロックで
      //   実体は1技能(パラメータ・効果が2組)。enabled 時、key(識別キー)の同アクター内スタイル技能の
      //   レベルでこの技能のレベルを**派生上書き**する(prepareDerivedData)。判定は通常通り上書き後の
      //   レベルを読むだけ(判定フローは関与しない)。スートは手動。
      //   - dict/ワールド直下: key は識別キー文字列(入力欄)。アクター上: ドロップダウンで選択。
      //   - 二重計上しない: 経験点コスト・取得数カウントから除外する(cast シート側)。
      levelRef: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        key:     new fields.StringField({ initial: "" }),
      }),

      // スキルカテゴリ別経験点コスト
      special: new fields.SchemaField({
        expCost: new fields.NumberField({ initial: 10 }),
        works: new fields.SchemaField({
          value:        new fields.BooleanField({ initial: false }),
          organization: new fields.StringField({ initial: "-" }),
          // 部署技能(フェーズ11-4・2026-07-03 確定): 部署を表すワークス技能。取得していると
          // 所属名(ワークス名)の表示がこの技能の名前で上書きされる(トループはトループ名の組織名部分も)。
          isDepartment: new fields.BooleanField({ initial: false }),
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

  /**
   * @override 旧 uses.value（残り回数）→ uses.spent（消費済み回数）へ移行。
   * spent = max - value（[0, max] にクランプ）。あわせて uses.max を文字列へ移行する。
   */
  static migrateData(source) {
    migrateUsesValueToSpent(source);
    // uses.max の NumberField → StringField(2026-08-09)。**spent 移行の後に**呼ぶ(前者が max を数値で読む)
    migrateUsesMaxToString(source);
    // 旧 autoAcquireActors(2026-07-08 廃止): 取得対象は NPC取得用途側で設定するため除去する
    delete source.autoAcquireActors;
    return super.migrateData(source);
  }

  /**
   * @override
   * レベル自動参照(10-3)を適用したうえで、使用回数の最大値(式可)を解く。
   * **順序が意味を持つ**: 「1シーンにレベル回」の式はレベル自動参照で確定したレベルを読む。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    this._applyLevelRef();
    computeUsesMaxTotal(this);
  }

  /**
   * SkillBaseTemplate が levelTotal=level を確定した後、レベル自動参照(10-3)を適用する。
   * levelRef.enabled のとき、同アクター内の参照先スタイル技能(識別キー一致)のレベルで
   * この技能の level / levelTotal を上書きする(派生・source 不変)。判定はこの確定値を読むだけ。
   * 参照先が見つからない・アクター外(辞典/直下)では何もしない(指定のみ保持)。
   */
  _applyLevelRef() {
    if (!this.levelRef?.enabled || !this.levelRef.key) return;
    const item  = this.parent;
    const actor = item?.actor;
    if (!actor) return;
    const siblings = actor.items
      .filter(i => i.type === "styleSkill" && i.id !== item.id)
      .map(i => ({ identificationKey: i.system?.identificationKey, level: i.system?.level }));
    const refLevel = resolveLevelRef(this.levelRef.key, siblings);
    if (refLevel === null) return;
    this.level      = refLevel;
    this.levelTotal = refLevel;
  }
}
