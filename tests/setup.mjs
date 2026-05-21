/**
 * @fileoverview Foundry VTT グローバルのモック
 *
 * Foundry 環境なしでテストするための最小実装。
 * 各テストファイルからこのファイルを静的インポートすると、インポート評価時に
 * globalThis.foundry がセットされる。vitest.config.mjs の setupFiles 変更は不要。
 *
 * 使い方:
 *   import { MockSchemaField, MockNumberField } from "../../setup.mjs";
 *   // 上記 import により globalThis.foundry が設定済みになる
 *   const { MyClass } = await import("../scripts/data/my-class.mjs");
 */

export class MockNumberField {
  constructor(options = {}) { this.options = options; }
}
export class MockStringField {
  constructor(options = {}) { this.options = options; }
}
export class MockBooleanField {
  constructor(options = {}) { this.options = options; }
}
export class MockSchemaField {
  constructor(fields) { this.fields = fields; }
}
export class MockTypeDataModel {
  static defineSchema() { return {}; }
}

globalThis.foundry = {
  abstract: {
    TypeDataModel: MockTypeDataModel,
  },
  data: {
    fields: {
      NumberField:  MockNumberField,
      StringField:  MockStringField,
      BooleanField: MockBooleanField,
      SchemaField:  MockSchemaField,
    },
  },
};
