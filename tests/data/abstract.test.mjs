import { describe, it, expect } from "vitest";

// foundry グローバルのモック
// Foundry 環境外でテストするための最小実装。
// TypeDataModel: defineSchema() が {} を返す抽象基底クラスのスタブ。
class MockNumberField {
  constructor(options = {}) { this.options = options; }
}
class MockStringField {
  constructor(options = {}) { this.options = options; }
}
class MockSchemaField {
  constructor(fields) { this.fields = fields; }
}

globalThis.foundry = {
  abstract: {
    TypeDataModel: class {
      static defineSchema() { return {}; }
      static migrateData(source) { return source; }
    },
  },
  data: {
    fields: {
      NumberField: MockNumberField,
      StringField: MockStringField,
      SchemaField: MockSchemaField,
    },
  },
};

const { SystemDataModel } = await import("../../scripts/data/abstract.mjs");

describe("SystemDataModel.mixin()", () => {
  class TemplateA extends SystemDataModel {
    static defineSchema() {
      return { fieldA: new MockStringField({ initial: "" }) };
    }
  }

  class TemplateB extends SystemDataModel {
    static defineSchema() {
      return { fieldB: new MockNumberField({ initial: 0 }) };
    }

    greetB() {
      return "hello from TemplateB";
    }
  }

  it("mixin(A) → A のフィールドを持つクラスが返る", () => {
    const Mixed = SystemDataModel.mixin(TemplateA);
    const schema = Mixed.defineSchema();
    expect(schema).toHaveProperty("fieldA");
  });

  it("mixin(A) → B のフィールドは持たない", () => {
    const Mixed = SystemDataModel.mixin(TemplateA);
    const schema = Mixed.defineSchema();
    expect(schema).not.toHaveProperty("fieldB");
  });

  it("mixin(A, B) → A と B のフィールドを両方持つクラスが返る", () => {
    const Mixed = SystemDataModel.mixin(TemplateA, TemplateB);
    const schema = Mixed.defineSchema();
    expect(schema).toHaveProperty("fieldA");
    expect(schema).toHaveProperty("fieldB");
  });

  it("mixin クラスを extends して super.defineSchema() を呼ぶと mixin フィールドが保持される", () => {
    class ConcreteModel extends SystemDataModel.mixin(TemplateA) {
      static defineSchema() {
        return {
          ...super.defineSchema(),
          ownField: new MockNumberField({ initial: 0 }),
        };
      }
    }
    const schema = ConcreteModel.defineSchema();
    expect(schema).toHaveProperty("fieldA");
    expect(schema).toHaveProperty("ownField");
  });

  it("mixin(A, B) → B のインスタンスメソッドがプロトタイプに引き継がれる", () => {
    const Mixed = SystemDataModel.mixin(TemplateA, TemplateB);
    expect(typeof Mixed.prototype.greetB).toBe("function");
  });

  it("mixin → template の静的 migrateData が合成され順に実行される", () => {
    class MigA extends SystemDataModel {
      static migrateData(s) { s.a = true; return s; }
    }
    class MigB extends SystemDataModel {
      static migrateData(s) { s.order = [...(s.order ?? []), "B"]; return s; }
    }
    class MigC extends SystemDataModel {
      static migrateData(s) { s.order = [...(s.order ?? []), "C"]; return s; }
    }
    const Mixed = SystemDataModel.mixin(MigB, MigC);
    const out = Mixed.migrateData({});
    expect(out.order).toEqual(["B", "C"]); // template の順で実行

    // concrete が migrateData を持つ場合も super 経由で template が走る
    class Concrete extends SystemDataModel.mixin(MigA) {
      static migrateData(s) { s.concrete = true; return super.migrateData(s); }
    }
    const out2 = Concrete.migrateData({});
    expect(out2.concrete).toBe(true);
    expect(out2.a).toBe(true);
  });
});
