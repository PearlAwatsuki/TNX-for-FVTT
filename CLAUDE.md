# Project: tokyo-nova-fvtt

トーキョーN◎VA THE AXLERATION (TNX, 第5版) の Foundry VTT 用システム。

## 1. プロジェクト概要

### 1.1 ゲームシステム上の重要特性

- 判定はカード (Cards API) ベース。ダイスロールは使用しない。
- 1アクトを「シーン」の連なりとして進行する(シーン制)。
- 神業 (miracle) はゲーム進行を書き換える強力なブレイクスルー。通常の数値計算では
  表現できない挙動を多く持つ。
- 経験点はキャラクター(キャスト)ではなくプレイヤーに付与される (FEAR 系の特徴)。

### 1.2 プロジェクト運用方針

- 長期戦覚悟(カレンダー上 1.5〜2.5 年、累積実作業 400〜800h を見込む)
- 完走志向・公開志向(最終的に Foundry 公式に公開申請予定)
- 堅く作る(技術的負債を避ける)
- メカニクス監査(ルール解釈の正しさ)と設計レビュー(技術的妥当性)を別ドキュメントで管理
- ルール情報はユーザーが言葉で伝える。コード照合は Claude 側が行う。

### 1.3 ライセンス・著作権の方針

- 本リポジトリのコードは MIT ライセンスで配布する。
- Foundry VTT 自体は Foundry VTT Limited License Agreement for Package Development
  に基づく。
- 「トーキョーN◎VA THE AXLERATION」は「鈴吹太郎」「有限会社ファー・イースト・
  アミューズメント・リサーチ」および「株式会社KADOKAWA」の著作物であり、本プロジェクトは
  その二次創作物である。
- ルールテキスト・ゲームデータはリポジトリに同梱しない。GM が手で入力する前提で設計する。
- enum 等の構造的な最小限の値のみコードに含めてよい(判定ロジックの実装に必要な範囲)。

## 2. 現在の状況

### 2.1 Foundry VTT バージョン

- 現状: v13.351 で動作確認済
- system.json: minimum 11, verified 12.343(フェーズB の DataModel 移行後に更新予定)
- フェーズ0(v13 起動)は完了

### 2.2 現在のフェーズ ★

**フェーズA-1: ライセンス・著作権・コントリビューション関連の文書整備**

(セッション開始時、まずここを確認すること)

### 2.3 ロードマップ(完走志向版)

- フェーズ0: 土台を v13 で動かす ← 完了
- **フェーズA: 開発基盤整備**(現在)
  - A-1: ライセンス・著作権・コントリビューション関連の文書整備 ← 現在
  - A-2: 設計ドキュメント基盤
    (RULES_REFERENCE.md / MECHANICS_AUDIT.md / DESIGN_REVIEW.md)
  - A-3: テスト基盤の構築
  - A-4: GitHub Actions による CI 設定
  - A-5: バージョニング・リリース方針の決定
- フェーズB: DataModel への完全移行
- フェーズ1: 判定システムの設計と最小実装
- フェーズ1.5: 神業システムの設計
- フェーズ2: 神業システムの最小実装
- フェーズ3 / フェーズ4: 戦闘進行(コンバットトラッカー改修)と
  サブシーン的仕組みの設計と実装(順序は着手時に判断)
- フェーズ5: HUD / CSS の v13 化(TnxHud の v13 UI レイヤーへの整合化を含む)
- フェーズ6: 既存シートの ApplicationV2 完全移行
- フェーズ7: 未実装シート(outfit系・guest/troop/extra)の追加
- フェーズ8: 公開準備

(注: 各フェーズの順序は今後変更されうる。現在のフェーズは明示すること)

## 3. 設計とデータモデル

### 3.1 データモデル(現状)

- template.json 依存 (DataModel クラス未使用)
- Actor types: cast, guest, troop, extra, player
- Item types: style, miracle, generalSkill, styleSkill, weapon, armor, ianus,
  cyborg, tron, tap, vehicle, residence, housingArea, combiner, general,
  organization, lifePath
- 詳細は template.json を参照すること

### 3.2 主要モジュール

- TnxActionHandler: カード操作(checkFromDeck, drawCard, playCard, useTrump, drawNeuroCard)
- TnxHud: 常駐 HUD (ApplicationV1)
- TnxScenarioSheet: アクト用 JournalSheet
- TokyoNovaCastSheet.updateCastExp: ready フックで Actor/Item の CRUD に連動して
  EXP 再計算
- prepareData / prepareDerivedData のオーバーライドは現状なし(能力値はシート
  getData() で都度計算)

### 3.3 設計指針(今後の実装に向けて)

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

## 4. 開発ルール

### 4.1 命名規約

- ファイル: kebab-case (tnx-cast-sheet.mjs)
- クラス: PascalCase (TokyoNovaCastSheet)
- パッケージID・フラグスコープは system.json を踏襲

### 4.2 実装方針

- 大きな変更前は必ずプラン提示 → 承認後に実装
- 1 PR (または1コミット) = 1 機能。複数の不具合修正を混ぜない
- データモデルのフィールド追加・改名は事前に承認を取る
- 既存の動作している機能を「改善のついでに」リファクタしない
- 現在のフェーズに該当しない作業は提案しない
- 「将来のために」拡張ポイントを先回りで作らない。必要になったときに追加する。

### 4.3 やってはいけないこと

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

## 5. 運用

### 5.1 役割分担

- **ユーザー**: TNX ルールの言語化、最終判断、動作確認、git push 等の重要操作
- **チャット(claude.ai 上の Claude Opus 4.7)**: 設計議論、ルール引き出し、戦略判断、
  Claude Code に渡すプロンプトの組み立て
- **Claude Code (ターミナル CLI)**: コード調査、実装、ドキュメント作成

### 5.2 ご無沙汰期間の運用ルール

- **2週間以上空いたとき**: CLAUDE.md と現フェーズの TASKS.md を見直してから着手
- **1ヶ月以上空いたとき**: チャット(Opus 4.7)に「再開します」と相談
- **3ヶ月以上空いたとき**: docs/ から現状を再構築、新規チャットで再スタート

### 5.3 ドキュメント構成

- `CLAUDE.md`: 本ファイル。Claude Code 向けプロジェクト指針
- `docs/INVENTORY_REPORT.md`: 棚卸し結果(静的)
- `docs/KNOWN_ISSUES.md`: バグ・既知不具合
- `docs/V13_MIGRATION_NOTES.md`: v13 移行メモ
- `docs/PHASE_0_TASKS.md`: フェーズ0 タスクと完了サマリー
- `docs/RULES_REFERENCE.md`: ルール解釈の参照先(フェーズA-2 で整備予定)
- `docs/MECHANICS_AUDIT.md`: メカニクス監査記録(フェーズA-2 で整備予定)
- `docs/DESIGN_REVIEW.md`: 設計レビュー記録(フェーズA-2 で整備予定)

### 5.4 メカニクス監査と設計レビューの分離

- **メカニクス監査**: ルール解釈の正しさを確認する作業。MECHANICS_AUDIT.md に記録。
- **設計レビュー**: 技術的妥当性を確認する作業。DESIGN_REVIEW.md に記録。
- 両者は混同しないこと。同じ実装に対して「ルール解釈は合っているが設計が悪い」「設計は
  良いがルール解釈が間違っている」という両方の指摘が独立に成り立つ。

## 6. 既知の不具合

詳細は `docs/KNOWN_ISSUES.md` を参照すること。
