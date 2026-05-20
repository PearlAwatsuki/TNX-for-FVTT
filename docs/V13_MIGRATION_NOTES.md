# V13_MIGRATION_NOTES.md

v13 移行に向けたコード解析・実機観測メモ。
各項目には「確認済み」「未確認」のいずれかを明記する。

---

## 1. system.json の compatibility 設定

**ステータス: 対応済み（P0-01 完了後に確定）**

### 現状
```json
"compatibility": {
  "minimum": 11,
  "verified": 12.343
}
```

### 更新内容
- `verified` を v13 で動作確認した実バージョンに更新する（P0-01 で実施）
- `minimum` は移行期間中は変更しない

### 対応優先度: 高（必須）

---

## 2. ApplicationV1 シートの deprecation

**ステータス: 確認済み・フェーズ0 では許容**

### 確認内容
v13 実機起動時に ActorSheet / ItemSheet / JournalSheet / Application / Dialog /
Actors / Items / Journal / loadTemplates / TextEditor / ContextMenu 等の
グローバル参照に関する deprecation 警告が出力されることを確認。
**v15 まで動作が保証されているため、フェーズ0 では対応しない。**

### 影響範囲
ApplicationV2 への移行はフェーズ6 で扱う。

### 対応優先度: 低（フェーズ0 では対応不要）

---

## 3. `app._closed` プロパティ

**ステータス: 未確認（実機ログに出ていない）**

### 現状
`scripts/tnx.mjs:144-149` の `handleRefreshSheets()` で使用:
```js
if (game.tnx?.hud && !game.tnx.hud._closed) { ... }
for (const app of Object.values(ui.windows)) {
    if (!app._closed) { app.render(true); }
}
```

### 懸念事項
`_closed` は ApplicationV1 の内部プロパティ。v13 で ApplicationV2 ベースのウィンドウが
`ui.windows` に含まれるようになった場合、`_closed` が `undefined` になり、
常に `render(true)` が呼ばれる可能性がある。

ApplicationV1/V2 共通で使える判定は `app.rendered` (boolean)。

### 対応優先度: 中（実機でカード操作後の再描画挙動を確認し、問題があれば対処）

---

## 4. `renderJournalDirectory` フックの DOM 操作

**ステータス: 確認済み・致命的**

### 確認内容
v13 実機でエラー発生: `html.find is not a function` (`scripts/tnx.mjs:429`)

v13 では render 系フックの第2引数が **jQuery オブジェクト → HTMLElement** に変更された。
`html.find(...)` は jQuery メソッドのため、HTMLElement では動作しない。

### 影響
ジャーナルディレクトリの「アクトシートを作成」カスタムボタンが表示されない。
（通常のジャーナル作成は Foundry 標準 UI から引き続き可能）

### 修正方針
`html.find(...)` を `html.querySelector(...)` / `html.querySelectorAll(...)` に置き換え。
jQuery の `.on()` / `.append()` / `.css()` 等も DOM API に置き換える。
詳細は P0-07 を参照。

### 対応優先度: 高（P0-07 で対処）

---

## 5. `renderSettingsConfig` フックの DOM 操作

**ステータス: 確認済み・致命的**

### 確認内容
v13 実機でエラー発生: `html.find is not a function` (`scripts/tnx.mjs:388`、`createDropdown` 内)

§4 と同じ原因: render 系フックの第2引数が HTMLElement に変更された。

### 影響
システム設定のドロップダウン化が動作しない。山札・手札・シーンカード等の
Cards ドキュメント選択に UUID の直打ちが必要になる。

### 修正方針
`createDropdown` 内の `html.find(...)` を `html.querySelector(...)` に置き換え。
`$('<select>')` 等の jQuery 構築も DOM API に置き換える。
詳細は P0-08 を参照。

### 対応優先度: 高（P0-08 で対処）

---

## 6. `renderHotbar` フックの DOM 操作

**ステータス: 確認済み・エラーは解消したが機能消失（v13 でホットバー折りたたみ機能自体が削除されたため）**

### 確認内容
v13 実機でエラー発生:
`Cannot read properties of undefined (reading 'querySelector')` (`scripts/tnx.mjs:487`)

`html[0].querySelector(...)` の `html[0]` が `undefined` になっている。
v13 では `html` が既に HTMLElement であり、jQuery オブジェクトではないため、
`html[0]` では要素を取得できない。

### 影響
ホットバーの自動折りたたみが動作しない。

### 修正方針
`html[0].querySelector(...)` を `html.querySelector(...)` に置き換える。
詳細は P0-09 を参照。

### 補足: `tnx-hud.mjs:135-145` の `document.getElementById` について
`scripts/module/tnx-hud.mjs:135-145` は `document.getElementById('action-bar')` 等を使用しており、
フックの `html` 引数に依存しない。今回のエラーとは別件。
v13 での動作は未確認のため、P0-09 のスコープ外とする。

### 対応優先度: 高（P0-09 で対処）

### 追記（2026-05-20）
v13 以降、Foundry コアからホットバーの折りたたみ機能自体が削除されている。
P0-09 で `querySelector` のエラーは解消したが、そもそも `#bar-toggle` 要素が DOM 上に
存在しないため処理は no-op となる。関連コードの削除または再設計はフェーズ5 で扱う（KI-012）。

---

## 7. HUD のサイドバー連動セレクタ

**ステータス: 未確認**

### 現状
`scripts/module/tnx-hud.mjs:115-132` で v12 のサイドバー DOM 構造を前提としたセレクタを使用:
```js
const sidebar = document.getElementById('sidebar');
const collapseButton = document.querySelector('#sidebar-tabs a.collapse');
```

### 懸念事項
v13 でサイドバーが ApplicationV2 に移行した場合、`#sidebar-tabs` の構造や `.collapse` クラスが
変わる可能性がある。

### 対応優先度: 低（HUD 本体の表示・カード操作は継続する。フェーズ5 で対処）

---

## 8. `TextEditor.enrichHTML` の async オプション

**ステータス: 確認済み・影響なし（deprecation 警告のみ）**

### 確認内容
`{ async: true }` オプションは v13 では不要だが、渡しても無視されエラーにはならない。
v15 まで動作するため、フェーズ0 では対応しない。

### 対応優先度: 低（フェーズ0 では対応不要）

---

## 9. `Dialog.confirm` の deprecation

**ステータス: 確認済み・影響なし（deprecation 警告のみ）**

### 確認内容
v13 で `Dialog` に関する deprecation 警告が出力されるが、v15 まで互換レイヤーで動作する。
フェーズ0 では対応しない。

### 対応優先度: 低（フェーズ6 の ApplicationV2 移行時に対処）

---

## 10. Font Awesome アイコンクラスの混在

**ステータス: 未確認**

### 現状
コードおよびテンプレート内で FA5 形式 (`fas fa-*`) と FA6 形式 (`fa-solid fa-*`) が混在:
```js
icon: "fa-solid fa-spade"  // FA6 形式
icon: "fas fa-passport"    // FA5 形式
```

### 懸念事項
v13 が Font Awesome 6 専用になった場合、FA5 形式のアイコンが表示されなくなる可能性がある。

### 対応優先度: 中（実機でアイコン表示崩れがあれば修正。フェーズ5 の CSS 対応時に整理）

---

## 11. `loadTemplates` グローバル関数

**ステータス: 確認済み・影響なし（deprecation 警告のみ）**

v13 では deprecation 警告が出るが、v15 まで動作する。フェーズ0 では対応不要。

---

## 12. `Actors.unregisterSheet` / `Items.unregisterSheet` の API

**ステータス: 確認済み・影響なし（deprecation 警告のみ）**

v13 では deprecation 警告が出るが、v15 まで動作する。フェーズ0 では対応不要。

---

## 13. Cards API の v13 での挙動

**ステータス: 未確認（致命的エラーなし）**

今回の観測では Cards API に関するエラーは確認されなかった。
実際のカード操作（ドロー・プレイ等）については別途実機確認が必要。

---

## 14. `preCreateCard` フックの挙動

**ステータス: 未確認**

今回の観測では関連エラーなし。引き続き動作していると推測。

---

## 15. `ContextMenu` の jQuery オプション警告【新規・実機確認済み】

**ステータス: 確認済み・フェーズ0 では対応不要**

### 確認内容
v13 実機で ContextMenu に関する deprecation 警告が出力された。
jQuery オプション（`condition` 等）に関する互換性警告と思われる。
**v15 まで動作が保証されているため、フェーズ0 では対応しない。**

### 対応優先度: 低（フェーズ6 の ApplicationV2 移行時に対処）

---

## フェーズ0 での v13 対応まとめ

実機確認の結果、致命的エラー（コンソールエラーが発生し機能が失われる）は以下の3件:

| 項目 | エラー箇所 | 対処タスク |
|---|---|---|
| renderJournalDirectory | tnx.mjs:429 | P0-07 |
| renderSettingsConfig | tnx.mjs:388 | P0-08 |
| renderHotbar | tnx.mjs:487 | P0-09 |

すべて render 系フックの第2引数が jQuery → HTMLElement に変わったことが原因。

deprecation 警告（v15 まで動作保証）は ApplicationV1 全般、Dialog、TextEditor、
ContextMenu、loadTemplates 等で確認されているが、フェーズ0 では対応しない。

ApplicationV1 の deprecation 警告はフェーズ0 では許容する。

---

*最終更新: 2026-05-20*
