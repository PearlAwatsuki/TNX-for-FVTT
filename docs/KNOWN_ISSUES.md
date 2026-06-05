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
設計議論を経ずに改変しないこと」に該当するため、フェーズ7(判定システムの設計)の設計議論で取り扱う。

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
フェーズ11(戦闘進行/サブシーン)に先立って修正しておくべき。

**修正の難易度**: 低

**フェーズ0 で扱うべきか**: Yes（シートの基本動作には直接影響しないが、誤ったデータ定義の
放置は後のフェーズへの影響が大きいため、この機会に修正する）

---

## KI-005 [解消済み(ベース連携)]: handMaxSize 所有モデル確定 + ゲーム設定連携

**解消**: 2026-06-05、フェーズ2 締めジョブ(v0.3.1)にて以下を実施し、層①②を解消。

- **所有モデル確定**: 手札上限の権威を User flag に一本化。`ActorBaseTemplate.handMaxSize`
  フィールドを削除し、全 Actor type(cast / guest / troop / extra)から手札上限フィールドが消えた。
- **ゲーム設定連携**: `resolveEffectiveHandMaxSize(user)` を新設。User flag に個別値が明示設定
  されていればその値、未設定の場合はゲーム設定 `defaultHandMaxSize` を返す。
  `FLAG_DEFAULTS` 経由ではなく生 flag を参照することで「未設定」と「明示的に設定した 4」を
  正しく区別する。
- **消費側統一**: `tnx-action-handler.mjs` の全 handMaxSize 参照(drawCard・takeFromDiscard・
  dealInitialHands・drawMultipleCardsFromDeck)をリゾルバ経由に張り替え。
  cast Actor の `system.handMaxSize` 直接参照は完全に除去済み。

**残存する課題 → KI-020 へ移管**:
ActiveEffect による handMaxSize 修正(層③)は、効果を載せる Actor と権威たる User flag の合流
方式の設計が前提となるため、本ジョブでは実装しない。

---

## KI-020: handMaxSize への ActiveEffect 修正が未実装

**発見**: 2026-06-05(フェーズ2 締め調査 — KI-005 三層分析の層③)

**概要**
ゲーム設定 `defaultHandMaxSize` → User flag フォールバック → User 個別値 という三層設計
のうち、層③「ActiveEffect による修正」が設計・実装ともに存在しない。

コードベースに `handMaxSizeMod` への参照は現状 0 件・未定義。

**申し送り**:
- 効果を載せる Actor(キャスト等)と権威たる User flag の合流方式の設計が前提。
- `handMaxSizeMod` フィールドの要否・配置・型はその設計で確定する。
- 派生値計算パイプライン(`prepareDerivedData` 等)の整備と連動する。

**影響範囲**
手札上限バフが機能しない。デフォルト上限と個別設定は正常動作する。

**修正の難易度**: 高(派生値計算パイプラインの設計変更が必要)

**担当フェーズ**: ActiveEffect フェーズ(フェーズ4〜6 の間に新設、位置は今後確定)

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

**フェーズ0 で扱うべきか**: No（シート表示・基本動作には関係しない。フェーズ1 以降で対処）

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

**フェーズ0 で扱うべきか**: No（KI-001 の修正で動作は回復する。設計の統一はフェーズ3(既存シート ApplicationV2 移行)）

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

**担当フェーズ**: フェーズ4(既存シートの内容追加・改修)。combatSpeed は既存 cast シートへの
追加機能であり、フェーズ4 で他の不足機能と合わせて対処する。ルール解釈に関わるため、ユーザーの判断が必要。

---

## KI-011 [解消済み]: ジャーナルディレクトリの「アクトシートを作成」導線が v13 で機能しない

**概要**
v13 で `JournalDirectory` が `DocumentDirectory`(ApplicationV2)ベースに刷新された結果、
旧 `.create-document` セレクタが DOM 上に存在しなくなり、カスタム作成メニューが表示されなかった。
また、調査の結果 `JournalEntry` はサブタイプ(type)を持たないドキュメントであるため、
Actor/Item のような「作成ダイアログでシート種別をドロップダウン選択する」方式は
コアの仕組み上実現できない。

**解消**: 2026-05-24、フェーズ1-1 にて実装・実機確認済み。
- `renderJournalDirectory` フックで `[data-action="createEntry"]` ボタンの直後に
  「アクトシートを作成」ボタンを1つ挿入する方式を採用(フォールバック方式)。
- 「資料を作成」はコア標準の createEntry ボタンに委ね、独自ボタンは1つに簡素化。
- 旧2択ドロップダウンメニュー(`.tnx-create-menu`)は廃止。

**実機確認**: GM でジャーナルサイドバーを開くと「アクトシートを作成」ボタンが表示され、
押下で TnxScenarioSheet が正しく開くことを確認済み。

**なぜ getHeaderControls 方式ではなくフォールバックを採用したか**:
v13 の `ApplicationV2` ヘッダーコントロールに外部コードから `onclick` 相当を注入する
正確な API が一次情報なしには確認できず、動作保証が困難なため。フォールバック方式が
確実に機能する方式として選択。

**現行のボタン設置方式が最終形**:
- `JournalEntry` はサブタイプを持たないためドロップダウン選択は実現不可(コア制約)。
- `JournalEntryPage` のカスタムサブタイプ化でページ単位の型選択は技術的には可能だが、
  documentTypes 登録によりワールドグローバルに有効化され通常ジャーナルのページメニューにも
  混入するため**不採用**。現行のフラグ+独自タブ UI 方式を維持する。
- 詳細は DESIGN_REVIEW.md「アクトシートのページ化検討と不採用」エントリを参照。

**該当ファイル・箇所**
- `scripts/tnx.mjs` の `renderJournalDirectory` フックハンドラ

---

## KI-012 [解消済み]: ホットバー自動折りたたみが v13 で機能しない

**概要**
v13 以降、Foundry コアからホットバーの折りたたみ機能自体が削除されたため、
`renderHotbar` フック内および `tnx-hud.mjs` 内の自動折りたたみ処理は動作しない。
`#bar-toggle` / `#action-bar` 要素が v13 の DOM に存在せず、すべて no-op の死コードだった。

**確認済み**: ユーザーから v13 でホットバー折りたたみ機能自体が削除されていることの報告あり。

**解消**: 2026-05-24、フェーズ1-0 にて以下の死コードを削除。
- `scripts/tnx.mjs`: `renderHotbar` フックハンドラ(コメント含む)ごと削除
- `scripts/module/tnx-hud.mjs`: `bottomBar` / `actionBar` / `hotbarCollapseButton`
  の取得および `if` ブロック全体を削除

v13 ではホットバー展開状態が標準であり、機能の不在が正しい状態。
新しい代替実装は追加しない。

**備考**: `tnx-hud.mjs` のサイドバー連動コード(`#sidebar` / `#sidebar-tabs a.collapse`)は
別件(V13_MIGRATION_NOTES.md §7)であり、今回のスコープ外。フェーズ5(CSS/デザイン)での検討事項として残す。

---

## KI-013 [解消済み]: TnxHud が Foundry 標準 UI と衝突している

**概要**
TnxHud は Foundry コアの UI レイヤーとは別レイヤーに描画されている。v13 で
Foundry コアの HUD/UI が刷新された結果、TnxHud と標準 UI が画面上で物理的に
衝突し、押せないボタンや見えない領域が発生していた。

**解消**: 2026-05-24、フェーズ1-2 にて CSS 座標調整・実機確認済み。
各 HUD エリアがカード操作可能な状態で v13 標準 UI と重ならないことを確認。

**対処内容（`css/tnx.css` 座標調整）**:

| セレクタ | 変更前 | 変更後 | 根拠 |
|---|---|---|---|
| `.hud-top-right` `top` | `5px` | `50px` | v13 トップナビ・シーンコントロールを回避 |
| `.hud-top-right` `right` | `310px` | `360px` | サイドバー(~305px)+シーンコントロール(~50px)を回避 |
| `.hud-main-cards` `bottom` | `10px` | `80px` | サイドバー下部/プレイヤーリストを回避 |
| `.hud-main-cards` `right` | `310px` | `360px` | 同上 |
| `.hand-area` `max-width` | `914px` | `680px` | 1280px 幅画面で右UI に届かない範囲(5枚) |

また死にルール3件(`sidebar-collapsed` / `hotbar-is-collapsed` 依存)を削除。

**残存する軽微な課題(機能的支障なし)**:
- 収納時に右サイドバーとのわずかな視覚的近接が残るが、カード操作への支障なし。
- ピクセル単位の追い込みはフェーズ2 の V2 化方式変更で行う(今 CSS で詰めると捨てる手間になる)。

**申し送り(フェーズ2 への)**:
- **根本解消はフェーズ2**: `position: fixed` の独立レイヤー方式の限界は CSS 調整では
  超えられない。TnxHud を ApplicationV2 化して v13 標準 UI 領域に組み込むことで
  画面解像度への自動追従が実現する。
- **将来の HUD 拡張予定地(再設計時に維持する構造)**:
  - 左上 = TokenActionHUD のデフォルト位置として空けたまま
  - 右側縦一列の三層構造を維持(上=シーン/ニューロ、中段=将来の情報項目エリア予定、下=山札/捨て札)
  - 空き領域のどこかに他 PC 手札の小型表示を将来追加予定

**該当ファイル・箇所**
- `css/tnx.css`（HUD 座標定義）
- `scripts/module/tnx-hud.mjs`（V2 化はフェーズ2 で実施）

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

## KI-016 [解消済み]: outfitBase フィールド型の妥当性確認

**概要**
`scripts/data/item/common/outfit-base.mjs` の outfitBase 系フィールド（`exclusive`、`hide` 等）は、
名称から Boolean を想起させるが、DataModel では `StringField` で実装されている。
本来の意図が Boolean または Number である可能性が残っていた。

**確認済み**: B-2 実装時に元の template.json を確認し、B-9 にてユーザーが最終確認。

**該当ファイル・箇所**
- `scripts/data/item/common/outfit-base.mjs`（DataModel 実装）

**影響範囲**
その他。型確認の結果、現状の実装で問題なし。

**ユーザー確認結果(2026-05-24 最終確定)**:
- `exclusive`: 「専用条件」を表す**文字列**フィールド。数値と文字列表現の両方を取りうるため
  `StringField` 維持が正しい。型変更不要。
- `hide`: 「発見目標値」を表すフィールド。数値と文字列表現の両方を取りうるため
  `StringField` 維持が正しい。型変更不要。
- いずれも Boolean ではなく、StringField 維持で妥当と確定。

**解消**: 2026-05-24、B-9 にてユーザー確認の上クローズ。型変更・マイグレーション不要。

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

**担当フェーズ**: フェーズ3(既存シートの ApplicationV2 移行)。  
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

**担当フェーズ**: フェーズ3(既存シートの ApplicationV2 移行)。  
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

**担当フェーズ**: フェーズ3(既存シートの ApplicationV2 移行)。  
シート全体の命名整理と合わせて対応する。B-7b のスコープ外。

---

*最終更新: 2026-06-05(フェーズ2 締め — KI-005 をベース連携解消でクローズ。KI-020 を新規起票(ActiveEffect 修正層③))*
