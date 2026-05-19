# KNOWN_ISSUES.md

棚卸し結果 (docs/INVENTORY_REPORT.md) に基づく既知の不具合・設計上の課題。
コードで実態を確認済みの項目については「確認済み」と明記する。

---

## KI-001: active-effects-list.hbs の action 名不一致

**概要**
`templates/parts/active-effects-list.hbs` の `data-action` 値と、
`EffectsSheetMixin.activateEffectListListeners()` の `switch` 文が一致しない。

| テンプレート (hbs) | ハンドラ (switch) |
|---|---|
| `createEffect` | `create` |
| `toggleEffect` | `toggle` |
| `editEffect`   | `edit`   |
| `deleteEffect` | `delete` |

**確認済み**: hbs は `data-action="createEffect"` 等を使用。switch は `"create"` 等で分岐。

**該当ファイル・箇所**
- `templates/parts/active-effects-list.hbs` 全行
- `scripts/module/effects-sheet-mixin.mjs:35` (`activateEffectListListeners` の switch 文)

**影響範囲**
シート表示・基本動作。ItemSheet（miracle/generalSkill/styleSkill/organization）で ActiveEffect
の作成・編集・削除・トグルボタンが完全に動作しない。CastSheet は独自のディスパッチ機構
(`_onCreateEffect` 等のインスタンスメソッド) を使うため影響を受けない。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: Yes

---

## KI-002: usage-list.hbs の edit 操作ハンドラ不在

**概要**
`templates/parts/usage-list.hbs` に `data-action="edit"` ボタン (`.action-edit`) が存在するが、
`TokyoNovaItemSheet.activateListeners()` に対応するハンドラが存在しない。

**該当ファイル・箇所**
- `templates/parts/usage-list.hbs`
- `scripts/item/tnx-item-sheet.mjs` (activateListeners)

**影響範囲**
シート表示。usage (用途) リストの編集ボタンが動作しない。

**修正の難易度**: 中（usage システム全体の設計と連動するため、設計議論が必要）

**フェーズ0 で扱うべきか**: No
CLAUDE.md の禁止事項「usage テンプレートおよび usage-list.hbs / UsageCreationDialog の構造を、
設計議論を経ずに改変しないこと」に該当するため、フェーズ1 の設計議論で取り扱う。

---

## KI-003: styleSkill._onSelectChange のパスミス (正規表現)

**概要**
`TokyoNovaStyleSkillSheet._onSelectChange()` 内の正規表現が、実際のフォーム `name` 属性と
一致しない。comboSkill / confrontation / timing の3パターンすべてに同じ誤りがある。

```js
// 現状 (誤)
/^system\.styleSkill\.comboSkill\.(\d+)\.value$/
// 実際のフォーム name 属性
// system.comboSkill.N.value
```

getData() で `system.comboSkill = ensureArray(...)` として扱っており、フォーム name は
`system.comboSkill.0.value` 形式 (system.styleSkill. プレフィックスなし)。

**確認済み**: `tnx-style-skill-sheet.mjs:273-275` で3パターン全て誤ったプレフィックス付き。

**該当ファイル・箇所**
- `scripts/item/tnx-style-skill-sheet.mjs:273-275`

**影響範囲**
シート表示・基本動作。スタイル技能シートのコンボ技能/対決/タイミングの select 変更時、
連動する他フィールドのリセット処理が一切動作しない。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: Yes

---

## KI-004: initiative 式のパスミス

**概要**
`system.json` の initiative 式 `@system.CS.value` と、`template.json` の実際のフィールドパス
`system.combatSpeed.value` が一致しない。`CS` というショートハンドに対応するフィールドは存在しない。

**該当ファイル・箇所**
- `system.json:154` (`"initiative": "@system.CS.value"`)
- `template.json` (`attributes.combatSpeed.value` が正しいフィールドパス)

**影響範囲**
その他。コンバットトラッカーでのイニシアチブ自動計算が機能しない。
フェーズ3（戦闘進行）に先立って修正しておくべき。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: Yes（シートの基本動作には直接影響しないが、誤ったデータ定義の
放置は後のフェーズへの影響が大きいため、この機会に修正する）

---

## KI-005: handMaxSizeMod フィールドが template.json に未定義

**概要**
`scripts/tnx.mjs:893` で ActiveEffect の変更キーとして `'system.handMaxSizeMod'` を参照しているが、
このフィールドは `template.json` (また DataModel) に定義されていない。コメントに
「このキーはアクターのデータモデルに合わせてください」と明記されている。

**該当ファイル・箇所**
- `scripts/tnx.mjs:893` (ready フック内の手札上限計算)

**影響範囲**
その他。手札上限の ActiveEffect 修正が機能しない（ゼロ扱いになる）。
基本的な手札上限機能自体は動作する。

**修正の難易度**: 低（フィールド追加のみ、ただし DataModel 未使用のため template.json への追加になる）

**フェーズ0 で扱うべきか**: No（フェーズ6の DataModel 移行時にまとめて対処）

---

## KI-006: "socket": true の未実装

**概要**
`system.json` で `"socket": true` を宣言しているが、`game.socket.emit()` / `game.socket.on()`
の実装が存在しない。`game.tnx.refreshSheets()` は「全クライアントへの再描画要求」を意図して
いるが（コメント `[All Clients]`）、実際には自クライアントのみで動作する。

**該当ファイル・箇所**
- `system.json:153` (`"socket": true`)
- `scripts/tnx.mjs:141-152` (`handleRefreshSheets`)

**影響範囲**
その他。カード操作後の他クライアントの UI が自動更新されない。マルチプレイヤー時に影響。

**修正の難易度**: 中

**フェーズ0 で扱うべきか**: No（シート表示・基本動作には関係しない。フェーズ5 以降で対処）

---

## KI-007: tap アイテムの conbatSpeedMod タイポ

**概要**
`template.json` の tap アイテム定義に `"conbatSpeedMod"` というタイポ（combat → conbat）がある。
コード中にこのフィールドへの参照は確認されていない。

**該当ファイル・箇所**
- `template.json` (tap アイテム定義)

**影響範囲**
その他。現時点では参照コードが存在しないため実質的な影響はない。
将来 tap のサポートを実装する際に混乱の原因になりうる。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: No（影響なし。フェーズ7 の outfit 系実装時に修正）

---

## KI-008: EXP 計算の連鎖更新による競合リスク（設計上の課題）

**概要**
`updateCastExp()` が `ready` フックで登録された `updateItem` / `updateActor` ごとに呼ばれ、
内部で `actor.update()` を行う。`{calcExp: false}` で直接的な再帰は防いでいるが、複数アイテムを
一括更新した場合（例: createEmbeddedDocuments でスキルを一括インポート）、アイテム数分の
`updateCastExp()` が並列に走り、同数の DB 書き込みが競合する可能性がある。

**該当ファイル・箇所**
- `scripts/tnx.mjs:909-917` (ready フック内の EXP 再計算登録)
- `scripts/actor/tnx-cast-sheet.mjs:1424` (`updateCastExp` static メソッド)

**影響範囲**
その他。通常のアイテム単体の更新では問題は発生しない。
初期技能の一括インポート（`setupDefaultSkills`）時に競合が起きる可能性がある。

**修正の難易度**: 高（設計レベルの変更が必要）

**フェーズ0 で扱うべきか**: No
CLAUDE.md の禁止事項「既存の EXP 計算ロジックを書き換える」に該当する。
表出する問題が確認されてから対処する。

---

## KI-009: EffectsSheetMixin の適用方式が2系統（設計上の課題）

**概要**
CastSheet はインスタンスプロパティへの代入で Mixin を適用し
（`_onCreateEffect = EffectsSheetMixin._onCreateEffect` 等）、ItemSheet は
`activateEffectListListeners()` の静的呼び出しで使う。さらに KI-001 の action 名不一致と
合わさり、ItemSheet での Mixin の動作が統一されていない。

**該当ファイル・箇所**
- `scripts/actor/tnx-cast-sheet.mjs:21-24` (インスタンスプロパティ代入)
- `scripts/module/effects-sheet-mixin.mjs:34` (静的呼び出し)

**影響範囲**
その他。KI-001 を修正すれば ItemSheet でも動作するようになる。
将来の Mixin 拡張時に混乱の原因になりうる。

**修正の難易度**: 中

**フェーズ0 で扱うべきか**: No（KI-001 の修正で動作は回復する。設計の統一はフェーズ6）

---

*最終更新: 2026-05-19*
