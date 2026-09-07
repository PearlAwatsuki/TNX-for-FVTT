/**
 * @fileoverview 型定義健全性テスト(恒久テスト)
 *
 * B-9 完了後: template.json は廃止。type 定義の権威は system.json の documentTypes。
 *
 * 検証1: template.json の廃止確認 — ファイルが存在しないこと
 * 検証2: system.json の JSON 妥当性 — 末尾カンマ等の構文崩れを検出
 * 検証3: documentTypes に全 type(Actor 4 / Item 17 / Card 3)が揃っていること
 * 検証4: DataModel ファイルと documentTypes.Item の整合 — 過不足がないこと
 *
 * このテストは Foundry ランタイムに依存しない(Node.js 単体で完結)。
 * CONFIG.Item.dataModels 等のグローバルは参照しない。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// system.json の生テキスト(module 評価時に読み込む)
const systemRaw = readFileSync(join(projectRoot, "system.json"), "utf-8");

/**
 * kebab-case を camelCase に変換する。
 * ファイル名(kebab-case)から Item type 名(camelCase)を生成するために使用する。
 * 例: "housing-area" → "housingArea" / "life-path" → "lifePath"
 * @param {string} str
 * @returns {string}
 */
function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * scripts/data/item/ 配下のファイルから DataModel 化済み Item type 名を動的に導出する。
 * - common/ ディレクトリは共通テンプレートのため除外
 * - helpers.mjs / outfit-categories.mjs / part-helpers.mjs は DataModel でないファイルのため除外
 * - .mjs ファイルのみを対象とし、ファイル名を camelCase type 名に変換する
 * @returns {string[]}
 */
const NON_DATAMODEL_FILES = ["helpers.mjs", "outfit-categories.mjs", "part-helpers.mjs", "uses.mjs", "modification-params.mjs"];

function getDataModeledItemTypes() {
  const itemDir = join(projectRoot, "scripts", "data", "item");
  return readdirSync(itemDir, { withFileTypes: true })
    .filter(entry =>
      entry.isFile() &&
      extname(entry.name) === ".mjs" &&
      !NON_DATAMODEL_FILES.includes(entry.name)
    )
    .map(entry => kebabToCamel(basename(entry.name, ".mjs")));
}

describe("型定義健全性テスト", () => {

  // ============================================================
  // ファイル名 → type 名変換の動作確認
  // ============================================================

  describe("kebabToCamel() 変換関数の動作", () => {
    it("ハイフンなしの名前はそのまま返す", () => {
      expect(kebabToCamel("organization")).toBe("organization");
      expect(kebabToCamel("armor")).toBe("armor");
    });

    it("ハイフン 1 つを camelCase に変換する", () => {
      expect(kebabToCamel("housing-area")).toBe("housingArea");
    });

    it("ハイフン 2 つを camelCase に変換する", () => {
      expect(kebabToCamel("life-path")).toBe("lifePath");
    });
  });

  // ============================================================
  // 検証1: template.json の廃止確認
  // ============================================================

  describe("検証1: template.json の廃止確認", () => {
    it("template.json が存在しない(B-9 で廃止済み)", () => {
      expect(existsSync(join(projectRoot, "template.json"))).toBe(false);
    });
  });

  // ============================================================
  // 検証2: system.json の JSON 妥当性
  // ============================================================

  describe("検証2: system.json の JSON 妥当性", () => {
    it("system.json が有効な JSON として読み込める(末尾カンマ等の構文崩れがない)", () => {
      expect(() => JSON.parse(systemRaw)).not.toThrow();
    });

    it("documentTypes に Actor / Item / Card セクションが存在する", () => {
      const json = JSON.parse(systemRaw);
      expect(json).toHaveProperty("documentTypes");
      expect(json.documentTypes).toHaveProperty("Actor");
      expect(json.documentTypes).toHaveProperty("Item");
      expect(json.documentTypes).toHaveProperty("Card");
    });
  });

  // ============================================================
  // 検証3: documentTypes に全 type が揃っている(内訳は各 it が持つ)
  // ============================================================

  describe("検証3: documentTypes に全 type が揃っている", () => {
    const docTypes = JSON.parse(systemRaw).documentTypes;

    it("Actor が全 4 type を持つ", () => {
      const expected = ["cast", "guest", "troop", "extra"];
      for (const t of expected) {
        expect(docTypes.Actor).toHaveProperty(t);
      }
    });

    it("Item が全 17 type を持つ", () => {
      const expected = [
        "style", "miracle", "generalSkill", "styleSkill",
        "weapon", "armor", "ianus", "cyborg", "tron", "tap", "vehicle",
        "residence", "housingArea", "combiner", "general", "organization", "lifePath",
      ];
      for (const t of expected) {
        expect(docTypes.Item).toHaveProperty(t);
      }
    });

    it("Card が全 3 type を持つ", () => {
      const expected = ["playingCards", "neuroCards", "other"];
      for (const t of expected) {
        expect(docTypes.Card).toHaveProperty(t);
      }
    });
  });

  // ============================================================
  // 検証4: DataModel ファイルと documentTypes.Item の整合
  // ============================================================

  describe("検証4: scripts/data/item/ の DataModel ファイルが documentTypes.Item と整合する", () => {
    it("scripts/data/item/ から DataModel ファイルが 1 件以上検出される", () => {
      const types = getDataModeledItemTypes();
      expect(types.length).toBeGreaterThan(0);
    });

    it("common/ ディレクトリと非 DataModel ファイルが DataModel type 集合に含まれない", () => {
      const types = getDataModeledItemTypes();
      expect(types).not.toContain("common");
      expect(types).not.toContain("helpers");
      expect(types).not.toContain("outfitCategories");
      expect(types).not.toContain("partHelpers");
      expect(types).not.toContain("uses"); // 使用回数の最大値ヘルパー(2026-08-09)
    });

    it("DataModel ファイルの type が documentTypes.Item に過不足なく存在する", () => {
      const json = JSON.parse(systemRaw);
      const dataModeledTypes = getDataModeledItemTypes().sort();
      const documentTypesItemKeys = Object.keys(json.documentTypes.Item).sort();
      expect(dataModeledTypes).toEqual(documentTypesItemKeys);
    });
  });
});

// ============================================================
// 検証5: パーシャル参照は必ず preload されている
// ============================================================
// Handlebars のパーシャル({{> "systems/…"}})は loadTemplates で登録済みでないと
// 実行時に解決できない。通常のテンプレートは renderTemplate が都度取得するので
// 登録は任意だが、パーシャルだけは**必須**。新しいパーシャルを足したときの
// 登録漏れを機械的に止める(2026-09-07)。
describe("検証5: テンプレートのパーシャル参照が preload に登録されている", () => {
  const entry = readFileSync(join(projectRoot, "scripts", "tnx.mjs"), "utf-8");

  /** templates/ 配下の .hbs を再帰収集する。 */
  const collect = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? collect(join(dir, d.name))
      : (d.name.endsWith(".hbs") ? [join(dir, d.name)] : []));

  const refs = new Set();
  for (const f of collect(join(projectRoot, "templates"))) {
    const src = readFileSync(f, "utf-8");
    for (const m of src.matchAll(/\{\{#?>\s*"(systems\/[^"]+)"/g)) refs.add(m[1]);
  }

  it("参照を実際に拾えている(検証が空振りしていない)", () => {
    expect(refs.size).toBeGreaterThan(15);
  });

  it("すべてのパーシャル参照が tnx.mjs の preload に載っている", () => {
    expect([...refs].filter((r) => !entry.includes(r)).sort()).toEqual([]);
  });

  it("preload に載っているテンプレートは実在する", () => {
    const listed = [...entry.matchAll(/"systems\/tokyo-nova-axleration\/(templates\/[^"]+\.hbs)"/g)]
      .map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(60);
    expect(listed.filter((rel) => !existsSync(join(projectRoot, rel)))).toEqual([]);
  });
});
