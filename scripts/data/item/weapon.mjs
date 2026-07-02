/**
 * @fileoverview WeaponDataModel - 武器 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: attack / guardValue / range / attackArea / isLaser /
 *               isFullAuto / FAValue / identificationKey
 *
 * 準拠データ: template.json > Item.weapon
 *
 * フェーズ6-2 の変更(2026-06-12 ユーザー確定):
 * - isthrow は削除。消費アイテムの概念は outfitBase の isConsumption / quantity に一般化。
 * - attackArea(攻撃範囲)を追加。設定時、判定アイテムで武器攻撃の用途を設定する際に
 *   範囲を上書きできる(none = 上書きしない。連携はフェーズ7 以降)。
 * - range(射程、略号「射」)は最低/最大の {min, max} 構造。
 *   最低射程が「なし」のとき最長射程は非表示(単点でも範囲でもない「射程なし」)。
 *   最低射程が値のとき最長射程が「なし」なら単点表記、値があれば「近～超遠」形式。
 *   最長射程の選択肢から「至近」を除く(最低射程でのみ意味を持つため)。
 * - guardValue は受け値(略号「受」)。パリィ失敗時にダメージから引かれる値。
 *   「なし / 数値」の {mode,value} 構造。
 * - isFullAuto: フルオート射撃可能。FAValue が FAn の n(ダメージに加算)。
 *   フルオート射撃後は弾倉が空になりマイナーアクションで交換が必要(自動化はフェーズ7 以降)。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { attackField, modeValueField } from "./helpers.mjs";

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

/**
 * 最低射程の選択肢(WEAPON_RANGES に「なし」を加えたもの)。
 * @type {Readonly<Record<string, string>>}
 */
export const WEAPON_RANGE_MIN_OPTIONS = Object.freeze({
  none:      "なし",
  close:     "至近",
  short:     "近",
  middle:    "中",
  long:      "遠",
  superLong: "超遠",
});

/**
 * 最長射程の選択肢(「なし」+ 近/中/遠/超遠。至近を除く)。
 * @type {Readonly<Record<string, string>>}
 */
export const WEAPON_RANGE_MAX_OPTIONS = Object.freeze({
  none:      "なし",
  short:     "近",
  middle:    "中",
  long:      "遠",
  superLong: "超遠",
});

/**
 * 攻撃範囲の選択肢(2026-06-12 ユーザー確定)。
 * none(-)は「判定の用途で範囲を上書きしない」を表す。
 * @type {Readonly<Record<string, string>>}
 */
export const WEAPON_ATTACK_AREAS = Object.freeze({
  none:        "-",
  area:        "範囲",
  areaSelect:  "範囲（選択）",
  scene:       "シーン",
  sceneSelect: "シーン（選択）",
});

export class WeaponDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      attack:     attackField(),
      guardValue: modeValueField(["none", "value"]),
      range: new fields.SchemaField({
        min: new fields.StringField({
          required: true, blank: false, initial: "none",
          choices: WEAPON_RANGE_MIN_OPTIONS,
        }),
        max: new fields.StringField({
          required: true, blank: false, initial: "none",
          choices: WEAPON_RANGE_MAX_OPTIONS,
        }),
      }),
      attackArea: new fields.StringField({
        required: true,
        blank: false,
        initial: "none",
        choices: WEAPON_ATTACK_AREAS,
      }),
      isLaser:     new fields.BooleanField({ initial: false }),
      isFullAuto:  new fields.BooleanField({ initial: false }),
      FAValue:     new fields.NumberField({ initial: 0 }),
      // 生身変更装備(フェーズ10-6・2026-07-02 裁定): 生身(武器)のデータ——攻撃力と受け値——を
      // 書き換える装備。書き換え結果は「生身」として扱われ、生身は単一のため複数準備でも
      // 〈二刀流〉等で相互に合算参照できない(正本 Outfits.md「生身の変更」)。
      // 戦闘タブの書き換え元候補(攻撃用/パリー用で別選択可)の抽出に使う。
      isFleshChange: new fields.BooleanField({ initial: false }),
      identificationKey: new fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧フォーマットからの移行 */
  static migrateData(source) {
    if (typeof source.guardValue === "number") {
      const n = source.guardValue;
      source.guardValue = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
    }
    if (source.range) {
      // 旧: min/max が同値 → 最長を「なし」に変換
      if (source.range.min === source.range.max && source.range.min !== undefined) {
        source.range.max = "none";
      }
      // 旧: max が "close"(新スキーマに存在しない) → "none" に変換
      if (source.range.max === "close") source.range.max = "none";
    }
    return super.migrateData(source);
  }
}
