# PHASE_0_TASKS.md

フェーズ0「土台を v13 で動かす」の作業リスト。

## フェーズ0 の目標

- v13 でキャラクターシートが正常表示されること
- 起動時のエラー・deprecation 警告の解消
- シート表示・基本動作に関わる既知バグの修正

## 進行ルール

- 1タスク = 1コミット
- タスク完了時にこのファイルでチェック (`- [x]`) を付ける
- 大きな変更前はプランを提示し、承認後に実装する（CLAUDE.md 実装方針参照）

---

## 作業順序

v13 実機観測の結果を踏まえた推奨実施順:

1. P0-06: V13_MIGRATION_NOTES.md 更新（本タスクにて実施済み）
2. P0-02: active-effects-list action 名修正
3. P0-03: styleSkill 正規表現修正
4. P0-04: initiative 式修正
5. P0-07: renderJournalDirectory v13 対応
6. P0-08: renderSettingsConfig v13 対応
7. P0-09: renderHotbar v13 対応
8. 修正後に v13 再起動してログ採取（ユーザー作業）
9. P0-01: system.json verified 更新（確認済みバージョンで確定）

---

## 作業リスト

### P0-01: system.json の `verified` 更新

- [ ] 完了

**作業内容**
`system.json` の `compatibility.verified` を、v13 で動作確認した実バージョン番号に更新する。
他の修正タスクが完了し、再観測でエラーがなくなった後に実施する。

**関連項目**
- V13_MIGRATION_NOTES.md §1

**想定される影響範囲**
`system.json` 1行のみ。コードへの影響なし。

**動作確認方法**
Foundry 管理画面のシステム一覧で、当システムの「未検証バージョン」警告が消えることを確認。

**推定難易度**: 低

**前提条件**
P0-07 / P0-08 / P0-09 の完了後に実施（正確なバージョン番号は再観測後に確定）

---

### P0-02: `active-effects-list.hbs` の action 名を修正

- [x] 完了

**作業内容**
`templates/parts/active-effects-list.hbs` の `data-action` 値を、
`EffectsSheetMixin.activateEffectListListeners()` の `switch` 文と一致させる。

| 修正前 | 修正後 |
|---|---|
| `createEffect` | `create` |
| `toggleEffect` | `toggle` |
| `editEffect` | `edit` |
| `deleteEffect` | `delete` |

**関連項目**
- KNOWN_ISSUES.md KI-001

**想定される影響範囲**
ItemSheet（miracle / generalSkill / styleSkill / organization）で ActiveEffect の
作成・編集・削除・トグルボタンが動作するようになる。
CastSheet は独自ディスパッチ機構を持つため影響なし。

**動作確認方法**
miracle または generalSkill のアイテムシートを開き、ActiveEffect リストの各ボタン
（作成・トグル・編集・削除）が正常に動作することを確認。

**推定難易度**: 低

**前提条件**
なし

---

### P0-03: `styleSkill._onSelectChange` の正規表現を修正

- [x] 完了

**作業内容**
`scripts/item/tnx-style-skill-sheet.mjs:273-275` の3つの正規表現から
`styleSkill\.` プレフィックスを除去する。

```
修正前: /^system\.styleSkill\.comboSkill\.(\d+)\.value$/
修正後: /^system\.comboSkill\.(\d+)\.value$/

修正前: /^system\.styleSkill\.confrontation\.(\d+)\.value$/
修正後: /^system\.confrontation\.(\d+)\.value$/

修正前: /^system\.styleSkill\.timing\.(\d+)\.value$/
修正後: /^system\.timing\.(\d+)\.value$/
```

実際のフォーム `name` 属性は `system.comboSkill.N.value` 形式（`styleSkill.` プレフィックスなし）。

**関連項目**
- KNOWN_ISSUES.md KI-003

**想定される影響範囲**
スタイル技能シートのコンボ技能・対決・タイミングの select 変更時の連動リセット処理のみ。
他シートへの影響なし。

**動作確認方法**
スタイル技能シートを開き、コンボ技能・対決・タイミングのいずれかのドロップダウンを
変更したとき、連動するテキストフィールド（`*Other` 等）がリセットされることを確認。

**推定難易度**: 低

**前提条件**
なし

---

### P0-04: `system.json` の initiative 式を修正

- [x] 完了

**作業内容**
`system.json:154` の initiative 式を、実際のフィールドパスに合わせて修正する。

```
修正前: "@system.CS.value"
修正後: "@system.combatSpeed.value"
```

`CS` というショートハンドは `template.json` に存在せず、正しいフィールドパスは
`attributes.combatSpeed.value`（`@` 参照では `system.combatSpeed.value`）。

**関連項目**
- KNOWN_ISSUES.md KI-004

**想定される影響範囲**
`system.json` 1行のみ。コンバットトラッカーでのイニシアチブ自動計算に影響。
シート表示自体への影響なし。

**動作確認方法**
コンバットトラッカーにキャストを追加し、「イニシアチブをロール」を実行した際に
そのキャストの `combatSpeed.value` の値がイニシアチブに反映されることを確認。

**推定難易度**: 低

**前提条件**
なし

**※ 補足**: 本タスクは式の修正のみ。combatSpeed の表示・入力 UI は未実装のため、
コンバットトラッカーでロールしても値は常に 0 となる。詳細は KNOWN_ISSUES.md KI-010 を参照。

---

### P0-05: v13 実機起動による警告・エラーの観測【ユーザー実施】

- [x] 完了

**作業内容**
*この作業はユーザーが手動で実施し、結果を Claude に共有する。*

v13 実機での観測ログを採取済み。結果は P0-06 として V13_MIGRATION_NOTES.md に反映した。

**関連項目**
- V13_MIGRATION_NOTES.md §3〜§15 すべて

---

### P0-06: V13_MIGRATION_NOTES.md を実機結果で更新

- [x] 完了

**作業内容**
P0-05 の観測結果をもとに `docs/V13_MIGRATION_NOTES.md` を更新した。

主な更新内容:
- §4 (renderJournalDirectory): 「確認済み・致命的」に更新
- §5 (renderSettingsConfig): 「確認済み・致命的」に更新
- §6 (renderHotbar): 「確認済み・致命的」に更新
- §2 / §8 / §9 / §11 / §12: deprecation 警告のみ・v15 まで動作・フェーズ0 対応不要に更新
- §15 (ContextMenu): 新規追加（jQuery オプション警告・フェーズ0 対応不要）

**関連項目**
- V13_MIGRATION_NOTES.md 全体

---

### P0-07: `renderJournalDirectory` フックを v13 対応

- [x] 完了

**作業内容**
`scripts/tnx.mjs` の `renderJournalDirectory` フックハンドラを、
jQuery API から DOM API に書き換える。

- `html.find(...)` → `html.querySelector(...)` / `html.querySelectorAll(...)`
- `$('<tag>...</tag>')` 等の jQuery 構築 → `document.createElement` または `innerHTML`
- `.on('click', ...)` → `.addEventListener('click', ...)`
- `.append(...)` → `.appendChild(...)` または `insertAdjacentElement`
- `.css(...)` → `.style.*`
- `.off('click').on('click', ...)` → `removeEventListener` + `addEventListener`

**関連項目**
- V13_MIGRATION_NOTES.md §4

**想定される影響範囲**
`scripts/tnx.mjs` の `renderJournalDirectory` フック内のみ（約50行）。
他のフック・シートへの影響なし。

**動作確認方法**
ジャーナルディレクトリを開き:
1. 「作成」ボタンにカスタムラベルが表示されること
2. クリックで「資料を作成」「アクトシートを作成」の選択メニューが表示されること
3. 「アクトシートを作成」で TnxScenarioSheet が適用された JournalEntry が作成されること

**推定難易度**: 低

**前提条件**
なし（P0-08 / P0-09 と独立。同一ファイルだが対象箇所は異なる）

---

### P0-08: `renderSettingsConfig` フックを v13 対応

- [x] 完了

**作業内容**
`scripts/tnx.mjs` の `renderSettingsConfig` フックハンドラを、
jQuery API から DOM API に書き換える。

対象は `createDropdown` 関数（約20行）と、チェックボックス連動の `toggleManualSettings`
（`autoLoadCheckbox` / `manualSelects` の取得・操作部分）。

- `html.find(...)` → `html.querySelector(...)` / `html.querySelectorAll(...)`
- `$('<select>...</select>')` → `document.createElement('select')`
- `select.append(...)` → `select.appendChild(...)` または `insertAdjacentHTML`
- `input.replaceWith(select)` → `input.parentNode.replaceChild(select, input)` 等
- `.prop('disabled', ...)` → `.disabled = ...`
- `.is(':checked')` → `.checked`
- `.on('change', ...)` → `.addEventListener('change', ...)`

**関連項目**
- V13_MIGRATION_NOTES.md §5

**想定される影響範囲**
`scripts/tnx.mjs` の `renderSettingsConfig` フック内のみ（約40行）。
他のフック・シートへの影響なし。

**動作確認方法**
システム設定を開き:
1. 山札・捨て札・ニューロデッキ等の設定がドロップダウンで表示されること
2. 「アクトシートから自動で読み込む」チェックボックスの ON/OFF で
   手動設定ドロップダウンが無効化・有効化されること

**推定難易度**: 低

**前提条件**
なし

---

### P0-09: `renderHotbar` フックを v13 対応

- [ ] 完了

**作業内容**
`scripts/tnx.mjs` の `renderHotbar` フックハンドラを v13 対応に修正する。

v13 では `html` が既に HTMLElement であるため `html[0]` は不要。

```js
// 修正前
const actionBar = html[0].querySelector("#action-bar");
const toggleButton = html[0].querySelector("#bar-toggle");
// 修正後
const actionBar = html.querySelector("#action-bar");
const toggleButton = html.querySelector("#bar-toggle");
```

**関連項目**
- V13_MIGRATION_NOTES.md §6

**想定される影響範囲**
`scripts/tnx.mjs` の `renderHotbar` フック内のみ（約10行）。
`scripts/module/tnx-hud.mjs:135-145` の `document.getElementById` は別件であり、
このタスクでは触らない（動作未確認のため）。

**動作確認方法**
Foundry 起動後、ホットバーが自動的に折りたたまれた状態で表示されることを確認。

**推定難易度**: 低

**前提条件**
なし

---

*最終更新: 2026-05-19*
