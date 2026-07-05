/**
 * @fileoverview GeneralDataModel - 一般装備 Item の DataModel
 *
 * 使用 template: base + outfitBase + usage
 * 固有フィールド: identificationKey
 *
 * 準拠データ: template.json > Item.general
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";

export class GeneralDataModel extends SystemDataModel.mixin(BaseTemplate, OutfitBaseTemplate, UsageTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      identificationKey: new fields.StringField({ initial: "" }),
      // エキストラアクター参照(フェーズ11-6・Troops.md「エキストラの二重表現」)。
      // 小分類「エキストラ」(minorCategory="extra")のアウトフィットが「場に出るときの
      // エキストラアクター」を指す——アイテム側=所有・管理、アクター側=舞台上の挙動。
      // 共有アクター前提(システムは複製しない)。UI は小分類エキストラのときのみ表示。
      // name は参照先削除時の表示フォールバックのみ(ライブ解決原則)
      extraActorRef: new fields.SchemaField({
        uuid: new fields.StringField({ initial: "" }),
        name: new fields.StringField({ initial: "" }),
      }),
    };
  }
}
