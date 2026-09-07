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
    // Foundry の escapeHTML と同じ 5 文字を実体参照へ(表示テストで実物と同じ出力にするため)
    escapeHTML: (s) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#x27;"),
  },
  // ダイアログのモジュールは評価時に foundry.applications.api を分割代入するため、
  // 形だけ用意する(振る舞いのテストはしない=純粋な組み立て関数だけを対象にする)
  applications: {
    api: { DialogV2: class MockDialogV2 { static async wait() { return null; } } },
  },
};
