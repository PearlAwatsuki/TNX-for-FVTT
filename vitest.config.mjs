// Vitest 設定ファイル
// 詳細: https://vitest.dev/config/

export default {
  test: {
    // tests/ 配下の *.test.mjs ファイルをテストとして扱う
    include: ["tests/**/*.test.mjs"],
    // Node.js 環境でテストを実行。Foundry の global は tests/setup.mjs が用意する
    environment: "node",
    // 各テストファイルの前に Foundry グローバルのモックを敷く(2026-09-07)。
    // 従来は各テストが `import "../setup.mjs"` を手で書いており、書き忘れると
    // 「foundry is not defined」で落ちていた。既存の手動 import はそのままでも害はない
    setupFiles: ["./tests/setup.mjs"],
    // テスト出力を見やすく
    reporters: ["verbose"],
  },
};
