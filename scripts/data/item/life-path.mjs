/**
 * @fileoverview LifePathDataModel - ライフパス Item の DataModel
 *
 * 使用 template: base
 * 固有フィールド: lifePathType / skillName / identificationKey
 *
 * 準拠データ: template.json > Item.lifePath
 *
 * 注意:
 * - lifePathType はライフパスの区分。出自(origin)/ 経験(experience)/ 邂逅(encounter)
 *   の 3 種のみ(フェーズ6-0 でユーザー確定。旧コメントの「運命」は誤りだった)。
 *   キャストシート詳細タブのスロットキー(system.lifePath.origin 等)と対応し、
 *   ドロップ時のスロット・型検証に使う(フェーズ6-5)。
 * - Cast Actor の system.lifePath(origin / experience / encounter を持つ
 *   SchemaField)とは別物。こちらは Actor 側のサブフィールドであり、本 DataModel
 *   とは無関係。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";

export class LifePathDataModel extends SystemDataModel.mixin(BaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      lifePathType: new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: {
          origin:     "出自",
          experience: "経験",
          encounter:  "邂逅",
        },
      }),
      skillName:    new fields.StringField({ initial: "" }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
