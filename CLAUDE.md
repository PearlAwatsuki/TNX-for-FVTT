# Project: tokyo-nova-fvtt

トーキョーN◎VA THE AXLERATION (TNX, 第5版) の Foundry VTT 用システム。

## ゲームシステム上の重要特性

- 判定はカード (Cards API) ベース。ダイスロールは使用しない。
- 1アクトを「シーン」の連なりとして進行する(シーン制)。
- 神業 (miracle) はゲーム進行を書き換える強力なブレイクスルー。通常の数値計算では
  表現できない挙動を多く持つ。
- 経験点はキャラクター(キャスト)ではなくプレイヤーに付与される (FEAR 系の特徴)。

## Foundry VTT バージョン

- 現状: v12 ターゲット (system.json: minimum 11, verified 12.343)
- 移行目標: v13 で動作する状態
- 段階的移行。一度に全てを書き換えない。

## 現在のフェーズ

フェーズ0: 土台を v13 で動かす
- v13 でキャラクターシートが正常表示されること
- 起動時のエラー・deprecation 警告の解消
- シート表示・基本動作に関わる既知バグの修正

## ロードマップ

- フェーズ0: 土台を v13 で動かす(現在)
- フェーズ1: 判定システムの設計と最小実装
- フェーズ1.5: 神業システムの設計(独立セッション)
- フェーズ2: 神業システムの最小実装
- フェーズ3 / フェーズ4: 戦闘進行(コンバットトラッカー改修) と
  サブシーン的仕組みの設計と実装(順序は着手時に判断)
- フェーズ5: HUD / CSS の v13 化
- フェーズ6: DataModel / ApplicationV2 への段階移行
- フェーズ7: 未実装シート(outfit系・guest/troop/extra)の追加

(注: 各フェーズの順序は今後変更されうる。現在のフェーズは明示すること)

## データモデル(現状)

- template.json 依存 (DataModel クラス未使用)
- Actor types: cast, guest, troop, extra, player
- Item types: style, miracle, generalSkill, styleSkill, weapon, armor, ianus,
  cyborg, tron, tap, vehicle, residence, housingArea, combiner, general,
  organization, lifePath
- 詳細は template.json を参照すること

## 主要モジュール

- TnxActionHandler: カード操作(checkFromDeck, drawCard, playCard, useTrump, drawNeuroCard)
- TnxHud: 常駐 HUD (ApplicationV1)
- TnxScenarioSheet: アクト用 JournalSheet
- TokyoNovaCastSheet.updateCastExp: ready フックで Actor/Item の CRUD に連動して
  EXP 再計算
- prepareData / prepareDerivedData のオーバーライドは現状なし(能力値はシート
  getData() で都度計算)

## 設計指針(今後の実装に向けて)

- 判定・特定効果の発動などの「アイテムロール」関連処理は、D&D 5e システムの設計思想を
  踏襲し、Item に紐づく「用途(usage)」ドキュメントのコレクションとして管理する。
  既存の usage テンプレート(actions[])および UsageCreationDialog はその基盤として
  設計されている。「用途を起動する」という共通インタフェースを上位に置く構造を目指す。
- 神業はゲーム進行に踏み込んで影響する処理が多く、システム側で機能を作り込む必要がある。
  設計はフェーズ1.5 で独立して扱う。
- プレイヤー単位の経験点管理は FEAR 系の重要な特徴。現状の player Actor 実装の設計を
  尊重し、安易な改変はしない。
- FVTT 標準の Scene 切り替えに依存せず、軽量にシーンを切り替えられるサブシーン的な
  仕組みを後のフェーズで設計する。

## 命名規約

- ファイル: kebab-case (tnx-cast-sheet.mjs)
- クラス: PascalCase (TokyoNovaCastSheet)
- パッケージID・フラグスコープは system.json を踏襲

## 実装方針

- 大きな変更前は必ずプラン提示 → 承認後に実装
- 1 PR (または1コミット) = 1 機能。複数の不具合修正を混ぜない
- データモデルのフィールド追加・改名は事前に承認を取る
- 既存の動作している機能を「改善のついでに」リファクタしない
- 現在のフェーズに該当しない作業は提案しない
- 「将来のために」拡張ポイントを先回りで作らない。必要になったときに追加する。

## やってはいけないこと

- ルールテキストやゲームデータをコードに埋め込む(著作権配慮)。enum 等の構造的な
  最小限のみ可。
- 達成値の計算式・神業の処理・シーン進行ルールなど、ゲームルール解釈に関わる判断を
  推測で実装する。必ずユーザーに確認すること。
- 神業 (miracle) に関する自動化処理は、ユーザーの明示的な設計合意なしに踏み込んだ
  実装を行わない。既存の usageCount 管理など、棚卸しで確認済みの範囲のメンテナンスは可。
- usage テンプレートおよび usage-list.hbs / UsageCreationDialog の構造を、設計議論を
  経ずに改変しないこと(判定システムの基盤となるため)。
- システム全体の書き換え提案
- 動作確認なしの大規模移行
- 既存の EXP 計算ロジックを「効率化のため」と称して書き換える(複雑なルール上の事情が
  あるため)

## 既知の不具合

詳細は docs/KNOWN_ISSUES.md を参照すること。
