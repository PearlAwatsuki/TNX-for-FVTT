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
        ActorSheet: "readonly",
        ItemSheet: "readonly",
        Application: "readonly",
        Dialog: "readonly",
        FormApplication: "readonly",
        JournalSheet: "readonly",
        Cards: "readonly",
        Card: "readonly",
        ChatMessage: "readonly",
        Scene: "readonly",
        User: "readonly",
        Roll: "readonly",
        TextEditor: "readonly",
        loadTemplates: "readonly",
        renderTemplate: "readonly",
        mergeObject: "readonly",
        duplicate: "readonly",
        getProperty: "readonly",
        setProperty: "readonly",
        // Foundry のグローバル関数・クラス
        fromUuid: "readonly",
        ContextMenu: "readonly",
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
    // node_modules と tests/ は除外/特殊扱い
    ignores: ["node_modules/**", "lang/**.json"],
  },
];
