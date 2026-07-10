/**
 * @fileoverview UsageTemplate - 用途(Action)リストを定義する template クラス
 *
 * 使用 Item type: miracle / generalSkill / styleSkill /
 *                weapon / armor / ianus / cyborg / tron / tap /
 *                vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * actions[].type の値域:
 *   "check"        - 判定（技能判定）。**攻撃は判定の一種**(2026-07-09 新設計・ユーザー方針):
 *                    check のうち damageCategory が設定されているものが攻撃(weaponRef・damageType は
 *                    物理のみの攻撃プロファイル)。「白兵判定」はルール上ひとつで、攻撃かどうかは帰結。
 *                    旧 type="attack" は migrateData で check + damageCategory に移行する。
 *   "declaration"  - 宣言（判定なしで使える能力＝神業を含む。判定を伴わないため独立タイプ）
 *   "damageBoost"  - ダメージ増加（formula・damageCategory）
 *   "damageReduce" - ダメージ軽減（formula・damageCategory）
 *   "modification" - 改造（modifiableParams）
 *   "npcAcquire"   - NPC取得（フェーズ11-6・Troops.md「NPC取得」。トループ級の召喚/エキストラ取得）
 *
 * タイプは作成時に固定。UI 上で切り替え不可。
 * 全タイプ共通: _id / name / description / timing / target / effects / consumeTargets
 *
 * 消費の原則(フェーズ11-6・2026-07-04 確定): 使用回数の消費は consumeTargets からのみ発生する。
 * 親アイテムの自動消費・コンボ参加技能の遠隔消費(自動スキャン)は全廃——使用回数制限のある技能を
 * 組み合わせに参加させる場合は、その消費を用途に手動で設定する必要がある(ユーザー了承済み)。
 *
 * skillRefs: check・attack タイプで使用。組み合わせ技能の item ID リスト。
 *   ベース技能は用途を所持するアイテム自身のため skillRefs に含まない。
 */

import { SystemDataModel } from "../../abstract.mjs";

/**
 * 攻撃用途か(2026-07-09 新設計): 攻撃は判定(check)の一種で、damageCategory が設定されているもの。
 * 「白兵判定」はルール上ひとつであり、攻撃かどうかは帰結(ダメージ段へ入るか)なので用途タイプを分けない。
 * @param {{type?:string, damageCategory?:string}} usage
 * @returns {boolean}
 */
export function isAttackUsage(usage) {
    return usage?.type === "check" && !!usage?.damageCategory;
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

                    // 固定達成値(フェーズ11-5・Check_Rules「固定値判定」): 設定すると、この判定は
                    // カードも出さず能力値も参照せず、この値がそのまま達成値になる(小分類「エキストラ」の
                    // アウトフィットの〈知覚〉10 等)。エキストラが行える唯一の判定形(他アクターも使用可)。
                    // null(空欄)=通常判定。
                    fixedResult: new fields.NumberField({ initial: null, nullable: true, integer: true }),

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

                    // attack: 使用武器参照(複数可)。2 個目以降を加えると攻撃力を合算する
                    // (複数武器の攻撃力合算能力の表現・2026-07-09)。武器・ヴィークルを参照できる
                    weaponRefs: new fields.ArrayField(
                        new fields.SchemaField({
                            itemId: new fields.StringField({ initial: "" }),
                        })
                    ),

                    // attack: ダメージ種別 ("S" | "P" | "I")。複数武器で種別が別々のときの選択にも使う
                    damageType: new fields.StringField({ initial: "" }),

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

                    // attack: ダメージ修正(ダメージへ加算する式の行・攻撃用途)。checkBonuses と同型。
                    // ダメージ算出時に評価するため @diff/@achievement も使える。
                    damageBonuses: new fields.ArrayField(
                        new fields.SchemaField({
                            formula: new fields.StringField({ initial: "" }),
                            source:  new fields.StringField({ initial: "" }),
                        })
                    ),

                    // damageBoost・damageReduce: 効果量（計算式 or 固定値文字列）
                    formula: new fields.StringField({ initial: "" }),

                    // damageBoost・damageReduce: 適用カテゴリ ("physical" | "mental")
                    damageCategory: new fields.StringField({ initial: "" }),

                    // modification: 改造可能なパラメータ名リスト
                    modifiableParams: new fields.ArrayField(
                        new fields.StringField({ initial: "" })
                    ),

                    // ─── 消費先設定(フェーズ11-6・2026-07-04 確定・D&D の Consumption 踏襲) ───
                    // 全ての使用回数消費はこの設定からのみ発生する(自動スキャンは全廃)。
                    //   type: "parent"=親アイテムの使用回数 / "itemUses"=同アクターの特定アイテムの
                    //         使用回数(uses) / "miracleUses"=神業の使用回数(usageCount)
                    //   itemId: type が itemUses/miracleUses のときの同アクター内 Item ID
                    //   amount: 消費量(可変・既定1)
                    // 既存 check 用途の互換(親×1)は migrateData で明示化する
                    consumeTargets: new fields.ArrayField(
                        new fields.SchemaField({
                            type:   new fields.StringField({ initial: "parent" }),
                            itemId: new fields.StringField({ initial: "" }),
                            amount: new fields.NumberField({ initial: 1, min: 1, integer: true }),
                        })
                    ),

                    // ─── NPC取得(フェーズ11-6・Troops.md「NPC取得」) ───
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
                if (migrated.consumeTargets === undefined && migrated.type === "check") {
                    migrated.consumeTargets = [{ type: "parent", itemId: "", amount: 1 }];
                }
                return migrated;
            });
        }
        return source;
    }
}
