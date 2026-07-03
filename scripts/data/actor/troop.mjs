/**
 * @fileoverview TroopDataModel - トループ Actor の DataModel
 *
 * フェーズ11-4 で CharacterBaseDataModel 継承に再構成(正本 Troops.md・2026-07-03 言語化):
 * - トループの構成はスタイル(1つ)・能力値・技能・アウトフィット・状態で、判定はキャストと同じ
 *   → 派生値パイプライン(実効値・AE 適用・アウトフィット集計・CS/AR)を共通基底から得る。
 * - biography も持つ(2026-07-03 ユーザー意向)。旧 memo は biography.description へ統合し廃止
 *   (migrateData で既存データを移行)。
 * - 基底由来のフィールドのうち報酬点・部位(partSlots)・生身(baseAttack 等)・isGhost・
 *   handMaxSizeMod はトループのルール上は未使用(シートも非表示)。スキーマ上は残るが死蔵で実害なし
 *   (GM 手札上限の合算は guest のみ・部位占有 UI は features.parts=false)。
 *
 * 固有フィールド:
 * - heads {value, max}: 人数。HP のように機能し、ダメージ分減少する(チャート不参照)。
 *   トークンリソースバーに割り当てる。
 * - isEnigmaMode: エニグマモード(2026-07-03 確定)。ON のとき heads の意味・ラベルが
 *   「人数」から「エニグマポイント」に切り替わる(挙動は同じ＝達成値分の付与・ダメージ分減少)。
 *   分身は troop として作成し、AR=1・CS/CSカレント=0 のデータ入力で表現(専用機構なし)。
 */

import { CharacterBaseDataModel } from "./common/character-base.mjs";

export class TroopDataModel extends CharacterBaseDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      heads: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
      isEnigmaMode: new fields.BooleanField({ initial: false }),
    };
  }

  /**
   * @override
   * 旧 memo(フェーズ6-0〜11-4)を biography.description へ移行する。
   * description が空のときだけ写す(既存の説明を上書きしない)。
   */
  static migrateData(source) {
    if (source.memo && !source.description) {
      source.description = source.memo;
    }
    delete source.memo;
    return super.migrateData(source);
  }
}
