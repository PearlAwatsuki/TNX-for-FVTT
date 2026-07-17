import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 用途一覧(usage-list.hbs)のボタン配線の回帰テスト(2026-07-17)。
// 経緯: 自前リスナー(毎レンダー個別バインド→委譲一回バインド)はどちらも寿命管理の穴で
// 「ボタンが無反応」を繰り返したため全廃し、コア標準の data-action ディスパッチに一本化した
// (コアはフレーム生成のたびに配線するため開き直し・再レンダーで死なない)。
// このテストはテンプレートの data-action とシートの DEFAULT_OPTIONS.actions 登録の対応、
// および自前バインドの再導入をソーステキストで検知する(シートクラスは foundry グローバル
// 依存のため vitest では import できない)。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hbs = readFileSync(path.join(root, "templates", "parts", "usage-list.hbs"), "utf8");
const sheetSrc = readFileSync(path.join(root, "scripts", "item", "tnx-item-sheet.mjs"), "utf8");

describe("用途一覧のボタン配線(usage-list.hbs ⇔ TokyoNovaItemSheet.actions)", () => {
  const templateActions = [...hbs.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]);

  it("テンプレートは4つの用途アクション(作成/使用/編集/削除)を data-action で宣言する", () => {
    expect(templateActions.sort()).toEqual(["usageCreate", "usageDelete", "usageEdit", "usageUse"]);
  });

  it.each(["usageCreate", "usageUse", "usageEdit", "usageDelete"])(
    "data-action=%s は DEFAULT_OPTIONS.actions に登録されている",
    (name) => {
      expect(sheetSrc).toMatch(new RegExp(`${name}:\\s*TokyoNovaItemSheet\\._on\\w+`));
    },
  );

  it("使用/編集/削除の各ボタンは data-usage-id を持つ(ハンドラが依存)", () => {
    for (const name of ["usageUse", "usageEdit", "usageDelete"]) {
      expect(hbs).toMatch(new RegExp(`data-action="${name}"[^>]*data-usage-id=`));
    }
  });

  it("自前のクリックバインド(委譲/個別)が再導入されていない", () => {
    expect(sheetSrc).not.toContain("_bindUsageListDelegation");
    expect(sheetSrc).not.toContain('.action-create");');
    expect(sheetSrc).not.toMatch(/querySelector(All)?\("\.action-(create|use|edit|delete)/);
  });
});
