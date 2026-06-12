/**
 * @fileoverview LifePathDataModel - ライフパス Item の DataModel
 *
 * 使用 template: base
 * 固有フィールド: lifePathType / skillName / identificationKey
 *
 * 準拠データ: template.json > Item.lifePath
 *
 * 注意:
 * - lifePathType は実質的に enum(運命 / 出自 / 経験 等)だが、template.json の
 *   初期値が "" のため StringField のままとする。選択肢付き型へのリファクタは
 *   将来サブフェーズで検討する。
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
      lifePathType: new fields.StringField({ initial: "" }),
      skillName:    new fields.StringField({ initial: "" }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
