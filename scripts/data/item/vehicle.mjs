/**
 * @fileoverview VehicleDataModel - 乗り物 Item の DataModel
 *
 * 使用 template: base + outfitBase + extensible + usage
 * 固有フィールド: attack / defence(mode/S/P/I) / speedFactor / passenger / controlMod / identificationKey
 *
 * 準拠データ: template.json > Item.vehicle
 *
 * フェーズ6-4 の変更(2026-06-13 ユーザー確定):
 * - attack(攻撃力)/ defence(防御値)を追加。概要表記順は 購/隠/攻/SF/防/制/乗員/ス/電制/部位。
 * - speedFactor(SF、移動力): 数字分の段階移動ができる。
 * - passenger(乗員): 操縦者を含む乗車可能人数。
 * - speedFactor / passenger / controlMod はすべて「なし/数値」の {mode,value} 構造。
 */

import { SystemDataModel } from "../abstract.mjs";
import { BaseTemplate } from "./common/base.mjs";
import { OutfitBaseTemplate } from "./common/outfit-base.mjs";
import { UsageTemplate } from "./common/usage.mjs";
import { ExtensibleTemplate } from "./common/extensible.mjs";
import { attackField, defenceField, modeValueField } from "./helpers.mjs";

export class VehicleDataModel extends SystemDataModel.mixin(
  BaseTemplate, OutfitBaseTemplate, ExtensibleTemplate, UsageTemplate
) {
  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      attack:      attackField(),
      defence:     defenceField(),
      speedFactor: modeValueField(["none", "value"]),
      passenger:   modeValueField(["none", "value"]),
      controlMod:  modeValueField(["none", "value"]),
      identificationKey: new foundry.data.fields.StringField({ initial: "" }),
    };
  }

  /** @override — 旧 NumberField 形式から {mode,value} へ移行 */
  static migrateData(source) {
    for (const key of ["speedFactor", "passenger", "controlMod"]) {
      if (typeof source[key] === "number") {
        const n = source[key];
        source[key] = n === 0 ? { mode: "none", value: 0 } : { mode: "value", value: n };
      }
    }
    if (source.defence && source.defence.mode === undefined) {
      const hasVal = (source.defence.S_defence || 0) !== 0
                  || (source.defence.P_defence || 0) !== 0
                  || (source.defence.I_defence || 0) !== 0;
      source.defence.mode = hasVal ? "value" : "none";
    }
    return super.migrateData(source);
  }
}
