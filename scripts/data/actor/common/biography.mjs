/**
 * @fileoverview BiographyTemplate - Actor の基本プロフィール情報を定義する template クラス
 *
 * 使用 Actor type: cast / guest / extra
 * SystemDataModel.mixin() の引数として各 Actor DataModel に合成して使う。
 *
 * 準拠データ: template.json > Actor.templates.biography
 */

import { SystemDataModel } from "../../abstract.mjs";

export class BiographyTemplate extends SystemDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      charaname_ruby: new fields.StringField({ initial: "" }),
      handle:         new fields.StringField({ initial: "" }),
      handle_ruby:    new fields.StringField({ initial: "" }),
      post: new fields.SchemaField({
        name: new fields.StringField({ initial: "無所属" }),
        id:   new fields.StringField({ initial: "" }),
      }),
      citizenRank: new fields.StringField({ initial: "B-" }),
      age:         new fields.StringField({ initial: "" }),
      gender:      new fields.StringField({ initial: "" }),
      birthday:    new fields.StringField({ initial: "" }),
      height:      new fields.StringField({ initial: "" }),
      weight:      new fields.StringField({ initial: "" }),
      eyes:        new fields.StringField({ initial: "" }),
      hair:        new fields.StringField({ initial: "" }),
      skin:        new fields.StringField({ initial: "" }),
      description: new fields.StringField({ initial: "" }),
    };
  }
}
