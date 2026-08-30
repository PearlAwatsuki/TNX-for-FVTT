/**
 * @fileoverview OutfitBaseTemplate - 装備品共通フィールドを定義する template クラス
 *
 * 使用 Item type: weapon / armor / ianus / cyborg / tron / tap /
 *                 vehicle / residence / combiner / general
 * SystemDataModel.mixin() の引数として各 Item DataModel に合成して使う。
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md(フェーズ6-0 で確定)
 * 設計方針: llm-wiki/02_System/Design_Review_Entries.md B-0「論点3: 共通 template の継承戦略」参照
 *
 * フィールド型の判断(フェーズ6-0 で刷新):
 * - buy(購入値)は「なし / 数値 / 解説参照」の 3 状態、hide(隠匿値)は「なし / 数値 / 解説参照 / 制御値」の 4 状態を持つため
 *   { mode, value } の SchemaField。mode が "value" のときのみ value を使う。
 * - preserveExp(常備化経験点)は必ず数値が入るため NumberField。
 * - appearancePenalty(危険値)は「なし / 数値」の 2 状態。buy / hide / hack と同様の {mode, value} 構造
 *   (mode は none / value のみ)(フェーズ6-4 にて変更)。
 * - majorCategory / minorCategory は choices 付き StringField(outfit-categories.mjs が正本)。
 *   未選択を許すため blank: true。
 * - hack(電脳制御値)は「なし / 数値」の 2 状態。buy / hide と同様の {mode, value} 構造
 *   (mode は none / value のみ)。
 * - timing は廃止(2026-07-19 ユーザー確定)。アウトフィットのタイミングは**用途側で管理**しており、
 *   ルールブック上もアウトフィットのタイミングは解説にしか書かれないため、アイテム自身が持つ必要がない
 *   (スタイル技能の timing は説明欄の表示に関わるため存置)。
 * - part(部位)は**配列**。フェーズ10(2026-06-26)で種別(kind)ベースへ拡張した。
 *   kind = none/bodyPart/option/reference/other の5択。value/slots は維持(後方互換)。
 *   旧 {value,slots} データは kind 既定 "other" で自由記入扱いへ移行する(§4.2)。
 *   結合は兄弟フィールド partRelation(and/or)、or 時の装備先は partOrChoice。
 *   表示・占有ルールの正本は Outfits.md「部位管理(フェーズ10)」。
 * - exclusive はスタイル/オーガニゼーション辞典参照の配列(`{type,key}[]`・複数可)。自動化なし(指定のみ)。
 * - uses.type は使用回数の種別(アクト/シーン/カット。スタイル技能の usesType と共通)。
 * - isConsumption(消費アイテム)はフェーズ6-2 で weapon の isthrow を置き換えて全種別に
 *   一般化したフラグ(2026-06-12 ユーザー確定)。true のアイテムは個数(quantity)を持つ。
 * - quantity は {value: 現在個数, max: 常備化個数}。消費で value を減らし、0 でそのセッション中は
 *   使用不可。セッション終了で value は max に戻る。常備化経験点は max(個数分)を基準とし、
 *   消費しても経験点は復活しない。
 * - "isPre-play" はハイフンを含むため JavaScript の識別子として使えない。
 *   defineSchema の戻り値オブジェクトでは文字列キーとして定義し、
 *   アクセス時は system["isPre-play"] 記法を使う。
 * - isCarrying はフェーズ6-0 で追加(携帯中かどうか)。
 */

import { SystemDataModel } from "../../abstract.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices, LEGACY_CATEGORY_MAP, hasClassification } from "../outfit-categories.mjs";
import { modeValueField, migrateUsesValueToSpent, computeItemEffectiveValues } from "../helpers.mjs";
import { migrateUsesMaxToString, computeUsesMaxTotal } from "../uses.mjs";

/**
 * 部位行の種別(フェーズ10・2026-06-26 確定)。公式の「部位」指定を自由入力 + フラグで表現する。
 * - none      : 「-」部位なし(非消費)
 * - bodyPart  : 身体部位。value にプリセット由来の部位名、slots に消費数
 * - option    : オプション。装備先ホストを hostMajor/hostMinor(+hostMinorExclude)/hostFeature/hostKey で指定
 * - reference : 解説参照。表示は常に「解説参照」。refSubKind の実部位で占有計算する
 * - other     : その他(自由記入)。value に自由記入文字列。占有計算対象外
 * 正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md「部位管理(フェーズ10)」
 */
export const PART_KINDS = Object.freeze({
  none:      "-",
  bodyPart:  "身体部位",
  option:    "オプション",
  reference: "解説参照",
  other:     "その他",
});

/** 解説参照(reference)の入れ子で選べる実部位種別(解説参照の入れ子は不可) */
export const PART_REFERENCE_SUB_KINDS = Object.freeze({
  none:     "-",
  bodyPart: "身体部位",
  option:   "オプション",
  other:    "その他",
});

/** part 全体の結合(2行以上のとき)。and=全部占有 / or=択一 */
export const PART_RELATIONS = Object.freeze({
  and: "かつ",
  or:  "または",
});

/** 式神装備(isShiki)のタイプ(フェーズ10-2)。式神＝しきそうび。 */
export const SHIKI_TYPES = Object.freeze({
  attack:      "攻撃",
  defense:     "防御",
  drive:       "操縦",
  independent: "独立",
});

/**
 * 分類(小分類キー)→武器区分フラグの既定(2026-07-17 ユーザー確定):
 * 白兵武器→白兵/射撃武器→射撃/搭載兵器→射撃/生体装備→白兵。該当なし=null(未指定=両 OFF・
 * 武器オプション/特殊弾等)。migrateData の初期敷設と、分類変更時の敷き直し(シート側)で使う。
 * @param {string} minorCategory 小分類キー
 * @returns {?{melee: boolean, ranged: boolean}}
 */
export function defaultWeaponKindForCategory(minorCategory) {
  switch (minorCategory) {
    case "melee":   return { melee: true,  ranged: false };
    case "ranged":  return { melee: false, ranged: true };
    case "mounted": return { melee: false, ranged: true };
    case "biotech": return { melee: true,  ranged: false };
    default:        return null;
  }
}

export class OutfitBaseTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      isPrepared:        new fields.BooleanField({ initial: true }),
      isOption:          new fields.BooleanField({ initial: false }),
      "isPre-play":      new fields.BooleanField({ initial: false }),
      isCheckAcquired:   new fields.BooleanField({ initial: false }),
      // ※旧 isCyber フラグは廃止(フェーズ16-1・2026-08-30 裁定「isCyberは副分類に完全に統合」)。
      //   旧データは migrateData で副分類サイバーウェアへ移行する。
      isCarrying:        new fields.BooleanField({ initial: true }),
      isConsumption:     new fields.BooleanField({ initial: false }),
      // 故障/破壊(2026-07-18 ユーザー確定): どちらも使用不可状態。故障は〈製作〉の修理用途で解除可、
      // 破壊は基本アクト終了まで直らない。どちらもアクト間に持ち越さない(消費アイテムと同じ・自動
      // リセットは将来フェーズ)。サービス大分類は免疫(prepareDerivedData で実効を false 固定)。
      // AE で付与/解除するため AE_FLAG_PARAMS に登録(実効読みは isOutfit* ヘルパー=helpers.mjs)。
      isMalfunction:     new fields.BooleanField({ initial: false }),
      isDestroyed:       new fields.BooleanField({ initial: false }),
      // スタイル技能由来マーク: 自動取得時に由来スタイル技能の識別キーを記録する(内部用・非表示)。
      // 識別キーのプレフィックス(区切り「_」まで)が同じ由来武器を既取得なら自動取得しない(重複防止)。
      fromStyleSkillKey: new fields.StringField({ initial: "" }),
      // 特性フラグ(フェーズ10-2)
      isMutantOrgan:  new fields.BooleanField({ initial: false }), // 変異器官(部位オプションのホスト照合「その他特徴」に使う)
      // 武器区分(2026-07-17 ユーザー確定): 白兵武器/射撃武器。**運用判別は分類でなくこのフラグ**
      // (搭載兵器・生体装備にも区分があるため)。独立ブール(両 ON=白兵/射撃兼用武器・両 OFF=
      // 武器オプション/特殊弾等)。既定は分類から敷く(白兵武器→白兵/射撃武器・搭載兵器→射撃/
      // 生体装備→白兵=migrateData と分類変更時の敷き直し)。射撃攻撃は射撃武器フラグの武器を
      // 準備していなければ判定不可・生身は白兵武器扱い。残弾セクションは射撃武器フラグ ON で表示。
      isMeleeWeapon:  new fields.BooleanField({ initial: false }),
      isRangedWeapon: new fields.BooleanField({ initial: false }),
      isShiki:        new fields.BooleanField({ initial: false }), // 式神装備(ON でタイプ欄を表示)
      shikiType:      new fields.StringField({ initial: "" }),     // 式神のタイプ(SHIKI_TYPES: attack/defense/drive/independent)
      isDerivedData:  new fields.BooleanField({ initial: false }), // 派生データ本体(常備化経験点を消費しない)
      hasDerivedData: new fields.BooleanField({ initial: false }), // 派生元(アクター取得時に派生データを自動生成する)
      derivedDataRefs: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.StringField({ initial: "" }),
        name: new fields.StringField({ initial: "" }),
      })),
      quantity: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
      majorCategory:     new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: getMajorCategoryChoices,
      }),
      minorCategory:     new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: getMinorCategoryChoices,
      }),
      // 副分類(フェーズ16-1・2026-08-30 裁定): 「複数の分類を持つアウトフィット」の追加分類。
      // 主分類は置き場所(シートのグループ表示・部位/スロット)の権威のまま、ルール挙動の照合は
      // outfitClassifications(主分類＋副分類の集合)を経由する。minor 空=大分類のみの横断
      // (旧 isCyber の移行先)。choices を付けないのは blank 行(追加直後の未選択)を許すため。
      additionalCategories: new fields.ArrayField(
        new fields.SchemaField({
          major: new fields.StringField({ initial: "" }),
          minor: new fields.StringField({ initial: "" }),
        })
      ),
      buy:               modeValueField(["none", "value", "reference"]),
      preserveExp:       modeValueField(["none", "value"]),
      hide:              modeValueField(["none", "value", "reference", "control"]),
      appearancePenalty: modeValueField(["none", "value"]),
      hack:              modeValueField(["none", "value"]),
      // 部位行(フェーズ10 で種別ベースへ拡張)。value/slots は維持。kind 既定 "other" は
      // 旧 {value,slots} データを「その他(自由記入)」へ移行する(§4.2: 文字列から種別を推測しない)。
      // partKey=部位キー(フェーズ12): 身体部位行の安定参照。占有照合はキー優先・ラベル(value)
      // 後方互換。表示はキーからの逆引きラベルを優先する。
      part: new fields.ArrayField(
        new fields.SchemaField({
          kind:             new fields.StringField({ initial: "other", choices: PART_KINDS }),
          value:            new fields.StringField({ initial: "" }),
          partKey:          new fields.StringField({ initial: "" }),
          slots:            new fields.NumberField({ initial: 1, min: 0, integer: true }),
          hostMajor:        new fields.StringField({ initial: "" }),
          hostMinor:        new fields.StringField({ initial: "" }),
          hostMinorExclude: new fields.BooleanField({ initial: false }),
          hostFeature:      new fields.StringField({ initial: "" }),
          // hostKey(2026-07-23 改名・旧 hostName): 名前指定ホストの**識別キー参照**。アウトフィット
          // 辞典(packs/outfits・works-outfits)から分類で絞ったプルダウンで選ぶ(自由記入を廃止)。
          // 表示は識別キーを逆引きした現在名(生キーは表示しない・identification.mjs)。空=種別指定のみ。
          hostKey:          new fields.StringField({ initial: "" }),
          refSubKind:       new fields.StringField({ initial: "none", choices: PART_REFERENCE_SUB_KINDS }),
        })
      ),
      // part 全体の結合(2行以上で意味を持つ)と、or 時の装備先(占有する行 index。表示には不影響)。
      // partOptional=任意は**部位全体**に効く(重複可・占有非カウント。行ごとではない)。
      partRelation: new fields.StringField({ initial: "and", choices: PART_RELATIONS }),
      partOrChoice: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      // AE の or 追加部位(system.part.<キー> 値=or)を選んだときの装備先(部位キー)。
      // 空文字=本来の部位(base part)を占有。効果が失効すれば自動的に base へ戻る(フェーズ12)。
      partAltChoice: new fields.StringField({ initial: "" }),
      partOptional: new fields.BooleanField({ initial: false }),
      // 部位「-」品など、準備していなくても使用可能な例外フラグ(2026-06-26)
      noPrepareRequired: new fields.BooleanField({ initial: false }),
      // 専用: スタイル/オーガニゼーション辞典への参照(複数可)。type="style"|"organization"・key=識別キー。
      // 自動化はしない(指定のみ)。模造技能・別組織のアウトフィット取得効果との兼ね合いで enforcement を持たせない。
      exclusive: new fields.ArrayField(new fields.SchemaField({
        type: new fields.StringField({ initial: "" }),
        key:  new fields.StringField({ initial: "" }),
      })),
      // spent = 消費済み回数（D&D 方式）。残り = max - spent
      // max は**数値も式も受ける**(2026-08-09「最大レベル回」)。実効値は派生 uses.maxTotal(uses.mjs)
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: false }),
        type:    new fields.StringField({ initial: "" }),
        max:     new fields.StringField({ initial: "" }),
        spent:   new fields.NumberField({ initial: 0 }),
      }),
      parentItemId:   new fields.StringField({ initial: "" }),
      parentSlotKind: new fields.StringField({ initial: "" }),
      combineGroupId: new fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行・uses.value→spent 移行・分類の日本語名→キー移行 */
  static migrateData(source) {
    // 分類: 旧データは日本語名を格納していたためコードキーへ移行(フェーズ9)
    if (source.majorCategory && LEGACY_CATEGORY_MAP[source.majorCategory]) {
      source.majorCategory = LEGACY_CATEGORY_MAP[source.majorCategory];
    }
    if (source.minorCategory && LEGACY_CATEGORY_MAP[source.minorCategory]) {
      source.minorCategory = LEGACY_CATEGORY_MAP[source.minorCategory];
    }
    // 旧 isCyber → 副分類サイバーウェアへ完全統合(フェーズ16-1・2026-08-30 裁定)。
    // 主分類がサイバーウェアなら主分類だけで足りるため移行不要(旧・シートの自動セット分)。
    // ※分類キー移行(上)の後に置く(旧日本語名データでも majorCategory がキーになってから比較する)
    if (source.isCyber === true && source.majorCategory !== "cyberware") {
      const rows = Array.isArray(source.additionalCategories) ? source.additionalCategories : [];
      if (!rows.some((r) => r?.major === "cyberware")) {
        source.additionalCategories = [...rows, { major: "cyberware", minor: "" }];
      }
    }
    delete source.isCyber;
    if (typeof source.appearancePenalty === "number") {
      const n = source.appearancePenalty;
      source.appearancePenalty = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    if (typeof source.preserveExp === "number") {
      const n = source.preserveExp;
      source.preserveExp = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    // 専用: 旧自由記述(string)→辞典参照配列へ。文字列は辞典キーに機械変換できないため空配列にする
    if (typeof source.exclusive === "string") source.exclusive = [];
    // 武器区分フラグの既定敷設(2026-07-17): フラグ未保存の既存データに分類の既定を敷く
    // (以後の運用判別・手動変更はフラグが正。分類変更時の敷き直しはシート側)
    if (source.isMeleeWeapon === undefined && source.isRangedWeapon === undefined) {
      const seed = defaultWeaponKindForCategory(source.minorCategory);
      if (seed) {
        source.isMeleeWeapon  = seed.melee;
        source.isRangedWeapon = seed.ranged;
      }
    }
    migrateUsesValueToSpent(source);
    // uses.max の NumberField → StringField(2026-08-09)。**spent 移行の後に**呼ぶ(前者が max を数値で読む)
    migrateUsesMaxToString(source);
    return super.migrateData(source);
  }

  /**
   * @override
   * アウトフィット実効値(AE 着地点 effectMod 込みの `.total` 系)を派生算出する(フェーズ9-3)。
   * 全アウトフィット type が OutfitBaseTemplate を合成するため、ここに置けば一括で適用される
   * (各 concrete モデルは prepareDerivedData を未定義のため本メソッドを継承する)。
   * attack / defence 等の concrete 固有パラメータも同一 system 上にあるため computeItemEffectiveValues が拾う。
   */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    computeItemEffectiveValues(this);
    // 使用回数の最大値(数値または式)の実効値。アクター上ではこの後アクター段で再評価される
    computeUsesMaxTotal(this);
    // AE による部位行の追加(フェーズ12・system.part.<部位キー> 値=and/or)。アクターの適用パス
    // (_applyEffectBuffs)がここへ {key, relation, slots, source} を積む。base の part は不変。
    this.partAdded = [];
    // オプション判定は部位行から派生する(フェーズ10。旧 isOption チェックは廃止し kind=option へ吸収)。
    // 部位に kind=option(または解説参照の実部位 option)があれば、このアウトフィットはオプション。
    const rows = Array.isArray(this.part) ? this.part : [];
    this.isOption = rows.some((r) =>
      r?.kind === "option" || (r?.kind === "reference" && r?.refSubKind === "option"));

    // 部位「-」(**種別ドロップダウンで「-」= kind:none を選択**)のアウトフィットは**準備できない**
    // (2026-07-09 ユーザー・ルール反映)。※身体部位を選んで値が未選択なだけの状態は「-」ではないので
    // 対象外(kind で判定する。formatPartDesignation は空 bodyPart も「-」にするため使わない)。
    // 準備フラグはオフに強制(派生)しトグル非表示。未準備でもデータ/効果を適用するため noPrepareRequired。
    this.isPartless = this.partOptional !== true && !rows.some(r => r?.kind && r.kind !== "none");
    if (this.isPartless) {
      this.noPrepareRequired = true;
      this.noPrepareRequiredTotal = true; // 実効フラグも同期(computeItemEffectiveValues 後の強制のため)
      this.isPrepared = false; // 準備できない=常にオフ
    }

    // 故障/破壊の免疫(2026-07-18): サービス大分類は故障も破壊もされない。AE で true にされても
    // 実効フラグを false へ落とす(照合の一本化は isOutfit* ヘルパーだが、実効値の一貫性のため
    // ここでも落とす)。照合は分類集合(主分類＋副分類=「両方の分類として扱う」・フェーズ16-1)。
    if (hasClassification(this, "service")) {
      this.isMalfunctionTotal = false;
      this.isDestroyedTotal = false;
    }

    // サービス/バックグラウンド(2026-07-18 ユーザー確定): 必ず準備・携帯され、未準備にできない。
    // 携帯/準備フラグを派生で true に固定(シート側でトグルを非表示)。isPartless の「準備できない=
    // オフ」より優先する(背景は常時適用の分類)。照合は分類集合(フェーズ16-1)。
    if (hasClassification(this, "background")) {
      this.isPrepared = true;
      this.isCarrying = true;
    }
  }
}
