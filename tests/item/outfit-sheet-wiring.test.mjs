/**
 * @fileoverview アウトフィットシートと共通ロジックの結線(2026-09-07)。
 *
 * シートクラスは ApplicationV2 を継承しており Foundry 実行環境なしでは import できないため、
 * usage-list-wiring.test.mjs と同じくソーステキストで突き合わせる。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const schemaSrc = read("scripts/data/item/common/outfit-base.mjs");
const sheetSrc  = read("scripts/item/tnx-outfit-sheet.mjs");
const actorSrc  = read("scripts/actor/tnx-character-sheet-base.mjs");

/** `static ...<name>(` から、列 4 の閉じ括弧までを本文として切り出す。 */
function methodBody(src, name) {
  const start = src.indexOf(`${name}(`);
  if (start < 0) throw new Error(`${name} が見つからない`);
  const end = src.indexOf("\n    }", start);
  return src.slice(start, end < 0 ? undefined : end);
}

// ── モード選択肢 ─────────────────────────────────────────────────────────────
// 経緯: `hide`(隠匿値)は DataModel が当初から control を許し、outfit-base.mjs の説明文も
// 「なし/数値/解説参照/制御値 の 4 状態」と書いていた。しかしシートは購入値と共用の
// buyHideModes(3 状態)を使い続けており、**制御値を選ぶ手段が無い**状態が残っていた
// (選べないうえ、仮に入っていても表示側の分岐が無く "-" になる)。スキーマだけが先に進んだ形。

/** outfit-base.mjs の `<field>: modeValueField([...])` から choices を読む。 */
function schemaChoices(field) {
  const m = new RegExp(`${field}:\\s*modeValueField\\(\\[([^\\]]*)\\]\\)`).exec(schemaSrc);
  if (!m) throw new Error(`スキーマに ${field} の modeValueField が見つからない`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** シートの `static get <name>()` が返すオブジェクトのキーを読む。 */
function sheetModeKeys(name) {
  const m = new RegExp(`static get ${name}\\(\\)\\s*\\{[\\s\\S]*?return \\{([^}]*)\\}`).exec(sheetSrc);
  if (!m) throw new Error(`シートに ${name} が見つからない`);
  return [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
}

describe("アウトフィットシートのモード選択肢は DataModel の choices を網羅する", () => {
  it.each([
    ["buy", "buyModes"],
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
    const hbs = read("templates/item/outfit-sheet.hbs");
    expect(hbs).toContain("{{selectOptions options.buyMode selected=system.buy.mode}}");
    expect(hbs).toContain("{{selectOptions options.hideMode selected=system.hide.mode}}");
    expect(hbs).not.toMatch(/options\.buyHideMode/);
  });
});

// ── 携帯中/準備済みの不変条件 ────────────────────────────────────────────────
// 経緯: この不変条件はアクターシートの _onToggleOutfitFlag にだけ実装され、アイテムシートの
// _onToggleFlag は素で反転していた。**同じ操作でも入口によって結果が違い**、アイテムシートの
// ヘッダからは「携帯していないのに準備済み」を作れた(防御力の合算は isPrepared を見る)。
// 共用関数へ一本化したあと、片方だけが素の反転へ戻る退行を検知する。

describe("携帯中/準備済みの切り替えは両方のシートが共用関数を通る", () => {
  it("アイテムシートは装備状態フラグを applyOutfitFlagToggle へ渡す", () => {
    expect(sheetSrc).toContain('from "../../scripts/core/outfit-flags.mjs"');
    const body = methodBody(sheetSrc, "static async _onToggleFlag");
    expect(body).toContain("isEquipStateFlag(flag)");
    expect(body).toContain("applyOutfitFlagToggle(this.item, flag, actor)");
  });

  it("アクターシートも同じ共用関数を通る", () => {
    const body = methodBody(actorSrc, "static async _onToggleOutfitFlag");
    expect(body).toContain("applyOutfitFlagToggle(item, target.dataset.flag, this.actor)");
    // 不変条件を手書きで持ち直していないこと(規則の正本は planOutfitFlagToggle 一箇所)
    expect(body).not.toContain("isPrepared");
    expect(body).not.toContain("majorCategory");
  });

  it("プレアクト購入の可否は描画とハンドラが同じ述語を見る", () => {
    // 従来この条件は描画側にしか無く、クリックを止めていたのは CSS の pointer-events だった。
    // 押せてしまう不具合は起きていなかったが、規則が意匠にしか無い状態を解消した
    // ハンドラ(クリックを止める)と描画(グレーアウトする)の 2 箇所が同じ述語を見る
    const uses = sheetSrc.split("canTogglePreplayPurchase(this.item.system)").length - 1;
    expect(uses).toBe(2);
    expect(methodBody(sheetSrc, "static async _onToggleFlag"))
      .toContain("canTogglePreplayPurchase(this.item.system)");
    // 述語を経由せず mode を直に見ていないこと
    expect(sheetSrc).not.toContain('preserveExp?.mode !== "value"');
  });

  it("規則の正本は純関数が持ち、適用層は書き込みだけを担う", () => {
    expect(read("scripts/data/item/helpers.mjs")).toContain("export function planOutfitFlagToggle(");
    const flags = read("scripts/module/outfit-flags.mjs");
    expect(flags).toContain("planOutfitFlagToggle(item, flag,");
    expect(flags).not.toContain('=== "housing"');   // 規則を再実装していない
  });
});
