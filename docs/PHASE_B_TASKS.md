# Phase B: DataModel への完全移行

## 目的

現状の `template.json` ベースの Actor / Item 定義を、Foundry VTT の DataModel
(`TypeDataModel` クラス継承)による定義に置き換える。これにより以下を達成する。

- データ構造の型・バリデーション・デフォルト値を明示的に管理する
- v10 以降の Foundry VTT 推奨方式に整合させる
- フェーズ1 以降の判定システム実装時に、データの扱いを簡潔にする

## 背景

フェーズ0 の棚卸し時点で、本プロジェクトは template.json 依存(DataModel クラス未使用)
の状態であった。長期戦の保守性を確保するため、本フェーズで DataModel への完全移行を行う。

棚卸し結果として、Actor 5種(cast / guest / troop / extra / player)、
Item 17種(style / styleSkill / generalSkill / miracle / weapon / armor / ianus /
cyborg / tron / tap / vehicle / residence / housingArea / combiner / general /
organization / lifePath)を DataModel 化する。

Card type(playingCards / neuroCards / other)は今回の移行対象外とする。

## サブフェーズ

### B-0: 設計方針の確定 ✅ 完了(2026-05-21)

DataModel 実装に着手する前に、以下の方針を確定させる。実装ファイルは作成しない。

- DataModel クラスの命名規約(例: `TnxCastDataModel` / `CastDataModel` 等)
- ファイル配置(例: `scripts/data-models/` 配下に集約 等)
- 共通 template の継承戦略(Mixin / 共通クラス継承 / フィールド合成 等)
- defineSchema の記述スタイル
- 既存シートとの接続方式

決定事項は `docs/DESIGN_REVIEW.md` に B-0 として記録する。

### B-1: Actor 共通 template の DataModel 化 ✅ 完了(2026-05-21)

Actor で共有される共通 template を DataModel として実装する。

- `biography` template の DataModel 化
- `attributes` template の DataModel 化(reason / passion / life / mundane / combatSpeed /
  各ダメージ系)
- `actorBase` template の DataModel 化(handMaxSize / handPileId / trumpCardPileId)

### B-2: Item 共通 template の DataModel 化 ✅ 完了(2026-05-21)

Item で共有される共通 template を DataModel として実装する。

- `base` template の DataModel 化(description)
- `usage` template の DataModel 化(actions[])
- `skillBase` template の DataModel 化(level / suits / isAction)
- `outfitBase` template の DataModel 化(多数のフィールド)
- `extensible` template の DataModel 化(slot[])

### B-3: 単純な Actor type ✅ 完了(2026-05-21)

固有フィールドが少ないか存在しない Actor type を DataModel 化する。

- guest(共通 template のみ) → `GuestDataModel`
- troop(memo フィールドのみ) → `TroopDataModel`
- extra(biography のみ) → `ExtraDataModel`

完了内容:
- `scripts/data/actor/{guest,troop,extra}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Actor.dataModels` に3 type 登録
- `template.json` から guest / troop / extra エントリ削除(`Actor.templates` は B-4 まで保持)
- テスト 63 件追加(計 201 件)
- `docs/DESIGN_REVIEW.md` に B-3 エントリ追加

### B-4: 複雑な Actor type ✅ 完了(2026-05-22)

固有フィールドが多い・既存ロジックとの結合が強い Actor type を DataModel 化する。

- cast(history / exp / lifePath 等) → `CastDataModel`
- player(history / exp、cast との exp 構造差異の整理) → `PlayerDataModel`
- exp 計算ロジック(`updateCastExp`)との接続確認

完了内容:
- `scripts/data/actor/{cast,player}.mjs` 作成
- `tests/setup.mjs` に `MockObjectField` 追加
- `scripts/tnx.mjs` の `init` フックで cast / player を `CONFIG.Actor.dataModels` に追加(全5 type 完了)
- `template.json` の Actor セクションを `types` 配列のみに整理
  - `Actor.templates` セクション(biography / attributes / actorBase)を削除
  - `Actor.cast` / `Actor.player` セクションを削除
  - `Actor.types` 配列に `player` を追加(system.json と整合)
- テスト 57 件追加(計 258 件)
- `docs/DESIGN_REVIEW.md` に B-4 エントリ追加
- `docs/KNOWN_ISSUES.md` に KI-017 追加
- 事前調査: `docs/B4_INVESTIGATION.md` 作成(2026-05-22)

### B-5: 単純な Item type

固有フィールドが少ないか存在しない Item type を DataModel 化する。

- armor / ianus / cyborg / tron / vehicle
- housingArea / combiner / general / organization / lifePath

### B-6: 中程度の Item type + データマイグレーション機構の導入

中程度のフィールド数を持つ Item type を DataModel 化する。同時に、データマイグレーション
機構を導入し、KI-007(tap.conbatSpeedMod のタイポ)を修正する。

- weapon / tap / residence / miracle / generalSkill
- データマイグレーション機構の設計と実装
- KI-007: `conbatSpeedMod` → `combatSpeedMod` の修正とマイグレーション

### B-7: 複雑な Item type

最もフィールド数が多く設計が複雑な Item type を DataModel 化する。

- style(persona / key / level / miracle / attributes 部分継承等)
- styleSkill(category / unique / combo / target / range / confrontation 等多数、
  performance / secret / mystery 等のネストオブジェクトを含む)

### B-8: 移行後の検証

全 type の DataModel 移行完了後、既存機能との整合性を検証する。

- 既存のキャラクターシート・アイテムシートが正常表示されることを確認
- EXP 計算が変わらず動作することを確認
- カード判定・神業の usageCount 等、既存ロジックが破壊されていないことを確認
- `MECHANICS_AUDIT.md` / `DESIGN_REVIEW.md` への記録

## 移行戦略

- 各サブフェーズで、対象 type を DataModel 化したら **既存の template.json 該当箇所も
  削除する**(二重管理を避ける)
- ただし、移行中は両方が並存する瞬間が発生する。1サブフェーズ内では完了するまで作業を
  続け、中途半端な状態でコミットしないこと
- 既存のキャラクターシート・アイテムシートには **B-8 まで手を入れない**(DataModel 移行と
  シート書き換えを混ぜると複雑性が爆発する)

## やってはいけないこと

- 既存シート(`tnx-cast-sheet.mjs` 等)の構造的な書き換え(フェーズ6 で扱う)
- 既存の EXP 計算ロジック(`updateCastExp`)の意味的な変更
- カード判定・神業の usageCount 等、既存の業務ロジックへの介入
- データマイグレーション機構の導入を B-6 以外で行う(タイミングを揃える)

## 既知の課題との関係

- KI-007 (tap.conbatSpeedMod のタイポ): B-6 でデータマイグレーション機構と同時に修正
- KI-014, KI-015: フェーズA-3/A-4 で解消済み

## 完了条件

- 全 22 type(Actor 5 + Item 17)が DataModel に移行されていること
- template.json から移行対象の type 定義が削除されていること(template セクションも整理)
- データマイグレーション機構が導入されていること
- 既存機能が破壊されていないこと(B-8 で検証)
- B-0〜B-8 の各サブフェーズの記録が DESIGN_REVIEW.md / MECHANICS_AUDIT.md にあること

## 担当時期

フェーズA 完了直後より着手。週1〜2セッションペースで 2〜3ヶ月を見込む。
