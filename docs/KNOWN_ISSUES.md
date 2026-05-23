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

## KI-007 [解消済み]: tap アイテムの conbatSpeedMod タイポ

**概要**
`template.json` の tap アイテム定義に `"conbatSpeedMod"` というタイポ（combat → conbat）があった。
コード中にこのフィールドへの参照は確認されていなかった。

**該当ファイル・箇所**
- `template.json` (tap アイテム定義)

**影響範囲**
その他。参照コードが存在しなかったため実質的な影響なし。

**解消**: 2026-05-23、B-6a にて `TapDataModel`(`scripts/data/item/tap.mjs`)を正しい綴り
`combatSpeedMod` で定義することで解消。`template.json` の tap エントリも同時に削除。
実運用前でマイグレーション対象のデータが存在しないため、マイグレーション機構は導入しない。

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

## KI-010: combatSpeed (CS) がシートに表示・入力できない

**概要**
`template.json` で `attributes.combatSpeed.value` 等が定義されているが、
シートテンプレート（cast-sheet.hbs 等）に表示・入力する UI が存在しない。
このため P0-04 で修正した initiative 式 `@system.combatSpeed.value` が機能しても、
値は常にデフォルトの `0` になる。

**確認済み**: `templates/` ディレクトリ全体を検索しても `combatSpeed` への参照は存在しない。

**該当ファイル・箇所**
- `templates/actor/cast-sheet.hbs`（表示・入力 UI が未実装）
- `template.json`（フィールド定義は存在: `attributes.combatSpeed`）

**影響範囲**
コンバットトラッカーでイニシアチブをロールしても、全キャストの値が `0` になる。
P0-04 で initiative 式を正しいパスに修正済みだが、参照先フィールドをシートから
操作できないため、機能としては未完成のままである。

**修正の難易度**: 中（ルール上の CS 算出方法を確定する必要があり、設計議論が必要）

**フェーズ0 で扱うべきか**: No
フェーズ3（コンバットトラッカー改修）で戦闘進行全体と合わせて設計する。
ルール解釈に関わるため、ユーザーの判断が必要。

---

## KI-011: ジャーナルディレクトリのカスタム「作成」メニューが v13 で機能しない

**概要**
v13 で `JournalDirectory` が `DocumentDirectory` → ApplicationV2 ベースに刷新された結果、
`renderJournalDirectory` フック内の `.create-document` セレクタが指す要素が DOM 上に存在しなくなり、
「アクトシートを作成」を含むカスタムメニューが UI に表示されない。

v12 では `.create-document` CSS クラスのボタンが存在したが、v13 では作成ボタンの実体が
`data-action="createEntry"` 属性を持つ要素に変わっている。加えて、v13 でのモダンな
差し込み方は `getHeaderControls` フックを利用してヘッダーコントロール配列にカスタムボタンを
追加する方式であり、render フック内での DOM 直接操作は推奨されなくなっている。

**確認済み**: `querySelector(".create-document")` が `null` を返し、ガード文で静かに return。
エラーログは出ないが「作成」カスタムボタンは表示されない。

**該当ファイル・箇所**
- `scripts/tnx.mjs` の `renderJournalDirectory` フックハンドラ（P0-07 で jQuery → DOM 化済み）

**影響範囲**
GM が「アクトシートを作成」コマンドを UI から実行できない。
`TnxScenarioSheet` クラスの登録自体は機能しているため、シート定義は活きている。
既存の JournalEntry に対して手動でシートクラスを指定すれば TnxScenarioSheet は利用可能。

**修正の難易度**: 高（v13 の `getHeaderControls` フックと ApplicationV2 の action API への適合、
および HUD 側の関連処理との整合性確認が必要）

**フェーズ0 で扱うべきか**: No

**担当フェーズ**: 未定。HUD/CSS の v13 対応（フェーズ5）または TnxScenarioSheet の
ApplicationV2 移行（フェーズ6）と統合して設計する可能性が高い。

---

## KI-012: ホットバー自動折りたたみが v13 で機能しない

**概要**
v13 以降、Foundry コアからホットバーの折りたたみ機能自体が削除されたため、
`renderHotbar` フック内および `tnx-hud.mjs` 内の自動折りたたみ処理は動作しない。
P0-09 で `querySelector` のエラーは解消したが、`#bar-toggle` 要素自体が v13 の
DOM に存在しないため、`toggleButton?.click()` 等の処理は no-op となる。

**確認済み**: ユーザーから v13 でホットバー折りたたみ機能自体が削除されていることの報告あり。

**該当ファイル・箇所**
- `scripts/tnx.mjs` の `renderHotbar` フックハンドラ
- `scripts/module/tnx-hud.mjs:135-145` 付近の関連処理

**影響範囲**
ホットバーの起動時自動折りたたみが機能しない。
v13 以降ホットバーは展開状態が標準となるため、機能の不在は v13 の仕様に合致する。
画面レイアウト上、HUD と通常のホットバーが共存する形となる。

**修正の難易度**: 中（機能削除の要否判断と関連コードの整理が必要）

**フェーズ0 で扱うべきか**: No

**担当フェーズ**: フェーズ5（HUD/CSS の v13 化）。
v13 でホットバー折りたたみ機能自体が無くなっている以上、関連コードを削除するか、
別の UI レイアウト方針（例: HUD 側でホットバー位置を考慮した配置）に転換するかを
HUD 全体の再設計と合わせて判断する。

---

## KI-013: TnxHud が Foundry 標準 UI と衝突している

**概要**
TnxHud は Foundry コアの UI レイヤーとは別レイヤーに描画されている。v13 で
Foundry コアの HUD/UI が刷新された結果、TnxHud と標準 UI が画面上で物理的に
衝突し、押せないボタンや見えない領域が発生している。

**確認済み**: ユーザーから v13 環境で実機による視認確認あり。
具体的な衝突箇所のスクリーンショット記録は未実施（フェーズ5 着手時に実施予定）。

**該当ファイル・箇所**
- `scripts/module/tnx-hud.mjs`（TnxHud クラス全体）
- `styles/`（HUD 関連の CSS）

**影響範囲**
GM・プレイヤーの UI 操作性。特定の Foundry 標準機能へのアクセスが妨げられている
可能性がある。

**修正の難易度**: 高（TnxHud の存在の仕方そのものを再設計する必要がある）

**フェーズ0 で扱うべきか**: No

**担当フェーズ**: フェーズ5（HUD/CSS v13 化）

**フェーズ5 の前提となる調査事項**:
- v13 で TnxHud を Foundry の標準 UI レイヤーに組み込む方法（ApplicationV2 化等）
- 別レイヤーのまま標準 UI を塞がない配置方法
- 常駐 HUD という形態そのものを見直すべきかの検討

**関連項目**: KI-011（ジャーナル「作成」メニュー）、KI-012（ホットバー折りたたみ）も
HUD/UI 関連で、フェーズ5 で統合的に扱う候補。

---

## KI-014 [解消済み]: switch case 内の lexical declaration

**概要**
`scripts/module/effects-sheet-mixin.mjs:44` の switch 文の case ブロック内で `let`/`const`
による変数宣言が行われている。これは ESLint の `no-case-declarations` ルールに該当する。
case ブロックを `{}` で囲むことで解消可能。

**確認済み**: フェーズA-3 の ESLint 導入時に検出。

**該当ファイル・箇所**
- `scripts/module/effects-sheet-mixin.mjs:44`

**影響範囲**
その他。現状の動作には影響しないが、case ブロック間で変数のスコープが意図せず共有される
リスクがある。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: No

**解消**: 2026-05-21、フェーズA-3 にて `case "create":` ブロックを `{}` で囲むことで修正。
リント基盤整備(ESLint 導入)との整合のため対応を前倒しした。

---

## KI-015 [解消済み]: 等価比較演算子の使用

**概要**
`scripts/tnx.mjs:707` で `==` を用いた比較が行われている。これは ESLint の `eqeqeq` ルールに
該当し、型変換による予期せぬ挙動を避けるため `===` への置き換えが推奨される。

**確認済み**: フェーズA-3 の ESLint 導入時に検出。

**該当ファイル・箇所**
- `scripts/tnx.mjs:707`

**影響範囲**
その他。現状の動作に問題は確認されていないが、比較対象の型次第で予期せぬ真偽判定が起こる
リスクがある。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: No

**解消**: 2026-05-21、フェーズA-3 にて `==` を `===` に変更。`item.type` は常に文字列型であり
動作変更なしと確認の上で修正。リント基盤整備(ESLint 導入)との整合のため対応を前倒しした。

---

## KI-016: template.json のフィールド型の妥当性疑問

**概要**
`template.json` の outfitBase 系フィールド（`exclusive`、`hide` 等）は、名称から Boolean を
想起させるが、初期値として文字列 `"-"` が設定されている。B-2 の DataModel 化では
template.json の現状を忠実に再現し `StringField` で実装したが、本来の意図が Boolean である
可能性が残る。

**確認済み**: B-2 実装時に template.json を直接確認。`exclusive` 等が `"-"` で初期化されて
いることを確認した。一方、`isPrepared`、`isOption`、`isCyber`、`isPre-play` は正しく
Boolean として定義されており、一部のフィールドのみが String 型に留まっている。

**該当ファイル・箇所**
- `template.json`（outfit 系 Item の outfitBase テンプレート定義）
- `scripts/data/item/common/outfit-base.mjs`（DataModel 実装、現状 StringField で追従）

**影響範囲**
その他。現時点では template.json の値をそのまま使う実装になっているため、動作上の
問題は発生しない。将来シートや判定処理でこれらのフィールドを Boolean として扱おうと
した場合に型ミスマッチが顕在化する可能性がある。

**修正の難易度**: 中（既存データとの互換性確保のため、データマイグレーションが必要）

**フェーズ0 で扱うべきか**: No

**担当フェーズ**: B-8（移行後の検証）または将来フェーズでルール確認のうえ対応。
B-6 ではマイグレーション機構を導入しないため、型変更を行う場合は B-8 以降に改めて設計する。
Boolean が正しいかはユーザー確認が必要。

---

## KI-017: tnx-cast-sheet.mjs の未使用デッドコード

**発見**: 2026-05-22(B-4 事前調査)  
**ファイル**: `scripts/actor/tnx-cast-sheet.mjs`

**症状**  
以下のメソッドが定義されているが、コード内に呼び出し元が存在しない:

- `_getHistoryData()` (line 1364)
- `_saveHistoryData()` (line 1374)

これらは `_sortHistory()` を内部で呼び出しているが、`_sortHistory` 自体もコード内で未定義。
現状は呼ばれないため実害はないが、誤って呼び出された場合クラッシュする。

**確認済み**: `grep -rn "_getHistoryData\|_saveHistoryData\|_sortHistory"` で呼び出し元が存在しないことを確認(2026-05-22)。

**影響範囲**  
その他。現在の動作には影響しない。

**修正の難易度**: 低(削除するだけ)

**担当フェーズ**: フェーズ6(既存シートの ApplicationV2 完全移行)。  
シート全体の書き換えと合わせて整理する。B-4 のスコープ外。

---

## KI-018: styleSkill.RewritedTarget のタイポ

**発見**: 2026-05-23(B-7b DataModel 化)  
**ファイル**: `scripts/data/item/style-skill.mjs`、`template.json`(削除済み)

**症状**  
フィールド名 `RewritedTarget` は誤綴りで、正しくは `RewrittenTarget`。
DataModel 定義・シート参照・template.json すべてで同じ誤綴りが使われている。

**確認済み**: B-7b 事前調査(2026-05-23)。

**影響範囲**  
styleSkill の書き換えターゲット機能。現状は一貫して誤綴りのため動作に影響はない。

**修正の難易度**: 低〜中(DataModel・シート参照・既存データの3箇所で追従が必要)

**担当フェーズ**: フェーズ6(既存シートの ApplicationV2 完全移行)。  
シート全体のリネームと合わせて整理する。B-7b のスコープ外。

---

## KI-019: styleSkill.RewritingMiracle_ID の命名規約違反

**発見**: 2026-05-23(B-7b DataModel 化)  
**ファイル**: `scripts/data/item/style-skill.mjs`、`template.json`(削除済み)

**症状**  
フィールド名 `RewritingMiracle_ID` は本プロジェクトの camelCase 命名規約に違反している
(正しくは `rewritingMiracleId`)。また先頭が大文字であり、フィールド名の一般規約とも
合わない。DataModel 定義・シート参照・template.json すべてで同じ命名が使われている。

**確認済み**: B-7b 事前調査(2026-05-23)。

**影響範囲**  
styleSkill の書き換え神業 ID 参照機能。現状は一貫して命名が統一されているため動作には影響しない。

**修正の難易度**: 低〜中(DataModel・シート参照・既存データの3箇所で追従が必要)

**担当フェーズ**: フェーズ6(既存シートの ApplicationV2 完全移行)。  
シート全体の命名整理と合わせて対応する。B-7b のスコープ外。

---

*最終更新: 2026-05-23*
