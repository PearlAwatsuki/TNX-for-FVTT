// ESLint 設定ファイル(Flat Config 形式、ESLint v9+)
// 詳細: https://eslint.org/docs/latest/use/configure/configuration-files

import js from "@eslint/js";
import globals from "globals";

export default [
  // ESLint 推奨ルールセット
  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        // Foundry VTT のグローバル変数
        game: "readonly",
        ui: "readonly",
        canvas: "readonly",
        CONFIG: "readonly",
        Hooks: "readonly",
        foundry: "readonly",
        Actor: "readonly",
        Item: "readonly",
        ActiveEffect: "readonly",
        Combat: "readonly",
        Combatant: "readonly",
        Cards: "readonly",
        Card: "readonly",
        ChatMessage: "readonly",
        Scene: "readonly",
        User: "readonly",
        Roll: "readonly",
        // Foundry のグローバル関数・クラス
        fromUuid: "readonly",
        fromUuidSync: "readonly",
        loadTexture: "readonly",
        PIXI: "readonly",
        FormDataExtended: "readonly",
        JournalEntry: "readonly",
        // Foundry の定数
        CONST: "readonly",
        // Foundry のコレクション
        Actors: "readonly",
        Items: "readonly",
        Journal: "readonly",
        // Foundry が同梱しているライブラリ
        $: "readonly",
        jQuery: "readonly",
        Handlebars: "readonly",
        ProseMirror: "readonly",
      },
    },
    rules: {
      // バランス型(中)の追加ルール
      eqeqeq: ["error", "always"],         // == ではなく === を使う
      "no-var": "error",                    // var ではなく let/const を使う
      "prefer-const": "warn",               // 再代入しない変数は const にする
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",            // _ から始まる引数は未使用 OK
        varsIgnorePattern: "^_",            // _ から始まる変数は未使用 OK
      }],
    },
  },

  {
    // scripts/rules/ は「TNX のルール判断」を置く場所で、**Foundry 非依存であること**が
    // 存在意義(Foundry 実行環境なしでそのままテストできる)。従来この性質は `-logic` という
    // 接尾辞で表していたが、名乗るかどうかが書き手任せで、同じ性質のファイルの 3 分の 2 は
    // 名乗っていなかった。ディレクトリに移して機械的に強制する(2026-09-07)。
    files: ["scripts/rules/**/*.mjs"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "game",        message: "scripts/rules/ は Foundry 非依存にする。値は引数で受け取る" },
        { name: "ui",          message: "scripts/rules/ は Foundry 非依存にする。通知は呼び出し側で行う" },
        { name: "Hooks",       message: "scripts/rules/ は Foundry 非依存にする" },
        { name: "canvas",      message: "scripts/rules/ は Foundry 非依存にする" },
        { name: "CONFIG",      message: "scripts/rules/ は Foundry 非依存にする" },
        { name: "ChatMessage", message: "scripts/rules/ は Foundry 非依存にする" },
        { name: "fromUuid",    message: "scripts/rules/ は Foundry 非依存にする。解決済みの値を受け取る" },
        { name: "foundry",     message: "scripts/rules/ は Foundry 非依存にする" },
      ],
    },
  },

  {
    // node_modules と tests/ は除外/特殊扱い
    ignores: ["node_modules/**", "lang/**.json"],
  },
];
