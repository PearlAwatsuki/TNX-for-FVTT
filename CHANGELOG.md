# Changelog

このプロジェクトの全ての注目すべき変更はこのファイルに記録される。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

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
- フェーズB-8: Card type の DataModel 化
  - `CardBaseTemplate` を `scripts/data/card/common/` に実装
  - `PlayingCardsDataModel`, `NeuroCardsDataModel`, `OtherDataModel` を実装し `CONFIG.Card.dataModels` に登録(全 3 type 完了)
  - テスト 12 件追加(計 542 件)
- フェーズB-9: description の HTMLField 化 / template.json 廃止
  - `BaseTemplate`, `CardBaseTemplate`, `BiographyTemplate` の description を `HTMLField` に変更
  - `tests/setup.mjs` に `MockHTMLField` 追加
  - `tests/template-integrity.test.mjs` を documentTypes ベースに書き換え
  - テスト 2 件追加(計 544 件)

### Changed
- フェーズB-9: `system.json` の `documentTypes` に `"htmlFields": ["description"]` を宣言
  (Item 全 17 type / Card 全 3 type / Actor: cast・guest・extra)

### Removed
- フェーズB-9: `template.json` を廃止(type 定義の権威が `system.json` の `documentTypes` に一本化)

### Fixed

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
