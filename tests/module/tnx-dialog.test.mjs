/**
 * @fileoverview 一覧選択ダイアログの行組み立て(buildSelectionRowsHtml)のテスト。
 *
 * 経緯: TargetSelectionDialog は `<select>` を出すため「名前＋分類を並べ、選べないものを
 * 理由つきでグレーアウトする」形に合わなかった。合わないからと各フローがその場に DialogV2 を
 * 書いた結果、同じ行の組み立てが 4 箇所へ複製され、`tnx-uses-dialog`(使用回数由来)という
 * 無関係なクラス名まで一緒に運ばれていた。抽象が狭いなら広げる、が ListSelectionDialog。
 *
 * ダイアログの表示そのものは Foundry の DialogV2 が要るためテストしない。行の組み立てだけを
 * 純粋な関数として切り出して対象にする。
 */

import { describe, it, expect } from "vitest";
import { buildSelectionRowsHtml } from "../../scripts/ui/tnx-dialog.mjs";
import { DISABLED_TRIGGER_CLASS } from "../../scripts/ui/ui-trigger-disable.mjs";

const opt = (over = {}) => ({ value: "a", label: "アイテムA", ...over });

describe("buildSelectionRowsHtml()", () => {
  it("単一選択はラジオ・複数選択はチェックボックス", () => {
    expect(buildSelectionRowsHtml([opt()], { multi: false })).toContain('type="radio"');
    expect(buildSelectionRowsHtml([opt()], { multi: true })).toContain('type="checkbox"');
  });

  it("単一選択で指定が無ければ最初の 1 つが既定で選ばれる", () => {
    const html = buildSelectionRowsHtml([opt({ value: "a" }), opt({ value: "b" })]);
    expect(html.split("checked").length - 1).toBe(1);
    expect(html.indexOf('value="a"')).toBeLessThan(html.indexOf("checked"));
  });

  it("単一選択の既定は「選べる」最初の 1 つ（不可の行は飛ばす）", () => {
    const html = buildSelectionRowsHtml([
      opt({ value: "a", disabled: "改造済みです" }),
      opt({ value: "b" }),
    ]);
    expect(html).toMatch(/value="b"[^>]* checked/);
    expect(html).not.toMatch(/value="a"[^>]* checked/);
  });

  it("複数選択は既定で何も選ばない（明示した行だけ選ぶ）", () => {
    expect(buildSelectionRowsHtml([opt(), opt({ value: "b" })], { multi: true }))
      .not.toContain("checked");
    expect(buildSelectionRowsHtml([opt({ checked: true })], { multi: true })).toContain("checked");
  });

  it("不可の行はグレーアウト・理由を tooltip に出し、選択させない", () => {
    const html = buildSelectionRowsHtml([opt({ disabled: "「ー」の項目は改造できません" })]);
    expect(html).toContain(DISABLED_TRIGGER_CLASS);
    expect(html).toContain('title="「ー」の項目は改造できません"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("checked");
  });

  it("補助ラベルは括弧で添える", () => {
    expect(buildSelectionRowsHtml([opt({ sub: "武器／白兵武器" })]))
      .toContain("<span>アイテムA（武器／白兵武器）</span>");
  });

  it("右端の補助表示と警告色", () => {
    expect(buildSelectionRowsHtml([opt({ trailing: "残り 2/3" })]))
      .toContain('<span class="tnx-uses-count">残り 2/3</span>');
    expect(buildSelectionRowsHtml([opt({ trailing: "残り 0/3", trailingWarn: true })]))
      .toContain('class="tnx-uses-count tnx-uses-out"');
  });

  it("値・ラベル・理由はエスケープする", () => {
    const html = buildSelectionRowsHtml([
      opt({ value: '"><script>', label: "<b>名前</b>", sub: "a&b", disabled: '"x"' }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>名前</b>");
    expect(html).toContain("a&amp;b");
  });

  it("name はそのまま input の name になる（呼び出し側が読み取りに使う）", () => {
    expect(buildSelectionRowsHtml([opt()], { name: "modDrug", multi: true }))
      .toContain('name="modDrug"');
  });

  it("空・欠けた入力でも落ちない", () => {
    expect(buildSelectionRowsHtml([])).toBe("");
    expect(buildSelectionRowsHtml(null)).toBe("");
    expect(buildSelectionRowsHtml([null, opt()])).toContain('value="a"');
  });
});
