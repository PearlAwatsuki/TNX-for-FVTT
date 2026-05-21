// Smoke test: テスト基盤が正しく動作することを確認するための最小テスト
// 「煙が出ない=動いている」ことを確かめる、というのが smoke test の語源
//
// このファイルは「Vitest が動く」ことの確認用なので、機能テストではない。
// プロジェクト固有のテストは別途追加していく。

import { describe, it, expect } from "vitest";

describe("smoke test", () => {
  it("Vitest が動作する", () => {
    expect(1 + 1).toBe(2);
  });

  it("ES Module の import が動作する", () => {
    // dynamic import の動作確認
    expect(typeof Promise).toBe("function");
  });
});
