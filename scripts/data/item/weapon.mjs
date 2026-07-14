/**
 * @fileoverview WeaponDataModel - 武器 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: attack / guardValue / range / attackArea / isLaser /
 *               isFullAuto / FAValue / ammo / identificationKey
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
 * - isFullAuto: フルオート射撃可能。FAValue が FAn の n(ダメージに加算)。FA は自動加算せず
 *   ダメージ算出ダイアログで武器ごとに選択する(2026-07-09 ユーザー確定)。
 * - ammo: 残弾(射撃武器・搭載兵器のみ)。mode = none(概念なし)/value(装弾数=数字。FA以外用)/
 *   arbitrary(残弾の有無だけ=任意。FA 武器用)。current = 現在の残弾(実行時。null=満タン(数字)/
 *   あり(任意)・0=空)。**数字は通常(非FA)射撃で1減り、任意は FA 射撃で空になる**
 *   (2026-07-10 ユーザー確定)。空(0)の武器はリロード(マイナーアクション)で満タンに戻る。
 *   ※自動給弾の FA 武器は「isFullAuto=true かつ ammo.mode=none(-)」で表現する
 *   (残弾を追跡しなければ FA しても空にならない。専用フラグは不要=2026-07-10 ユーザー確定)。
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
      // スタン可能(2026-07-15 ユーザー確定): この武器でスタン攻撃を宣言できる(物理攻撃の能力ゲート)。
      // 攻撃に使う武器のいずれかが true なら、判定ダイアログに「スタン攻撃として実行」チェックが出る。
      // 用途の canStun(スタイル技能の効果によるスタン付与)・生身(武器なし)も可否に含める。
      canStun:     new fields.BooleanField({ initial: false }),
      FAValue:     new fields.NumberField({ initial: 0 }),
      // 残弾(射撃武器・搭載兵器のみ UI 表示。2026-07-09〜10 ユーザー確定):
      //   mode    = none(概念なし)/value(装弾数=数字。FA以外用)/arbitrary(有無だけ=任意。FA武器用)
      //   value   = 装弾数(mode=value の満タン時の数=最大値。シートで設定)
      //   current = 現在の残弾(実行時。null=満タン(数字)/あり(任意)・0=空)。
      //             数字は通常(非FA)射撃で1減り、任意は FA 射撃で空に。リロードで満タン(null)へ。
      ammo: new fields.SchemaField({
        mode:    new fields.StringField({ required: true, blank: false, initial: "none",
          choices: { none: "-", value: "数字", arbitrary: "任意" } }),
        value:   new fields.NumberField({ initial: 0, min: 0, integer: true }),
        current: new fields.NumberField({ initial: null, nullable: true, min: 0, integer: true }),
      }),
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
    // 残弾: 旧 empty(真偽) → current(数値・null=満タン/0=空)へ移行(2026-07-10)
    if (source.ammo && source.ammo.current === undefined && source.ammo.empty !== undefined) {
      source.ammo.current = source.ammo.empty ? 0 : null;
    }
    return super.migrateData(source);
  }
}
