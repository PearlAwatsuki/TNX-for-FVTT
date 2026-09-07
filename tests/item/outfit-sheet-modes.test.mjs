/**
 * @fileoverview DataModel の mode 選択肢と、シートが出す選択肢の整合(2026-09-07)。
 *
 * 経緯: `hide`(隠匿値)は DataModel が当初から `["none","value","reference","control"]` を
 * 許し、outfit-base.mjs の説明文も「なし/数値/解説参照/制御値 の 4 状態」と書いていた。
 * しかしシート側は購入値と共用の `buyHideModes`(3 状態)を使い続けており、**制御値を選ぶ
 * 手段が無い**状態が残っていた(選べないうえ、仮に入っていても表示側の分岐が無く "-" になる)。
 * スキーマだけが先に進み、UI が取り残された形。
 *
 * シートクラスは ApplicationV2 を継承しており Foundry 実行環境なしでは import できないため、
 * usage-list-wiring.test.mjs と同じくソーステキストで突き合わせる。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaSrc = readFileSync(join(root, "scripts/data/item/common/outfit-base.mjs"), "utf8");
const sheetSrc  = readFileSync(join(root, "scripts/item/tnx-outfit-sheet.mjs"), "utf8");

/** outfit-base.mjs の `<field>: modeValueField([...])` から choices を読む。 */
function schemaChoices(field) {
  const m = new RegExp(`${field}:\\s*modeValueField\\(\\[([^\\]]*)\\]\\)`).exec(schemaSrc);
  if (!m) throw new Error(`スキーマに ${field} の modeValueField が見つからない`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

/** シートの `static get <name>()` が返すオブジェクトのキーを読む。 */
function sheetModeKeys(name) {
  const m = new RegExp(`static get ${name}\\(\\)\\s*\\{[\\s\\S]*?return \\{([^}]*)\\}`).exec(sheetSrc);
  if (!m) throw new Error(`シートに ${name} が見つからない`);
  return [...m[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
}

describe("アウトフィットシートのモード選択肢は DataModel の choices を網羅する", () => {
  it.each([
    ["buy",  "buyModes"],
    ["hide", "hideModes"],
  ])("%s: スキーマの選択肢が %s に全て出ている", (field, getter) => {
    expect(sheetModeKeys(getter).sort()).toEqual(schemaChoices(field).sort());
  });

  it("購入値と隠匿値は別の選択肢を使う（隠匿値だけが制御値を持つため共用できない）", () => {
    expect(schemaChoices("hide")).toContain("control");
    expect(schemaChoices("buy")).not.toContain("control");
    // 共用していた頃の getter 名が残っていないこと(テンプレート側の参照も道連れになるため)
    expect(sheetSrc).not.toMatch(/buyHideModes?/);
  });

  it("テンプレートは購入値と隠匿値で別の選択肢を参照する", () => {
    const hbs = readFileSync(join(root, "templates/item/outfit-sheet.hbs"), "utf8");
    expect(hbs).toContain("{{selectOptions options.buyMode selected=system.buy.mode}}");
    expect(hbs).toContain("{{selectOptions options.hideMode selected=system.hide.mode}}");
    expect(hbs).not.toMatch(/options\.buyHideMode/);
  });
});
