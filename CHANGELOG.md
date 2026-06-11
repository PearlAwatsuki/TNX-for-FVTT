# Changelog

このプロジェクトの全ての注目すべき変更はこのファイルに記録される。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

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
