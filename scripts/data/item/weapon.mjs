/**
 * @fileoverview WeaponDataModel - 武器 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: attack / guardValue / range / isLaser / isBiological /
 *               isFullAuto / FAValue / identificationKey
 *
 * 準拠データ: template.json > Item.weapon
 *
 * フェーズ6-2 の変更(2026-06-12 ユーザー確定):
 * - isthrow は削除。消費アイテムの概念は outfitBase の isConsumption / quantity に一般化。
 * - range(射程、略号「射」)は最低/最大の {min, max} 構造。同値なら単一表記、
 *   異なる場合は「近～超遠」のように範囲表記する。選択肢は WEAPON_RANGES の 5 種のみ
 *   (武器に「なし」「武器」はない)。
 * - guardValue は受け値(略号「受」)。パリィ失敗時にダメージから引かれる値。
 * - isFullAuto: フルオート射撃可能。FAValue が FAn の n(ダメージに加算)。
 *   フルオート射撃後は弾倉が空になりマイナーアクションで交換が必要(自動化はフェーズ7 以降)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { attackField } from "./helpers.mjs";

/**
 * 武器の射程の選択肢(2026-06-12 ユーザー確定)。
 * @type {Readonly<Record<string, string>>}
 */
export const WEAPON_RANGES = Object.freeze({
  close:     "至近",
  short:     "近",
  middle:    "中",
  long:      "遠",
  superLong: "超遠",
});

function weaponRangeField() {
  const fields = foundry.data.fields;
  return new fields.StringField({
    required: true,
    blank: false,
    initial: "close",
    choices: WEAPON_RANGES,
  });
}

export class WeaponDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      attack:      attackField(),
      guardValue:  new fields.NumberField({ initial: 0 }),
      range: new fields.SchemaField({
        min: weaponRangeField(),
        max: weaponRangeField(),
      }),
      isLaser:     new fields.BooleanField({ initial: false }),
      isBiological: new fields.BooleanField({ initial: false }),
      isFullAuto:  new fields.BooleanField({ initial: false }),
      FAValue:     new fields.NumberField({ initial: 0 }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }
}
