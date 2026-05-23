/**
 * @fileoverview template.json 健全性テスト(恒久テスト)
 *
 * フェーズB のサブフェーズごとに template.json からエントリを削除する際に
 * 発生しうる以下の問題を CI で継続的に検出する。
 *
 * 検証1: JSON 妥当性 — 末尾カンマ等の構文崩れを検出
 * 検証2: 二重定義の禁止 — DataModel 化済み type が template.json に残存していないこと
 *
 * このテストは Foundry ランタイムに依存しない(Node.js 単体で完結)。
 * CONFIG.Item.dataModels 等のグローバルは参照しない。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// template.json の生テキスト(module 評価時に読み込む。ファイル不在は collection error)
const templateRaw = readFileSync(join(projectRoot, "template.json"), "utf-8");

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
 * - helpers.mjs はヘルパー関数ファイルのため除外
 * - .mjs ファイルのみを対象とし、ファイル名を camelCase type 名に変換する
 * @returns {string[]}
 */
function getDataModeledItemTypes() {
  const itemDir = join(projectRoot, "scripts", "data", "item");
  return readdirSync(itemDir, { withFileTypes: true })
    .filter(entry =>
      entry.isFile() &&
      extname(entry.name) === ".mjs" &&
      entry.name !== "helpers.mjs"
    )
    .map(entry => kebabToCamel(basename(entry.name, ".mjs")));
}

/**
 * template.json の Item セクションから type 別エントリのキーを取得する。
 * 'types'(配列)と 'templates'(共通テンプレート定義)は type 別エントリではないため除外する。
 * @param {object} templateJson
 * @returns {string[]}
 */
function getTemplateItemTypeKeys(templateJson) {
  const NON_TYPE_KEYS = new Set(["types", "templates"]);
  return Object.keys(templateJson.Item).filter(key => !NON_TYPE_KEYS.has(key));
}

// ============================================================
// 検証1: JSON 妥当性
// ============================================================

describe("template.json 健全性テスト", () => {
  describe("検証1: JSON 妥当性", () => {
    it("template.json が有効な JSON として読み込める(末尾カンマ等の構文崩れがない)", () => {
      expect(() => JSON.parse(templateRaw)).not.toThrow();
    });

    it("Item セクションと Actor セクションが存在する", () => {
      const json = JSON.parse(templateRaw);
      expect(json).toHaveProperty("Item");
      expect(json).toHaveProperty("Actor");
    });

    it("Item.types が配列として存在する", () => {
      const json = JSON.parse(templateRaw);
      expect(Array.isArray(json.Item.types)).toBe(true);
      expect(json.Item.types.length).toBeGreaterThan(0);
    });
  });

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
  // 検証2: DataModel 化済み type の二重定義なし
  // ============================================================

  describe("検証2: DataModel 化済み type と template.json の非重複", () => {
    it("scripts/data/item/ から DataModel ファイルが 1 件以上検出される", () => {
      const types = getDataModeledItemTypes();
      expect(types.length).toBeGreaterThan(0);
    });

    it("common/ ディレクトリと helpers.mjs が DataModel type 集合に含まれない", () => {
      const types = getDataModeledItemTypes();
      expect(types).not.toContain("common");
      expect(types).not.toContain("helpers");
    });

    it("Item.types 配列・Item.templates セクションが type 別エントリとして混入しない", () => {
      const json = JSON.parse(templateRaw);
      const typeKeys = getTemplateItemTypeKeys(json);
      expect(typeKeys).not.toContain("types");
      expect(typeKeys).not.toContain("templates");
    });

    it("DataModel 化済み type が template.json の type 別エントリに残存しない(積集合が空)", () => {
      const json = JSON.parse(templateRaw);
      const dataModeledTypes = getDataModeledItemTypes();
      const templateTypeKeys = getTemplateItemTypeKeys(json);

      // 積集合: DataModel 化済みなのに template.json にも残っている type
      const intersection = dataModeledTypes.filter(t => templateTypeKeys.includes(t));

      // 削除漏れがあればここで検出される。失敗時のメッセージで対象 type を特定できるよう出力
      expect(intersection).toHaveLength(0);
    });
  });
});
