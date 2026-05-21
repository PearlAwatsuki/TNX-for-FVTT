/**
 * @fileoverview SystemDataModel と Mixin パターンの基底実装
 *
 * 目的:
 *   foundry.abstract.TypeDataModel を継承し、TNX の全 DataModel が共通して
 *   利用する Mixin 合成機能を提供する。
 *
 * Mixin の使い方:
 * @example
 * // template クラス(複数の Actor/Item type で共有するフィールドを定義)
 * class BiographyTemplate extends SystemDataModel {
 *   static defineSchema() {
 *     const fields = foundry.data.fields;
 *     return { background: new fields.StringField({ initial: "" }) };
 *   }
 * }
 *
 * // 複数の template を合成して concrete DataModel を定義する
 * class CastDataModel extends SystemDataModel.mixin(
 *   BiographyTemplate, AttributesTemplate, ActorBaseTemplate
 * ) {
 *   static defineSchema() {
 *     const fields = foundry.data.fields;
 *     return {
 *       ...super.defineSchema(),  // mixin で合成されたフィールドを継承
 *       castField: new fields.NumberField({ initial: 0 }),
 *     };
 *   }
 * }
 *
 * 設計方針: docs/DESIGN_REVIEW.md B-0「論点3: 共通 template の継承戦略」参照
 */

export class SystemDataModel extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {};
  }

  /**
   * 複数の template クラスのフィールドとメソッドを合成した新クラスを返す。
   * 同名フィールド・同名メソッドがある場合、後に指定した template が優先される。
   *
   * @param {...typeof SystemDataModel} templates - 合成する template クラスの列
   * @returns {typeof SystemDataModel} フィールドとメソッドを合成した新しいクラス
   */
  static mixin(...templates) {
    const MixedClass = class extends this {
      /** @override */
      static defineSchema() {
        const schema = super.defineSchema();
        for (const template of templates) {
          Object.assign(schema, template.defineSchema());
        }
        return schema;
      }
    };

    // 各 template のプロトタイプメソッドを引き継ぐ(後の template が優先)
    for (const template of templates) {
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(template.prototype)
      )) {
        if (key === "constructor") continue;
        Object.defineProperty(MixedClass.prototype, key, descriptor);
      }
    }

    return MixedClass;
  }
}
