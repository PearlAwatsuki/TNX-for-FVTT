/**
 * @fileoverview MiracleDataModel - 神業 Item の DataModel
 *
 * 使用 template: base + usage
 * 固有フィールド: furigana / usageCondition / uses / asOther
 *
 * 殺し神業/防御神業/万能神業の区分(旧 isKill / isDefence / isAll)は形骸化したフラグとして撤去
 * (フェーズ17-1・2026-09-03 ユーザー裁定)。挙動の区分は用途側で表し、アイテムに区分を持たない。
 * 神業由来の印はアイテムの型(miracle)そのものから導く(miracle-logic.mjs の miracleOriginOf)。
 *
 * 注意(2026-07-18 神業の使用回数を汎用 uses へ一本化):
 * - 旧 `usageCount {value(母数), total(残り), mod(バフ)}` を廃し、他アイテムと同じ汎用
 *   `uses {isLimit, type, max, spent}` を持つ(残り = max − spent)。特例カウンター・特例消費 kind を廃止。
 * - **母数 = uses.max = 連動スタイルのレベルと同一**(ユーザー確定)。tnx.mjs の preUpdateItem/
 *   preDeleteItem フックがスタイルレベルに合わせて uses.max を維持する。「ファイト！」等の万能神業
 *   による母数増加は AE で uses.max を増やす(専用の加算欄は設けない)——**着地先は実効値
 *   `uses.maxTotal`**(2026-08-09・KI-038 で新設。それ以前は着地点が無く AE が効いていなかった)。
 * - uses.max は他アイテムと同型で**数値も式も受ける StringField**(2026-08-09)。ただし神業の母数は
 *   上記の連動フックが機械維持する領分のため、式を入れても次のレベル変更で数値に上書きされる。
 * - **使用済みフラグ(isUsed)は廃止(2026-09-05 ユーザー指摘)**。使用回数(残り = maxTotal − spent)と
 *   二重管理になっていた——神業は「アクト中にスタイルレベル回」使え(《ファイト！》で母数が増える)、
 *   その残量を数える uses が実体。「使用済み」は uses 一本化(2026-07-18)以前の名残で、リセットの
 *   トリガー以上の意味を持たなかった。リセットは消費済みの入力で行う。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { migrateUsesMaxToString, computeUsesMaxTotal } from "./uses.mjs";

export class MiracleDataModel extends SystemDataModel.mixin(BaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      furigana:       new fields.StringField({ initial: "" }),
      usageCondition: new fields.StringField({ initial: "" }),
      // 汎用の使用回数(残り = max − spent)。神業は常に母数を持つため isLimit 既定 true・母数(max)
      // 既定 "1"。母数はスタイルレベル連動(tnx.mjs)で維持される
      // max は他アイテムと同型で**数値も式も受ける**が(2026-08-09)、神業の母数は連動フックが
      // 機械維持するため、式を入れても次のレベル変更で数値に上書きされる(ユーザー了承済み)
      uses: new fields.SchemaField({
        isLimit: new fields.BooleanField({ initial: true }),
        type:    new fields.StringField({ initial: "" }),
        max:     new fields.StringField({ initial: "1" }),
        spent:   new fields.NumberField({ initial: 0 }),
      }),
      identificationKey: new fields.StringField({ initial: "" }),
      // 効果の参照(17-5・アイテム側の機能)。mode: ""=なし／choice=区分ごとに参照する神業を決めて1つ選んで
      // 固定する(《万能道具》=〈フォルム〉を選ぶときに効果を選ぶ・《半身》《神意》も同じ)／log=この
      // アクトで使われた神業から選ぶ(《突然変異》)。choices=選択肢(label=区分(〈フォルム〉の種類など・
      // 表示用)・uuid=参照先の神業=スタイル→神業と同じ参照)・selected=選んだ選択肢の uuid。
      // 使用時に取得技能から導かない(スタイル→神業→スタイル技能の順が逆転するため・ユーザー訂正 2026-09-04)。
      // 対応表はコードに持たずここに設定する
      asOther: new fields.SchemaField({
        mode:     new fields.StringField({ initial: "" }),
        selected: new fields.StringField({ initial: "" }),
        choices: new fields.ArrayField(new fields.SchemaField({
          // 区分の技能(〈フォルム〉〈属性〉等)と参照先の神業。**どちらもドロップで指定**する
          // (片方だけ文字列入力なのは非対称・2026-09-05 ユーザー指摘)。表示は uuid のライブ解決
          skillUuid: new fields.StringField({ initial: "" }),
          uuid:      new fields.StringField({ initial: "" }),
        })),
      }),
    };
  }

  /** @override — 旧 usageCount(value=母数/total=残り/mod=バフ) → 汎用 uses への移行(2026-07-18) */
  static migrateData(source) {
    if (source.usageCount && source.uses === undefined) {
      const value = Number(source.usageCount.value) || 0;   // 旧・母数
      const total = Number(source.usageCount.total) || 0;   // 旧・残り
      const mod   = Number(source.usageCount.mod) || 0;     // 旧・母数バフ
      const max = Math.max(1, value + mod);                 // 実効母数を保存(バフは以後 AE 化)
      source.uses = {
        isLimit: true, type: "",
        max,
        spent: Math.max(0, max - total),                    // 残り total を spent へ換算
      };
    }
    // uses.max の NumberField → StringField(2026-08-09)。**usageCount 移行の後に**呼ぶ
    migrateUsesMaxToString(source);
    // 効果の参照: 旧 refs(取得技能で導く) → choices(選んで固定・2026-09-04)、
    // 旧 label(区分の文字列) → skillUuid(技能のドロップ・2026-09-05)。いずれも未リリースの中間形
    if (source.asOther && Array.isArray(source.asOther.refs)) {
      source.asOther.choices = source.asOther.refs.map(r => ({ skillUuid: "", uuid: r?.uuid ?? "" }));
      delete source.asOther.refs;
      if (source.asOther.mode === "refs") source.asOther.mode = "choice";
    }
    if (source.asOther && Array.isArray(source.asOther.choices)) {
      source.asOther.choices = source.asOther.choices.map(c => ({
        skillUuid: c?.skillUuid ?? "", uuid: c?.uuid ?? "",
      }));
    }
    return super.migrateData(source);
  }

  /** @override — 使用回数の最大値(数値または式)の実効値 uses.maxTotal を派生算出する(2026-08-09)。 */
  prepareDerivedData() {
    super.prepareDerivedData?.();
    computeUsesMaxTotal(this);
  }
}
