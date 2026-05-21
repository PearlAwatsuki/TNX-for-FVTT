// Vitest 設定ファイル
// 詳細: https://vitest.dev/config/

export default {
  test: {
    // tests/ 配下の *.test.mjs ファイルをテストとして扱う
    include: ["tests/**/*.test.mjs"],
    // Node.js 環境でテストを実行(Foundry の global は別途モックする予定)
    environment: "node",
    // テスト出力を見やすく
    reporters: ["verbose"],
  },
};
