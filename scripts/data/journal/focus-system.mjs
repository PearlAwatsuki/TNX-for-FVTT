/**
 * @fileoverview FocusSystemDataModel - FS判定シート(JournalEntryPage type `focusSystem`)
 *
 * FS判定(フォーカスシステム)の**設定の置き場と閲覧用**。正本は
 * llm-wiki の Focus_System_Mechanics.md / Focus_System.md。
 *
 * **進行状態(進行値・カット数)は持たない**(2026-07-20 ユーザー明示)。実行中 FS の正本は
 * ワールド設定 `activeFocusSystems` で、起動時にこのページの内容をスナップショットとして
 * 取り込む(以後ページを編集しても実行中の FS は変わらない)。
 *
 * 1 ドキュメント＝1 ページ＝1 FS判定。並行して走る FS は正本側(配列)で表す。
 * FS 名は DataModel に持たず、ページ名を使う。
 */

import { SystemDataModel } from "../abstract.mjs";

const fields = foundry.data.fields;

/**
 * 進行修正(ルール4・2026-07-20 再設計)。
 * source=none(固定値) / outfit(アウトフィット) / actor(キャラクター)。
 * param は参照するパラメータ(グループ形式プルダウンで選ぶ)で、解決値が式の `@param` に入る。
 * 係数は式で表す(`@param * 2` / `floor(@param / 2)`)。
 * source=outfit の実解決(判定者の準備済みアイテムから探す)はフェーズ13。
 */
function progressModField() {
  return new fields.SchemaField({
    source:  new fields.StringField({ initial: "none" }),
    param:   new fields.StringField({ initial: "" }),
    formula: new fields.StringField({ initial: "" }),
  });
}

/**
 * 判定行(進行判定)。threshold=切り替えの閾値(ルール8)。
 * 有効行は「閾値 ≦ 現在進行値 のうち閾値が最大の1行」(ルール12)。
 * 支援判定の技能はブロック側に1つ持つため、行に役割欄は持たない。
 */
function rowField() {
  return new fields.SchemaField({
    id:          new fields.StringField({ initial: "" }),
    threshold:   new fields.NumberField({ initial: 0, integer: true }),
    skillKey:    new fields.StringField({ initial: "" }),
    targetValue: new fields.NumberField({ initial: 0, integer: true }),
    progressMod: progressModField(),
    note:        new fields.StringField({ initial: "" }),
  });
}

export class FocusSystemDataModel extends SystemDataModel {
  /** @override */
  static defineSchema() {
    return {
      // 制限(参加条件)。表示のみで強制しない(ルール7)
      restriction: new fields.StringField({ initial: "" }),
      // 敗北条件(ルール2/16)。type=cut のときだけ cutLimit が有効=カットゲージと
      // 「残りカット数」を表示する(「残りカット数」はカット条件限定の表現)
      defeatCondition: new fields.SchemaField({
        type:     new fields.StringField({ initial: "cut" }),
        text:     new fields.StringField({ initial: "" }),
        cutLimit: new fields.NumberField({ initial: 0, integer: true }),
      }),
      // 敗北時の処理(ダメージを受ける等・ルール17)。表示のみ=適用は RL 任意付与で行う
      defeatEffect:    new fields.StringField({ initial: "" }),
      // 目標進行値(ルール1)=進行値ゲージの最大値
      targetProgress:  new fields.NumberField({ initial: 0, integer: true }),
      // 支援判定の指定技能(ルール11)。目標値は有効行と同じ(ルール5)なので持たない
      supportSkillKey: new fields.StringField({ initial: "" }),
      rows:            new fields.ArrayField(rowField(), { initial: [] }),
      memo:            new fields.StringField({ initial: "" }),
    };
  }
}
