/**
 * @fileoverview UsageTemplate - 用途(Action)リストを定義する template クラス
 *
 * 使用 Item type: miracle / generalSkill / styleSkill /
 *                weapon / armor / ianus / cyborg / tron / tap /
 *                vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * actions[].type の値域: **行動種別の16タイプ**(2026-07-17 ユーザー確定・正本は
 * scripts/module/usage-types.mjs の USAGE_TYPE_DEFS と Check_Rules.md「用途タイプ」)。
 *   判定(check)・宣言(declaration)／物理攻撃・精神攻撃・社会攻撃／ドッジ・パリー・
 *   リアクション（精神攻撃）（社会攻撃）（移動妨害）（離脱妨害）／移動・離脱・治療・改造・カバー。
 *   「技能クリック以外から起動し、可能な技能を識別する必要がある行動」だけをタイプにする。
 *   - 攻撃は damageCategory フラグから攻撃タイプへ移行(系統はタイプが持つ)。
 *   - カバー(covering)・回復(recovery)のフラグはタイプへ移行(治療は executionForm で判定/宣言を選ぶ)。
 *   - NPC取得は用途内で機能が完結する(識別不要)ためタイプにせずフラグのまま。
 *   - 2026-07-13 の check/declaration 一本化で排除したのは「メカニクスのタイプ化」であり、
 *     行動種別タイプは組み合わせと衝突しない(行動は常に1つの用途から起動される)。
 *
 * タイプは作成時に固定。UI 上で切り替え不可。
 * 全タイプ共通: _id / name / description / timing / target / effects / consumeTargets
 * name の既定は空(2026-07-17 ユーザー確定): 空のときの実効名=「タイプ名（親アイテム名）」(usageDisplayName・全表示箇所統一)。
 *
 * 消費の原則(フェーズ11-6・2026-07-04 確定): 使用回数の消費は consumeTargets からのみ発生する。
 * 親アイテムの自動消費・コンボ参加技能の遠隔消費(自動スキャン)は全廃——使用回数制限のある技能を
 * 組み合わせに参加させる場合は、その消費を用途に手動で設定する必要がある(ユーザー了承済み)。
 *
 * skillRefs: 判定を行うタイプで使用。組み合わせ技能の item ID リスト。
 *   ベース技能は用途を所持するアイテム自身のため skillRefs に含まない。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { isAttackType, isReactionType, usesVehicle, defaultConfrontationForType } from "../../../module/usage-types.mjs";

/**
 * 攻撃用途か。攻撃は行動種別タイプ(物理攻撃/精神攻撃/社会攻撃)で表す(2026-07-17 再編。
 * 旧 check+damageCategory は migrateData で攻撃タイプへ移行済み)。
 * @param {{type?:string}} usage
 * @returns {boolean}
 */
export function isAttackUsage(usage) {
    return isAttackType(usage?.type);
}

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

                    // 戦闘タブに表示しない(2026-07-20 ユーザー確定): 戦闘タブ「タイミングごとの
                    // 使用技能・アウトフィット」の再表示から除外する。表示のみの設定であり、
                    // 用途の起動・判定・タイミングの意味そのものには一切影響しない
                    hideInCombatTab: new fields.BooleanField({ initial: false }),

                    // 対象 (getSkillOptions().target 準拠。スタイル技能の target/targetOther/isFixedTarget と同形)
                    target:        new fields.StringField({ initial: "blank" }),
                    targetOther:   new fields.StringField({ initial: "" }),   // target === "other" の自由入力
                    isFixedTarget: new fields.BooleanField({ initial: false }), // 変更不可（※）: AE による対象変更を抑止（実機能はフェーズ13）
                    // 自身に適用できない(2026-07-18 ユーザー確定): 「この効果は自身には適用できない」
                    // 「自身以外の対象に」系の効果の識別。機械的効果は自動セルフ解決の抑止
                    // (→対象選択ダイアログ)のみ。明示ターゲットは弾かない(2026-07-19 ユーザー裁定で
                    // 旧「ターゲットが間違っています」中止を撤廃・usage-target-plan.mjs)
                    cannotTargetSelf: new fields.BooleanField({ initial: false }),

                    // 射程 (getSkillOptions().range 準拠)
                    range:        new fields.StringField({ initial: "blank" }),
                    // 最長射程(2026-07-16): 武器の range.{min,max} と同じ幅表現。"none"=単点(従来と同義)。
                    // range が物理射程(至近〜超遠)のときのみ意味を持つ(例: range="short"+rangeMax="long"=近〜遠)
                    rangeMax:     new fields.StringField({ initial: "none" }),
                    rangeOther:   new fields.StringField({ initial: "" }),    // range === "other" の自由入力
                    isFixedRange: new fields.BooleanField({ initial: false }), // 変更不可（※）: AE による射程変更を抑止（実機能はフェーズ13）

                    // 目標値 (getSkillOptions().targetValue 準拠。number / other でサブ入力)
                    targetValue:       new fields.StringField({ initial: "blank" }),
                    targetValueNumber: new fields.NumberField({ initial: 0 }),
                    targetValueOther:  new fields.StringField({ initial: "" }),

                    // 固定達成値(フェーズ11-5・Check_Rules「固定値判定」): 設定すると、この判定は
                    // カードも出さず能力値も参照せず、この値がそのまま達成値になる(小分類「エキストラ」の
                    // アウトフィットの〈知覚〉10 等)。エキストラが行える唯一の判定形(他アクターも使用可)。
                    // null(空欄)=通常判定。
                    fixedResult: new fields.NumberField({ initial: null, nullable: true, integer: true }),

                    // ─── 対決欄(2026-07-17 ユーザー確定・Check_Rules「対決の解釈(是正)」) ───
                    // 拘束リスト: ※がなくても列挙された手段・技能によってしかリアクションできない。
                    // 行の形はスタイル技能の confrontation と同形(技能名系は辞典カスケード・name=識別キー)。
                    // value の値域は用途独自(USAGE_CONFRONTATION_OPTIONS): blank/skillName/skillNameAsterisk/
                    // 手段行(リアクション用途タイプと1:1)/none/cannot。「不可」はマスクであり、下地の行は
                    // 無視・無効化に備えて並存保存する。旧 isUnopposable トグルは行「不可」へ一本化(migrateData)。
                    confrontation: new fields.ArrayField(
                        new fields.SchemaField({
                            value: new fields.StringField({ initial: "blank" }),
                            name:  new fields.StringField({ initial: "" }),
                            skillDict:  new fields.StringField({ initial: "" }),
                            skillGroup: new fields.StringField({ initial: "" }),
                            skillSub:   new fields.StringField({ initial: "" }),
                        })
                    ),

                    // リアクション系用途: 対決不可にもリアクション可(2026-07-17 ユーザー確定)。
                    // 「対決:不可」を無視できるが、下地の対決拘束は受ける(下地を満たさなければ不可)。
                    ignoresUnopposable: new fields.BooleanField({ initial: false }),

                    // 治療タイプ: 実行形式("check"=判定 / "declaration"=宣言)。1つのタイプで両形式を
                    // カバーし、どちらで動くかは用途の設定で固定する(2026-07-17 ユーザー確定)。
                    // 他タイプはタイプ自体が形式を決めるためこの欄を読まない(executionFormOf)。
                    executionForm: new fields.StringField({ initial: "check" }),

                    // ヴィークル準備時(2026-07-18 一般化ユーザー確定): オンにすると「使用ヴィークル」欄を
                    // 表示し、準備済みヴィークルが無ければ判定不可になる。任意の判定用途で使える
                    // (旧・タイプ固定 usesVehicle の一般化)。移動/リアクション（移動妨害）は既定オン。
                    requiresVehicle: new fields.BooleanField({ initial: false }),
                    // 使用ヴィークル(完全に単一参照・2026-07-17 ユーザー確定)。
                    // 空=実行時に準備済みヴィークルを自動解決。準備済みヴィークルが無ければ判定不可。
                    vehicleRef: new fields.SchemaField({
                        itemId: new fields.StringField({ initial: "" }),
                    }),

                    // 物理攻撃: 白兵攻撃("melee")か射撃攻撃("ranged")か(2026-07-17 ユーザー確定)。
                    // 武器識別のためでなく「射撃攻撃は純粋な生身では行えない」の表現——射撃攻撃は
                    // 「射撃武器」フラグの武器を準備していなければ判定不可。生身は白兵武器なので
                    // 白兵攻撃は基本的に常に可。既定=白兵。
                    attackWeaponKind: new fields.StringField({ initial: "melee" }),

                    // この用途使用時に付与する ActiveEffect の参照。itemId=効果が乗っているアイテム
                    // (親アイテム＝空／組み合わせ技能／使用武器のいずれか。2026-07-10 で itemId 追加)。
                    // itemId 空＝親アイテム(this._item)の効果を指す(旧データの互換)。
                    effects: new fields.ArrayField(
                        new fields.SchemaField({
                            itemId:   new fields.StringField({ initial: "" }),
                            effectId: new fields.StringField({ initial: "" }),
                        })
                    ),

                    // attack: 「1点でもダメージを与えたら適用される効果」の2つ目のリスト
                    // (2026-07-18 ユーザー確定)。effects=一般(攻撃では命中時)・こちら=ダメージ時。
                    // タイミングはこのリスト所属で決まる(AE 側には持たせない)。条件の判定はコード化
                    // せず、ダメージカードの「効果を適用」ボタンを押す/押さないの卓判断に委ねる
                    damageEffects: new fields.ArrayField(
                        new fields.SchemaField({
                            itemId:   new fields.StringField({ initial: "" }),
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

                    // check・attack: この用途で「無視する指定技能」(辞典の識別キー・2026-07-10)。
                    // ここに設定した技能を指定「技能」とするスタイル技能は、その指定技能を自動追加せず
                    // **単体で**組み合わせに参加できる(指定技能がアクションでも弾かれない)。
                    // 〈技能AⅡ〉系「技能：〈X〉のスタイル技能とも組み合わせ可能になる」効果の表現。
                    ignoreComboSkills: new fields.ArrayField(
                        new fields.StringField({ initial: "" })
                    ),

                    // attack: 使用武器参照(複数可)。2 個目以降を加えると攻撃力を合算する
                    // (複数武器の攻撃力合算能力の表現・2026-07-09)。武器・ヴィークルを参照できる
                    weaponRefs: new fields.ArrayField(
                        new fields.SchemaField({
                            itemId: new fields.StringField({ initial: "" }),
                        })
                    ),

                    // attack: ダメージ種別 ("S" | "P" | "I")。複数武器で種別が別々のときの選択にも使う
                    damageType: new fields.StringField({ initial: "" }),

                    // attack: スタン可能(肉体攻撃=スタン・精神攻撃=説得・2026-07-11 ユーザー確定)。
                    // ON の攻撃のみ、ダメージ確定の直前に「スタン/説得を適用するか」のダイアログを出す
                    // (OFF ならダイアログ自体を出さない)。適用=最終ダメージ 10 以上を 10 とみなす。
                    canStun: new fields.BooleanField({ initial: false }),

                    // check/declaration: ダメージを修正(2026-07-11 ユーザー確定。check では攻撃セクション
                    // 所属＝isAttack と排他ラジオ・宣言では独立チェックボックス=2026-07-12)。
                    // ON の用途は判定を行わず、**アイテムロールから使用**する: 使用で「ダメージクリック
                    // 待ち」モードに入り、ダメージ・チャットカードのダメージ(攻撃側合計)をクリックすると
                    // 修正値(damageBonusSelf・式。増加=正/軽減=負)がそのダメージへ適用される。
                    // 有効なのは算出後〜適用前(適用済みカードは不可)。増加技能(タイミング：ダメージ算出)は
                    // カードが出た直後にクリックして表す(旧 boostDamage の待ち受け登録方式は置換・廃止)。
                    modifyDamage: new fields.BooleanField({ initial: false }),

                    // check: 判定ボーナス(達成値へ加算する式の行・全判定用途。2026-07-10 ユーザー確定)。
                    // 各行 = { formula: 式, source: 供給元の識別キー(組み合わせスタイル技能/使用武器。空=用途) }。
                    // 供給元を持たせることで「どの能力から供給された加算か」をチャットで識別できる。
                    // 式は @system.*(アクター=AEキー)・@item.system.*(供給元アイテム=AEキー)・@diff/@achievement を参照可。
                    checkBonuses: new fields.ArrayField(
                        new fields.SchemaField({
                            formula: new fields.StringField({ initial: "" }),
                            source:  new fields.StringField({ initial: "" }),
                        })
                    ),

                    // check: 用途自身の判定修正値(専用欄・供給元つきの追加行とは別枠・2026-07-10)。
                    // その用途の親アイテムが持つ修正値を入れる欄。式では @item.self=用途の親アイテムを
                    // 参照でき(識別キー不要)、台帳では親アイテム名で帰属する。
                    checkBonusSelf: new fields.StringField({ initial: "" }),

                    // check: 再判定可能(2026-07-11 ユーザー確定)。ON の用途からの判定は、結果カードに
                    // 「再判定(カードを出し直す)」ボタンが出る(判定値の再決定)。再判定を可能にする
                    // 特定技能の能力の表現。判定は全て用途を経由するため、この設定で全ケースを表せる。
                    allowRecheck: new fields.BooleanField({ initial: false }),

                    // check: スート変更可能(2026-07-12 ユーザー確定)。ON の用途からの判定では、
                    // 使用できないスートのカードを出したとき、スート不一致にせず使用可能なスートへ
                    // 変更できる(選択ダイアログ)。「組み合わせた判定に使用したカードのスートを
                    // 使用可能なものに変更する」スタイル技能の効果の用途側設定(ignoreComboSkills と
                    // 同じ型)。無印「判定」の機構のため制御判定は対象外(用語規約)。
                    allowSuitChange: new fields.BooleanField({ initial: false }),

                    // check/declaration: スートを変更(次の判定・2026-07-12 ユーザー確定)。ON の用途は
                    // 使用しても判定を行わず「スート変更待ち」に入る(アイテムロール使用・再使用で
                    // キャンセル)。次に自分が行う判定で使用不可スートを出したとき、使用可能スートへの
                    // 変更が適用される(消費は適用確定時)。他者へは AE `check.suitChange` の付与で表す
                    // (「1回の判定」Duration の自動失効は時間管理フェーズ=持続時間と AE キーは独立)。
                    grantSuitChange: new fields.BooleanField({ initial: false }),

                    // check/declaration: 回復(2026-07-13 ユーザー確定)。BS/戦闘不能/負傷を除去する
                    // 回復・治療系スタイル技能の表現。使用はアイテムロール→対象解決→**対象が現在
                    // 受けている状態から回復対象を選択**→宣言=即除去/判定=成功で除去(ctx.recovery)。
                    // - recoveryTargets: 範囲の行 {group, kind}(group=bs/incapacitation/physical/
                    //   mental/social・kind 空=グループ全体・複数行 OR)。社会負傷の回復は専用スタイル
                    //   技能か神業のみの経路=範囲に「負傷(社会)」を設定した用途がそれ。
                    // - recoveryExcludes: 除外タグ(タグ自身+そのタグを与える負傷を除外=「指定タグを
                    //   含むもの以外すべて」)。通例は完全死亡・精神崩壊を除外(全回復系でも治療不可)。
                    // - recoveryAll: 該当すべてを回復 / recoveryCount: 回復数(All=false のとき)。
                    // - 目標値は発動タブの目標値設定に一本化(2026-07-13・回復専用の式欄
                    //   recoveryTargetFormula は廃止=migrateData で目標値「その他」へ移送)。
                    //   解説参照/その他の式は @condition.magnitude/@condition.woundValue を参照可
                    //   (woundValue=治療対象のダメージのチャート値)。
                    // - 治療メニュー(シートの状態クリック)起点も同じ用途起動へ一本化(2026-07-18
                    //   ユーザー確定・入口照合は treatment-flow)。旧・目標値ハードコード(気絶15等)は
                    //   廃止——分岐は範囲＋目標値設定で表現し、通常ダメージ用の用途は戦闘不能系タグを
                    //   全て除外に入れる設定規約とする。
                    // ※旧 recovery フラグは治療タイプへ移行(2026-07-17 再編・migrateData)。
                    //   回復範囲の設定群は治療タイプの設定として温存する。
                    recoveryTargets: new fields.ArrayField(
                        new fields.SchemaField({
                            group: new fields.StringField({ initial: "" }),
                            kind:  new fields.StringField({ initial: "" }),
                        })
                    ),
                    recoveryExcludes: new fields.ArrayField(new fields.StringField()),
                    recoveryAll: new fields.BooleanField({ initial: false }),
                    recoveryCount: new fields.NumberField({ initial: 1, integer: true, min: 1 }),
                    // 防御タイプの「受けた後に消す」(17-2・神業の治癒)で足す回復設定:
                    // - recoveryEffects: スタイル技能から付与された効果(付与コピー)も回復対象に並べて
                    //   剥がせる(《人命救助》「任意のスタイル技能の効果を解除する」)。
                    // - recoverySceneLimit: 受けたシーンの制限。none=なし / terminal=終端状態(完全死亡・
                    //   精神崩壊)だけそのシーンで受けたものに限る(《腹心》《人命救助》) / all=すべてそのシーン
                    //   (《黄泉還り》を他人に使うとき)。状態が持つ「受けたシーン」と照合する
                    recoveryEffects: new fields.BooleanField({ initial: false }),
                    recoverySceneLimit: new fields.StringField({ initial: "none" }),

                    // ─── 防御タイプ(17-2・神業専用) ───
                    // 動作: negate=打ち消し(判定を失敗させる/宣言の効果適用をキャンセル・《チャイ》《平和》)
                    //       prevent=適用前に防ぐ(ダメージカードの対象行が消える・《難攻不落》《守護神》《友情》)
                    //       evade=回避(攻撃カードで自分の行を回避に・物理のみ・《脱出》)
                    //       cure=受けた後に消す(治療の宣言形＋上の回復設定・《腹心》《黄泉還り》《人命救助》《霧散》)
                    // 範囲(prevent): all=一回の攻撃・神業まるごと / one=選んだ1人
                    // 系統(prevent): 防げる系統。《難攻不落》は社会を外す。既定は3系統すべて
                    defenceAction: new fields.StringField({ initial: "prevent" }),
                    // 打ち消し(negate): 空なら何でも打ち消せる。辞典の神業を1つ指定すると
                    // **その神業だけ**打ち消せる(《真実に対する不可触》等)。神業ごとに相手が変わるので
                    // ここは選ぶ操作＝プルダウン(2026-09-06 ユーザーの基準)
                    negateMiracle: new fields.StringField({ initial: "" }),
                    defenceScope: new fields.StringField({ initial: "all" }),
                    defenceCategories: new fields.ArrayField(new fields.StringField(), { initial: ["physical", "mental", "social"] }),

                    // ─── 即死・社会戦タイプ(17-3・神業専用) ───
                    // 即死: 系統(肉体=《死の舞踏》《とどめの一撃》／精神=《神の御言葉》)。終端状態(完全死亡/
                    // 精神崩壊)か任意ダメージ(チャートの値)を使用時に選ぶ。対象がトループなら壊滅(人数 0)。
                    // 社会戦: 結果の決め方。choose=使用者がチャートの行(抹殺含む)を選ぶ(《制裁》)／
                    // rl=RL が値を入力するか山札から2枚めくる(《暴露》)
                    killCategory: new fields.StringField({ initial: "physical" }),
                    socialDecide: new fields.StringField({ initial: "choose" }),

                    // ─── 宣言の効果(17-4/17-6・神業の宣言タイプ専用) ───
                    // ""=なし／addUse=対象の神業1つの使用回数を+1(《ファイト！》: 使用済みでも可・
                    // アクト中の効果として対象の神業に載せる)／requestUse=対象に神業を使わせる
                    // (《プリーズ！》: 相手の神業は使用済みにならない・使い切った神業も可)／
                    // swapDamage=宿主(キャストの host・RL がアクトごとに設定)と自分のダメージ・状態を丸ごと入れ替える(《神出鬼没》)／
                    // acquireOutfit=アウトフィットを入手する・常備化できない(《タイムリー》《買収》)／
                    // insensible=次の行動を神業以外で妨げられなくする(《不可知》)
                    miracleEffect: new fields.StringField({ initial: "" }),

                    // 修理(2026-07-18 ユーザー確定・repair タイプ): この用途で修理できるアウトフィットの
                    // 分類キーのホワイトリスト(小分類キーまたは大分類キー=その大分類全体・2026-07-19)。
                    // 使用→対象解決(未ターゲット=自分)→対象所持の故障アウトフィットのうち分類が
                    // 合致するものを選択→判定成功で故障(isMalfunction)を解除。
                    // 空=どの故障アウトフィットも列挙しない(未設定は修理対象なし)。破壊は修理対象外。
                    repairableCategories: new fields.ArrayField(new fields.StringField()),

                    // check: 再判定を付与(2026-07-11 ユーザー確定)。ON の用途は使用しても判定を行わず、
                    // 「達成値クリック待ち」モードに入る。既存の結果カードの達成値をクリックすると、
                    // その判定に**この用途の親技能を組み合わせた状態で**再判定が起動する
                    // (「失敗した判定にこの技能を組み合わせてやり直す」系の能力の表現。
                    // 発動条件(失敗時のみ・山札のみ等)は自動強制しない=卓裁定)。
                    grantRecheck: new fields.BooleanField({ initial: false }),

                    // check/declaration: 判定を修正(2026-07-11 ユーザー確定)。ON の用途は使用しても
                    // 判定を行わず、「達成値クリック待ち」モードに入る。達成値クリックで**その判定に
                    // 事後的なボーナス/ペナルティを適用**する(値=この用途の判定修正値(checkBonusSelf・式)。
                    // 空なら手入力)。事後修正された判定を再判定すると修正はリセットされる
                    // (再判定は元の構成から再実行するため)。宣言でも設定可(バフ宣言の表現・2026-07-12。
                    // 判定の前に使用→判定後にクリックで「直前使用のバフ」も表せる)。
                    modifyCheck: new fields.BooleanField({ initial: false }),

                    // check/declaration: 割り込み許可を付与(2026-07-22 ユーザー確定・フェーズ13-5)。
                    // ON の宣言/判定用途を使うと、ターゲットしたキャラクター(対象なしは自分)の
                    // combatant に「割り込み許可」が立ち、カット進行トラッカーの割り込み入口が開く。
                    // 割り込み＝順番外のメインプロセスを挿入する(イニシアチブでの割り込み・追加行動技能)。
                    // 入口は対象の操作者/RL のみ押せ、行使で消費される(ワンショット)。技能の組み合わせは
                    // 自動化しない。
                    grantsInterrupt: new fields.BooleanField({ initial: false }),

                    // 挿入メインが AR を消費するか(2026-07-26 全面改訂の実装レバー・Combat_Flow「AR・
                    // メジャーアクション・プロセス所有の一般則」)。真(既定)=自己割り込み等でその挿入メインは
                    // 一般則の対象(メジャーを行えば終了時 AR−1＋CS0)。偽=追加行動技能で無償(付与者が自分の
                    // メジャーとして払う=肩代わり)。将来の神業の特別措置もここで例外を明示できる。
                    // grantsInterrupt が真のときだけ意味を持つ。
                    interruptConsumesAr: new fields.BooleanField({ initial: true }),

                    // check(リアクション): リアクション用途の追加挙動(2026-07-15 ユーザー確定)。用途の
                    // 「リアクション」セクションで設定する。両者は独立(成功/勝利が引き金)。
                    // - reactionAreaAttack: 範囲攻撃へのリアクション。リアクション成功時、同じ攻撃の
                    //   全対象を回避で解決する(リアクションした本人も対象の一人)。
                    // - reactionFailsAttack: 攻撃を失敗させる。リアクションの勝利時、攻撃を「失敗」状態に
                    //   する(全対象が被弾しない=各自がリアクションせずとも良い。攻撃者の行動はメイン
                    //   プロセス終了時に通常消費・追加の状態は付与しない)。
                    reactionAreaAttack: new fields.BooleanField({ initial: false }),
                    reactionFailsAttack: new fields.BooleanField({ initial: false }),

                    // ※旧 covering フラグはカバータイプへ移行(2026-07-17 再編・migrateData)。
                    //   カバー: ダメージ算出の直前に他者への予定ダメージを自身へ付け替える行動
                    //   (アイテムロールで使用→ダメージカードの対象クリック→判定成功で付け替え)。

                    // attack: ダメージ修正(ダメージへ加算する式の行・攻撃用途)。checkBonuses と同型に
                    // 加え、行ごとの対象条件 targetCondition(2026-09-01 承認・照合は target-condition.mjs)。
                    // kind=none(条件なし)/wet/style/works・mode=exclude(には無効)/only(のみ有効)・
                    // key=スタイル/組織の識別キー。無効化された行は内訳に注記つき 0 行で残る。
                    // ダメージ算出時に評価するため @diff/@achievement も使える。
                    damageBonuses: new fields.ArrayField(
                        new fields.SchemaField({
                            formula: new fields.StringField({ initial: "" }),
                            source:  new fields.StringField({ initial: "" }),
                            targetCondition: new fields.SchemaField({
                                kind: new fields.StringField({ initial: "none" }),
                                mode: new fields.StringField({ initial: "exclude" }),
                                key:  new fields.StringField({ initial: "" }),
                            }),
                        })
                    ),

                    // attack/modifyDamage: 用途自身のダメージ修正値(専用欄・checkBonusSelf のダメージ版・
                    // 2026-07-10)。親アイテムが持つダメージ修正を入れる欄。式で @item.self を参照可・
                    // 台帳は親名で帰属。modifyDamage ではダメージ修正値(増加=正/軽減=負)としてこの欄を使う。
                    damageBonusSelf: new fields.StringField({ initial: "" }),

                    // attack: 自身の修正値の対象条件(damageBonuses 行の targetCondition と同形・
                    // 2026-09-01 承認)。
                    damageBonusSelfCondition: new fields.SchemaField({
                        kind: new fields.StringField({ initial: "none" }),
                        mode: new fields.StringField({ initial: "exclude" }),
                        key:  new fields.StringField({ initial: "" }),
                    }),

                    // attack: 「ウェットの対象には効果がない」(2026-09-01 承認)。真なら、ウェットの
                    // 対象に対してこの用途のダメージ全体を 0 にし(内訳に注記)、適用効果の付与も
                    // 行わない。判定・対決そのものはブロックしない(判定は常に行える一般規範)。
                    noEffectVsWet: new fields.BooleanField({ initial: false }),

                    // ※旧 damageCategory(攻撃系統)は攻撃タイプへ移行(2026-07-17 再編・migrateData)。
                    //   系統はタイプが持つ(attackCategoryOf)。

                    // ※旧 modifiableParams(改造可能なパラメータ名の手動リスト)は撤去(フェーズ16-1)。
                    //   改造可能項目は対象の分類から導出する(Purchase_and_Modification の分類別テーブル・
                    //   読者ゼロを確認のうえ廃止)

                    // ─── 消費先設定(フェーズ11-6・2026-07-18 再編・D&D の Consumption 踏襲) ───
                    // 全ての使用回数消費はこの設定からのみ発生する(自動スキャンは全廃)。
                    //   type:     "item"(アイテムの資源を消費) / "actionRank"(AR を消費)。
                    //   itemId:   type="item" のとき、空="このアイテム自身"(用途の親)・値=同アクター内 Item ID。
                    //   resource: type="item" のとき "uses"(使用回数=uses.spent)。神業も射撃武器の弾数も同じ
                    //             ——残弾は廃止し使用回数へ一本化した(2026-07-19 ユーザー確定)。
                    //   amount:   消費量(可変・既定1)。負値は回復(リロードの表現)。0 は実行時に無視。
                    // 既定は空(2026-07-17 ユーザー指示=旧・無条件の「親×1」既定行は全廃)。
                    // 旧 type(parent/itemUses/miracleUses/ammo)は migrateData で item+resource へ移行。
                    consumeTargets: new fields.ArrayField(
                        new fields.SchemaField({
                            type:     new fields.StringField({ initial: "item" }),
                            itemId:   new fields.StringField({ initial: "" }),
                            resource: new fields.StringField({ initial: "uses" }),
                            amount:   new fields.NumberField({ initial: 1, integer: true }),
                        })
                    ),

                    // ─── NPC取得(フェーズ11-6・Troops.md「NPC取得」) ───
                    // npcAcquire: NPC取得を行う(2026-07-13 タイプ→フラグへ移管)。check/declaration の
                    // どちらにも設定できる(設定 UI は効果タブ・トループ取得技能とアウトフィットのみ)。
                    npcAcquire: new fields.BooleanField({ initial: false }),

                    // ─── 改造して入手(16-4・購入タイプの任意属性) ───
                    // 「購入判定を行い、改造されたアウトフィットを入手する」変則効果の受け皿
                    // (2026-08-31 設計確定=効果の自動導出はせずデータ入力時に立てる)。
                    // オンの購入は判定前に改造項目を選択し、付与する複製の改造記録へ書き込む
                    acquireModified: new fields.BooleanField({ initial: false }),
                    // acquireMode: 取得類型(extra/troop/enigma/bunshin)。参照先の種類からの導出は
                    // しない(2026-07-04 ユーザー裁定=モードは明示選択)。
                    // acquireItemRefs: エキストラモードで派生取得する小分類「エキストラ」の
                    // アウトフィット参照(name は参照先削除時の表示フォールバックのみ・ライブ解決原則)
                    // acquireActorRef: トループ/エニグマで呼び出すトループ級アクター参照
                    // (2026-07-07 ユーザー裁定=対象は用途側で設定。所有者逆引きは廃止)。
                    // 分身は対象を設定しない(2026-07-08 裁定=そのまま召喚。永続1体を自動確保して
                    // 本体から再同期・acquireCount 体のトークンを配置)
                    acquireMode: new fields.StringField({ initial: "extra" }),
                    acquireItemRefs: new fields.ArrayField(
                        new fields.SchemaField({
                            uuid: new fields.StringField({ initial: "" }),
                            name: new fields.StringField({ initial: "" }),
                        })
                    ),
                    acquireActorRef: new fields.SchemaField({
                        uuid: new fields.StringField({ initial: "" }),
                        name: new fields.StringField({ initial: "" }),
                    }),
                    // 召喚数(分身のみ・2026-07-08 裁定=分身は複数体召喚がありうる)
                    acquireCount: new fields.NumberField({ initial: 1, min: 1, integer: true }),
                })
            ),
        };
    }

    /**
     * 旧データ移行: _id が無い既存エントリに randomID を付与する。
     * 消費先設定(11-6): 設定を持たない既存の check 用途には、従来挙動(親アイテムの使用回数を
     * 自動消費)を「親×1」の明示行として引き継ぐ(親に isLimit が無ければ実行時 no-op=従来同一)。
     * @override
     */
    static migrateData(source) {
        if (Array.isArray(source.actions)) {
            source.actions = source.actions.map(a => {
                let migrated = a._id ? a : { ...a, _id: foundry.utils.randomID() };
                // 攻撃は判定の一種へ統合(2026-07-09): type="attack" → "check"(damageCategory は攻撃系統として保持)。
                // 系統未設定の旧攻撃は物理とみなす。
                if (migrated.type === "attack") {
                    migrated = { ...migrated, type: "check", damageCategory: migrated.damageCategory || "physical" };
                }
                // ダメージ増加/軽減タイプの廃止(2026-07-11): 宣言(判定なしで使える能力)へ変換。
                // 数値効果は攻撃用途のダメージ修正行/軽減ダイアログの手動欄で表す(効果はテキストに残る)
                if (migrated.type === "damageBoost" || migrated.type === "damageReduce") {
                    migrated = { ...migrated, type: "declaration" };
                }
                // 旧「ダメージを増加」(boostDamage)は「ダメージを修正」(modifyDamage)へ置換(2026-07-11)
                if (migrated.boostDamage === true && migrated.modifyDamage === undefined) {
                    migrated = { ...migrated, modifyDamage: true };
                }
                // 用途タイプの一本化(2026-07-13)のうち、旧 modification→check の変換は削除
                // (2026-07-17 行動種別再編で「改造」タイプが復活したため。残しておくと新規作成した
                // 改造用途がロードのたびに判定へ化ける)。旧 npcAcquire のフラグ化は継続:
                // エキストラ(判定なし)=宣言・トループ/エニグマ/分身=判定
                if (migrated.type === "npcAcquire") {
                    migrated = {
                        ...migrated,
                        npcAcquire: true,
                        type: (migrated.acquireMode ?? "extra") === "extra" ? "declaration" : "check",
                    };
                }
                // 回復専用の目標値式(recoveryTargetFormula)は発動タブの目標値へ一本化(2026-07-13)。
                // 設定済みの式は目標値「その他」の自由記入欄へ移送する(既存値があれば触らない)
                if (migrated.recoveryTargetFormula && !migrated.targetValueOther) {
                    migrated = {
                        ...migrated,
                        targetValueOther: migrated.recoveryTargetFormula,
                        ...(!migrated.targetValue || ["blank", "none"].includes(migrated.targetValue)
                            ? { targetValue: "other" } : {}),
                    };
                }
                // 使用武器参照の複数化(2026-07-09): 旧 weaponRef(単一) → weaponRefs(配列)。
                // 空 itemId は空配列に(生身扱い)。
                if (migrated.weaponRefs === undefined && migrated.weaponRef !== undefined) {
                    const id = migrated.weaponRef?.itemId || "";
                    migrated = { ...migrated, weaponRefs: id ? [{ itemId: id }] : [] };
                }
                // 判定ボーナス/ダメージ修正の行化(2026-07-10): 旧 checkBonus/damageBonus(単一式) →
                // checkBonuses/damageBonuses(行の配列・供給元つき)。空文字は空配列に。
                if (migrated.checkBonuses === undefined && migrated.checkBonus !== undefined) {
                    const f = migrated.checkBonus || "";
                    migrated = { ...migrated, checkBonuses: f ? [{ formula: f, source: "" }] : [] };
                }
                if (migrated.damageBonuses === undefined && migrated.damageBonus !== undefined) {
                    const f = migrated.damageBonus || "";
                    migrated = { ...migrated, damageBonuses: f ? [{ formula: f, source: "" }] : [] };
                }
                if (!migrated.baseSkillRef) migrated.baseSkillRef = { itemId: "" };
                // 旧「親×1」互換既定行の明示化(11-6)は全廃(2026-07-17 ユーザー指示=そもそも不要。
                // 消費先未設定の旧用途は空=消費なしとして扱う)
                // ─── 行動種別への再編(2026-07-17 ユーザー確定) ───
                // 攻撃: check+damageCategory → 攻撃タイプ(系統はタイプが持つ)。
                // 白兵/射撃の選択は既定=白兵(旧データは区分を持たないため。射撃攻撃は手動で切り替える)
                if (migrated.type === "check" && migrated.damageCategory) {
                    const t = { physical: "physicalAttack", mental: "mentalAttack", social: "socialAttack" };
                    migrated = { ...migrated, type: t[migrated.damageCategory] ?? "physicalAttack" };
                }
                // カバー: covering フラグ → カバータイプ
                if (migrated.covering === true && migrated.type === "check") {
                    migrated = { ...migrated, type: "covering" };
                }
                // 回復: recovery フラグ → 治療タイプ(実行形式は旧タイプを引き継ぐ=判定/宣言両用の設定化)
                if (migrated.recovery === true && (migrated.type === "check" || migrated.type === "declaration")) {
                    migrated = {
                        ...migrated,
                        executionForm: migrated.type === "declaration" ? "declaration" : "check",
                        type: "treatment",
                    };
                }
                // 対決欄の系統既定(2026-07-17): 対決欄を持たない既存データに、タイプの既定行を敷く
                // (物理攻撃=ドッジ+パリー等・全て enum)。以後はユーザー編集が正。
                // リアクション系は空配列にも「なし」を敷く(2026-07-18 裁定=全タイプが対決欄を持つ。
                // 旧実装はリアクション系に対決セクション自体を出しておらず、空配列はその時代の
                // 産物でユーザー編集ではないため上書きして安全)
                if (migrated.confrontation === undefined
                    || (isReactionType(migrated.type) && (migrated.confrontation ?? []).length === 0)) {
                    const defaults = defaultConfrontationForType(migrated.type);
                    if (defaults.length) migrated = { ...migrated, confrontation: defaults };
                }
                // 対決不可トグルの一本化(2026-07-17): isUnopposable=true → 対決欄の「不可」行へ
                if (migrated.isUnopposable === true
                    && !(migrated.confrontation ?? []).some(c => c?.value === "cannot")) {
                    migrated = {
                        ...migrated,
                        confrontation: [
                            ...(migrated.confrontation ?? []),
                            { value: "cannot", name: "", skillDict: "", skillGroup: "", skillSub: "" },
                        ],
                    };
                }
                // ヴィークル準備時の一般化(2026-07-18): 旧・タイプ固定(移動/リアクション（移動妨害）)を
                // 用途フラグ requiresVehicle へ。未設定の該当タイプは既定オンにして従来挙動を保つ
                if (migrated.requiresVehicle === undefined && usesVehicle(migrated.type)) {
                    migrated = { ...migrated, requiresVehicle: true };
                }
                // 消費先設定の type 再編(2026-07-18): 旧 type(parent/itemUses/miracleUses/ammo/actionRank)を
                // 新モデル {type:"item"|"actionRank", itemId, resource:"uses"|"ammo"} へ移行。
                // parent→item/self/uses・itemUses/miracleUses→item/itemId/uses・ammo→item/itemId/ammo
                // (残弾行は下の 2026-07-19 の破棄で最終的に取り除かれる)。
                if (Array.isArray(migrated.consumeTargets) && migrated.consumeTargets.some(t => t && t.resource === undefined)) {
                    migrated = {
                        ...migrated,
                        consumeTargets: migrated.consumeTargets.map(t => {
                            if (!t || t.resource !== undefined) return t; // 移行済みはそのまま
                            const amount = t.amount ?? 1;
                            if (t.type === "actionRank") return { type: "actionRank", itemId: "", resource: "uses", amount };
                            if (t.type === "ammo")       return { type: "item", itemId: t.itemId ?? "", resource: "ammo", amount };
                            if (t.type === "parent")     return { type: "item", itemId: "", resource: "uses", amount };
                            // itemUses / miracleUses / その他 → item + uses
                            return { type: "item", itemId: t.itemId ?? "", resource: "uses", amount };
                        }),
                    };
                }
                // 残弾の廃止(2026-07-19 ユーザー確定): 弾数管理は使用回数へ一本化し、既存の残弾データは
                // 移行せず破棄する。残った「残弾数」の消費行はそのままにすると、資源を失って
                // 「使用回数」行として復活し、制限なしの武器を指す no-op の飾り行になるため行ごと削除する。
                if (Array.isArray(migrated.consumeTargets) && migrated.consumeTargets.some(t => t?.resource === "ammo")) {
                    migrated = {
                        ...migrated,
                        consumeTargets: migrated.consumeTargets.filter(t => t?.resource !== "ammo"),
                    };
                }
                return migrated;
            });
        }
        return source;
    }
}
