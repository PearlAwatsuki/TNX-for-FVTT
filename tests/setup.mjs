/**
 * @fileoverview Foundry VTT グローバルのモック
 *
 * Foundry 環境なしでテストするための最小実装。
 * vitest.config.mjs の setupFiles に登録してあるため、**全テストで自動的に適用される**
 * (2026-09-07。従来は各テストが手で import しており、書き忘れると落ちていた)。
 *
 * モックのクラスを名指しで使う場合だけ import する:
 *   import { MockSchemaField, MockNumberField } from "../../setup.mjs";
 *
 * ここは**最小限に保つ**。必要になったテストが出た時点で、そのテストが要るぶんだけ足す
 * (使う当てのないモックを先回りで作らない)。
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
export class MockArrayField {
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
  }
}
export class MockHTMLField {
  constructor(options = {}) { this.options = options; }
}
export class MockObjectField {
  constructor(options = {}) { this.options = options; }
}
export class MockTypeDataModel {
  static defineSchema() { return {}; }
  static migrateData(source) { return source; }
}

let _idCounter = 0;

globalThis.foundry = {
  abstract: {
    TypeDataModel: MockTypeDataModel,
  },
  data: {
    fields: {
      NumberField:  MockNumberField,
      StringField:  MockStringField,
      BooleanField: MockBooleanField,
      HTMLField:    MockHTMLField,
      SchemaField:  MockSchemaField,
      ArrayField:   MockArrayField,
      ObjectField:  MockObjectField,
    },
  },
  utils: {
    randomID: () => `mock-id-${++_idCounter}`,
  },
};
