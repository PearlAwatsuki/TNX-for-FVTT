/**
 * @fileoverview OrganizationDataModel - 組織 Item の DataModel
 *
 * 使用 template: base
 * 固有フィールド: なし
 *
 * 準拠データ: template.json > Item.organization
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";

export class OrganizationDataModel extends SystemDataModel.mixin(BaseTemplate) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
