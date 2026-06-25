# Changelog

このプロジェクトの全ての注目すべき変更はこのファイルに記録される。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

## [0.9.0] - 2026-06-24

フェーズ9（ActiveEffect / 派生値計算パイプライン）完了。派生値計算（実効値）を一本化し、v2 ActiveEffect 適用モデルとコンディション（バッドステータス・戦闘不能・負傷）基盤を実装。行動制限・継続ダメージ・回復の発火、ダメージ算出本体はフェーズ12 以降に分離。

### Added
- **派生値パイプライン**（`CastDataModel.prepareDerivedData`）: 能力値/制御値の実効値（`total` / `totalControl`）一本化・最終値 0clamp、outfitMod / appearanceModifier の B-2 派生化。KI-021 解消
- **v2 ActiveEffect 適用モデル**: base / total 分離、total へネイティブモード（加算/上書き/乗算）直接適用。値バフ `system.<名前空間>`、判定バフ `check.` / `controlCheck.`、条件付きキー。同一効果の重複適用不可＋重複可チェックボックス
- **判定バフ表示**: 判定結果チャットに「判定ボーナス」と寄与エフェクト内訳（開閉式）
- **コンディション**（`CONDITION_KINDS`）: バッドステータス・戦闘不能・負傷を統合。効果値の固定/可変区別、詳細タブの効果値フィールド、判定・派生への適用（酩酊 / 衰弱 / 重圧 / 電子妨害）
- **ダメージチャート**: 肉体 / 精神 / 社会 ×0〜21 段の負傷名・付与条件を同梱（効果文のみユーザー入力）。効果文の設定アプリ、`applyDamageChartResult`、狼狽 BS
- **状態カスケード**: `inflicts` で別状態を自動付与（状態のみ）。ダメージ由来 AE は効果リスト非表示
- **カードドロー**（衰弱 / 重圧の効果値決定）・**controlNegate**（制御判定成功で無効 / 降格）
- **KI-020 解消**: 手札上限への AE 修正（cast の `handMaxSizeMod` 着地＋3層解決）

### Changed
- `CONFIG.ActiveEffect.legacyTransferral = false`、効果列挙を `allApplicableEffects()` へ
- アウトフィット分類にコードキー＋表示値を導入（`category.melee` 等で指定可能に）

### Removed
- `effectMod` 着地フィールド全廃（v2: バフは total へ直接適用）、旧モードB の死蔵ヘルパー撤去

### Fixed
- 衰弱のスート手動選択 UI 撤去（対象・数字は引いて決まる）
- コンディションの kind を `statuses` から判定（効果値欄が出ない不具合）。1 つの AE が複数 BS を持つ場合に対応
- status 選択のグループ化が v13 `<multi-select>` を壊す不具合を修正（Foundry ファクトリで再実装）

## [0.8.0] - 2026-06-20

フェーズ7（判定システム設計）・フェーズ8（判定システム実装）完了。TNX の基本判定フロー（能力/技能/制御判定）を全面実装。攻撃判定＋ダメージ算出はフェーズ12 に分離。

### Added
- **判定エンジン**（`TnxJudgmentEngine`）: カード値計算・技能判定・制御判定・組み合わせスート積集合計算
- **判定フロー**（`TnxJudgmentFlow`）: シングルトン状態管理。手札クリック・山札判定・報酬点入力・切り札消費をサポート
- **判定ダイアログ**（`TnxJudgmentDialog`）: コンテキスト（種別・使用可能スート・目標値）表示。×ボタンで判定キャンセル
- **RL 判定要求**（`TnxRlRequestApp`）: GM がシーンコントロールから判定要求チャットカードを送信。対象 PL の「判定する」ボタンから起動。socket 経由で結果反映（KI-006 解決）
- **TnxUsageSheet**（`ApplicationV2`）: 用途エントリの専用編集シート。タブ構成（基本 / 発動 / 効果）、`submitOnChange` 自動保存（KI-002 解決）
  - 発動タブ: タイミング・対象・射程・目標値（＋「その他」自由入力）・変更不可（※）・対決不可。参加技能の対決を読み取り「リアクション例」を表示
  - **参加技能から自動入力**: ベース技能＋組み合わせ技能の固有値（対象/射程/目標値/タイミング）を優先度（対象優先度・射程優先度・目標値は最大）で合成して発動欄へ反映（ボタン式）
  - 効果タブ: 種別固有設定（コンボ/武器/ダメージ/改造）＋「適用される効果」を統合。ActiveEffect はセレクトで追加・行から解除（D&D 方式）
- **使用回数の消費**: 判定（用途）起動時に参加技能の使用回数を消費。D&D 方式の消費ダイアログ（原則ブロック・チェック解除で消費回避）、組み合わせ技能の遠隔消費。消費確定は起動時・減算は実行時
- **ソケット基盤**（`TnxSocketHandler`）: `judgmentResult` メッセージタイプで PL → GM への判定結果送信を実装
- HUD のカード達成値プレビュー（ホバー時のみバッジ表示）・空手札エリアクリックで補充
- キャストシートの技能行クリックで技能判定を起動（用途ベースのコンボ自動解決）
- キャストシートの能力値・制御値クリックで各判定を起動
- アクトシートのハンマーボタンから情報収集判定を起動
- `generalSkill` 新規作成時に判定用途（check タイプ）を 1 件自動挿入（`preCreateItem` フック）

### Changed
- **UsageTemplate DataModel 全面改訂**: `_id` / `timing` / `target` / `effects` / `baseSkillRef` / `weaponRef` / `damageType` / `formula` / `damageCategory` / `modifiableParams` フィールドを追加
  - 用途タイプを `check` / `attack` / `declaration` / `damageBoost` / `damageReduce` / `modification` の 6 種に確定
  - `_id` により用途をインデックスではなく ID で管理
  - `migrateData` で既存データに `_id` と `baseSkillRef` を自動付与
- `usage-list.hbs` を `data-usage-id` ベースに変更、種別タグ（バッジ）を追加
- アイテムシートの用途編集を `UsageCreationDialog` から `TnxUsageSheet` に移行
- **usage DataModel に発動系フィールドを追加**: `target`/`targetOther`/`isFixedTarget`・`range`/`rangeOther`/`isFixedRange`・`targetValue`/`targetValueNumber`/`targetValueOther`・`isUnopposable`（スタイル技能と同形）
- **使用回数を消費済み（spent）管理に変更**: `uses.value`（残り）→ `uses.spent`（消費済み、残り = max − spent）。最大値だけ設定すれば残りは自動算出（style-skill / outfit）
- **mixin の静的 migrateData 合成**: `SystemDataModel.mixin()` が template の静的 `migrateData` を concrete モデルでも実行するよう修正（潜在的に死んでいた template マイグレーションを修復）
- `_onStartSkillCheck` を用途ベースに刷新: `baseSkillRef` からベース技能を解決し `skillRefs` + 親技能自動追加でコンボを構成
- RollTable ドロー表を 54 枚連続レンジ（ジョーカー 2 枠・その他各 4 枠）に刷新、ニューロデッキモードを再設計
- タイミング選択肢にダメージ算出・ダメージ適用前後・登場判定・舞台裏を追加

### Fixed
- `_patchUsage` を `mergeObject` から `setProperty` ループに変更（配列フィールドとドット記法キーの更新バグを解消）
- スタンドアロンアイテム（actor なし）で用途シートを開いた際のベース技能名 `(削除済み: ID)` 表示を修正
- 山札判定でカードが裏向き状態になりスートが null になるバグを修正
- 発動タブの条件付き入力欄（その他・数字）が、制御セレクトを別の選択肢に変えても古い値が残るバグを修正（変更時にリセット）

## [0.7.0] - 2026-06-14

フェーズ6（未実装シート追加）完了。outfit 系 Item 11 種・lifePath・キャストシートのアウトフィットタブを実装。

### Added
- 全 Item 型（未実装 12 種）に識別キー（identificationKey）を追加
- outfitBase に isCarrying（携帯中）・parentSlotKind・combineGroupId フィールドを追加
- **TokyoNovaOutfitSheet**（アウトフィット共通シート）を新設・general/weapon/armor/ianus/cyborg/tron/tap/vehicle/residence/combiner 10 種に登録
  - 説明タブ（型別概要サマリ + ProseMirror）/ 設定タブ / 用途タブ / エフェクトタブ
  - 準備済み・携帯中・プレアクト購入のヘッダーアイコントグル
  - 大分類→小分類の連動カテゴリドロップダウン（型に有効な小分類のみ提示）
  - タイミング・スロット・消費アイテム個数・modeValueField 系フィールドの編集 UI
- **TokyoNovaHousingAreaSheet** 新設（説明 + 修正値 7 種、住宅エリア辞典 compendium）
- **TokyoNovaLifePathSheet** 新設（説明 / 設定の 2 タブ）
- キャストシート「アウトフィット」タブを全面実装
  - 大分類別グループ（武器/防具/サイバーウェア/トロン/ヴィークル/住居/その他）+ グループ別固有列
  - 行内 isCarrying / isPrepared フラグトグルボタン
  - グループ内ドラッグ＆ドロップ並び替え
- キャスト DataModel に isGhost / bountyBase / baseGuard / appearanceModifier / outfitMod フィールドを追加
- アウトフィット集計の自動更新（createItem / deleteItem / updateItem フック + ready 時初期化）
  - 携帯中アウトフィットから `appearanceModifier`（危険値合算）を自動集計
  - 準備済み・携帯中フィルタで `outfitMod.control`・CS 修正（`outfitMod.combatSpeed`）を自動集計
  - `isGhost` 変更時に `outfitMod.combatSpeed` を再集計（ゴースト登場中は CS 修正無効化）
- キャストシートに報酬点 ±1 ホバーボタン・bountyBase 再計算ボタンを追加
- 住宅施設の住宅エリア紐付け（compendium ドロップダウン / アイテムドロップの 2 方式）
- コンバイナーのコンバイン連携（source1/source2 ドロップ・見た目選択・パラメータ取捨選択 UI）
- 名称マーカー表示ヘルパー（★/†/※/＠/末尾※、`tnxDecoratedName`）
- 住宅エリア辞典 compendium（`housing-areas`）を system.json に追加

### Changed
- outfitBase: buy / hide を `{mode, value}` SchemaField 化（mode = none/value/reference）
- outfitBase: preserveExp / appearancePenalty を `{mode,value}` 化（「なし/数値」2 状態に変更）
- outfitBase: majorCategory / minorCategory を choices 付き StringField 化
- outfitBase: timing を配列から単一 SchemaField に変更（アウトフィットのタイミングは一つのみ）
- outfitBase: part を `[{value, slots}]` 配列化（複数部位占有に対応）
- outfitBase: hack を nullable NumberField 化（なし=null、「-」表示）
- outfitBase: isOption を追加（別アウトフィットに装備するオプション品）
- outfitBase: isConsumption + quantity `{value,max}` で消費アイテムを一般化（旧 isthrow を廃止）
- extensible: slots[] を `{kind, count: {mode,value}}` プール方式に再設計
- weapon: attack を `{damageType, value}` 化（damageType は単一選択 S/P/I/X）、range を `{min, max}` の選択式に変更
- armor/cyborg/ianus/tap/vehicle 各フィールドを `{mode,value}` 化（guardValue/defence/controlMod/cycle/combatSpeedMod/speedFactor/passenger）
- `modeValueField()` ヘルパーを outfit-base.mjs 局所定義から helpers.mjs へ昇格（全モデルで共有）
- combiner: combinedOutfitID[] → combine `{source1, source2, appearance, params}` + isCombineActive に再設計
- lifePath: lifePathType の choices を確定（origin/experience/encounter + 空文字）
- troop: heads を `{value, max}` SchemaField 化
- キャストシート「判定」タブを「戦闘」タブに改称（内容整備はフェーズ11）
- キャストシートのアイテムリストで modeValueField 系フィールドを「-」または値で表示
- ProseMirror エディタをコンテンツ高に自動伸長

### Removed
- cast: player_name フィールドを削除（デッドフィールド確定、フェーズ6-0）
- outfitBase: isBiological を削除（カテゴリ「生体装備」で識別する方針に変更）
- housingArea: hideMod を削除（住宅エリアは住宅施設の隠匿値を修正しない）
- 全シートのフットノート（sheet-notes 注釈）を撤去（title 属性か wiki で代替）

### Fixed
- 全アウトフィット型に `static migrateData` を実装（旧 NumberField 形式 → `{mode,value}` 自動移行）
- キャストシートのアウトフィットリスト部位表示を新 `{value,slots}` 構造に追従
- isCyber ※マークをサイバーウェア大カテゴリには付与しない修正

## [0.6.0] - 2026-06-12

フェーズ5（修正・軽微な機能追加）完了。

### Added
- キャストシート詳細タブ
  - ライフパス 3 スロット（出自/経験/邂逅）。`lifePath` を `SchemaField({itemUuid, name, summary})` 構造に拡張し、ドラッグ＆ドロップでの割り当て・削除に対応
  - キャラクター説明 ProseMirror エディタ（シートの編集/閲覧モード切替に連動）
- HUD 機能追加
  - カラムごとの折りたたみ（両カラム flex 統一、収納時は完全に幅 0）
  - アクセスカード表示エリア（デフォルト折りたたみ）と、クリックで全員に画像提示する使用システム
  - プレイヤーの手札表示エリア（開示設定 `showPlayerHands`・カードを渡す機能込み）
- カードセットアップを設定メニューへ移行（`TnxCardSetupApp`、山札/手札/切り札/その他の 4 タブ、RL用切り札捨て場新設）
- ドロー表: RollTable のカードドロー拡張（コア保持のフック注入方式。仮想 DoC モード + 設定デッキモード）
- 報酬点（bounty）フィールドと一般技能の「報酬点を使用可能」フラグ
- 全実装済みアイテム型に識別キー（identificationKey）を追加
- 一般技能・スタイル技能のコンテキストメニューに「複製」を追加（初期技能は複製不可、名乗り初期分の複製は通常技能化）
- チャット通知のデフォルトを「通知バッジ」に変更（`core.chatNotifications` のデフォルト上書き）

### Changed
- 技能セクションの編集モードを閲覧モード踏襲のレイアウトに再設計
- キャストシートのコンテキストメニューを「閲覧/編集/削除」に統一（一般技能の閲覧モードに縦三点リーダーメニューを追加）
- 他プレイヤーへのカード渡しダイアログを Actor 選択 → User 選択に変更。切り札配布も User 直接配布化
- 所属未設定時の表示を「無所属」から「フリーランス」に変更
- 報酬点エリアをデータパネル風デザインに刷新

### Fixed
- 既存シートの表示バグ一式（コンテキストメニュー不動作、アイテムドロップ、スタイル技能シート各種、役割インジケーター再設計）
- v13 非推奨警告を全解消

## [0.2.0] - 2026-05-24

### Added
- フェーズB-1: Actor 共通 template の DataModel 化
  - `BiographyTemplate`, `AttributesTemplate`, `ActorBaseTemplate` を `scripts/data/actor/common/` に実装
  - `SystemDataModel` 基底クラスおよび `mixin()` ユーティリティを `scripts/data/abstract.mjs` に実装
- フェーズB-2: Item 共通 template の DataModel 化
  - `BaseTemplate`, `UsageTemplate`, `SkillBaseTemplate`, `OutfitBaseTemplate`, `ExtensibleTemplate` を `scripts/data/item/common/` に実装
- フェーズB-3: 単純な Actor type の DataModel 化
  - `GuestDataModel`, `TroopDataModel`, `ExtraDataModel` を実装し `CONFIG.Actor.dataModels` に登録
  - `template.json` から guest / troop / extra エントリを削除
  - テスト 63 件追加(計 201 件)
- フェーズB-4: 複雑な Actor type の DataModel 化
  - `CastDataModel`, `PlayerDataModel` を実装し `CONFIG.Actor.dataModels` に登録(全 5 type 完了)
  - `template.json` の Actor セクションを `types` 配列のみに整理(templates / cast / player エントリ削除)
  - `tests/setup.mjs` に `MockObjectField` 追加
  - テスト 57 件追加(計 258 件)
  - `docs/FUTURE_CONSIDERATIONS.md` 新設(Player Actor → User ベース移行の検討事項)
- フェーズB-5a: 単純な Item type(base のみ)3 種の DataModel 化
  - `HousingAreaDataModel`, `OrganizationDataModel`, `LifePathDataModel` を実装し `CONFIG.Item.dataModels` に登録
  - `template.json` から housingArea / organization / lifePath エントリを削除
  - テスト 25 件追加(計 283 件)
- フェーズB-5b: base + outfitBase の Item type 4 種の DataModel 化
  - `ArmorDataModel`, `CyborgDataModel`, `CombinerDataModel`, `GeneralDataModel` を実装
  - `scripts/data/item/helpers.mjs` 新設(`defenceField()` ヘルパー)
  - テスト 41 件追加(計 324 件)
- フェーズB-5c: base + outfitBase + extensible の Item type 3 種の DataModel 化
  - `IanusDataModel`, `TronDataModel`, `VehicleDataModel` を実装
  - テスト 23 件追加(計 347 件)
- フェーズB-6a: outfit 系 Item type 3 種の DataModel 化
  - `WeaponDataModel`, `TapDataModel`, `ResidenceDataModel` を実装
  - `helpers.mjs` に `attackField()` ヘルパーを追加
  - テスト 49 件追加(計 396 件)
- フェーズB-6b: skill 系 Item type 2 種の DataModel 化
  - `MiracleDataModel`, `GeneralSkillDataModel` を実装し `CONFIG.Item.dataModels` に全 15 type 登録
  - テスト 37 件追加(計 443 件)
- フェーズB-7a: style の DataModel 化
  - `StyleDataModel` を実装(ファイルローカル `abilityField()` で reason/passion/life/mundane の 2 フィールド構造を定義)
  - テスト 28 件追加(計 471 件)
- フェーズB-7b: styleSkill の DataModel 化(全 17 Item type 完了)
  - `StyleSkillDataModel` を実装し `CONFIG.Item.dataModels` に全 17 type 登録
  - template.json 未定義だがシートが参照する ★ フィールド 8 個を明示定義
    (maxLevelNumber / maxLevelOther / targetOther / rangeOther / targetValueNumber / targetValueOther / comboSkillOther / confrontationOther)
  - テスト 60 件追加(計 531 件)
- フェーズB-8: Card type の DataModel 化(全 3 type 完了)
  - `CardBaseTemplate` を `scripts/data/card/common/` に実装
  - `PlayingCardsDataModel`, `NeuroCardsDataModel`, `OtherDataModel` を実装し `CONFIG.Card.dataModels` に登録
  - テスト 12 件追加(計 542 件)
- フェーズB-9: description の HTMLField 化 / template.json 廃止
  - `BaseTemplate`, `CardBaseTemplate`, `BiographyTemplate` の description を `HTMLField` に変更
  - `tests/setup.mjs` に `MockHTMLField` 追加
  - `tests/template-integrity.test.mjs` を documentTypes ベースに全面書き換え
  - テスト 2 件追加(計 544 件)
- フェーズB-10: 移行後の実機検証完了
  - Foundry v13.351 上でキャラクターシート・アイテムシートの正常表示を確認
  - EXP 計算・カード操作・神業 usageCount の動作に破壊なしを確認

### Changed
- フェーズB-9: `system.json` の `documentTypes` に `"htmlFields": ["description"]` を宣言
  (Item 全 17 type / Card 全 3 type / Actor: cast・guest・extra)
- フェーズB-10: `packs/` を `.gitignore` に追加し、LevelDB ファイルの git 追跡を解除
  (GM が手入力するゲームデータはリポジトリ管理対象外)

### Removed
- フェーズB-9: `template.json` を廃止(type 定義の権威が `system.json` の `documentTypes` に一本化)
- フェーズB-10: `packs/` 配下の LevelDB ファイル群を追跡解除(git rm --cached)

### Fixed
- KI-007: tap アイテムの `conbatSpeedMod` タイポを `TapDataModel` で `combatSpeedMod` として正しく定義(B-6a)
- KI-016: `OutfitBaseTemplate` の `exclusive` / `hide` フィールドが `StringField` であることをユーザー確認で確定(B-9)

## [0.1.0] - 2026-05-21

### Added
- フェーズA: 開発基盤の整備
  - ライセンス・著作権・コントリビューション関連ドキュメント (A-1)
  - 設計ドキュメント基盤 (MECHANICS_AUDIT.md, DESIGN_REVIEW.md) (A-2)
  - テスト基盤 (Vitest) およびリント基盤 (ESLint) (A-3)
  - GitHub Actions による CI (A-4)
  - バージョニング・リリース方針 (A-5)

### Fixed
- KI-014: switch case 内の lexical declaration を解消
- KI-015: 等価比較演算子 `==` を `===` に変更

## [0.0.0] - 2026-05-20

### Added
- フェーズ0: v13 動作基盤の整備(初期コミット〜フェーズ0 完了サマリーまで)
