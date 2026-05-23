# Phase B: DataModel への完全移行

> **ステータス: 完了(v0.2.0 / 2026-05-24)**
> B-0〜B-10 全サブフェーズ完了。全 25 type(Actor 5 + Item 17 + Card 3)DataModel 移行済み。
> template.json 廃止済み。実機検証(B-10)完了。
> **次フェーズ: フェーズ1(HUD の ApplicationV2 移行 + v13 UI 整合)**

## 目的

現状の `template.json` ベースの Actor / Item / Card 定義を、Foundry VTT の DataModel
(`TypeDataModel` クラス継承)による定義に置き換え、`template.json` ファイルを完全に廃止する。
これにより以下を達成する。

- データ構造の型・バリデーション・デフォルト値を明示的に管理する
- v13(および以降)の Foundry VTT 推奨方式に整合させる(template.json は v14 で非推奨期間)
- 新フェーズ5/6(判定システム)の実装時に、データの扱いを簡潔にする

## 背景

フェーズ0 の棚卸し時点で、本プロジェクトは template.json 依存(DataModel クラス未使用)
の状態であった。長期戦の保守性を確保するため、本フェーズで DataModel への完全移行を行う。

棚卸し結果として、Actor 5種(cast / guest / troop / extra / player)、
Item 17種(style / styleSkill / generalSkill / miracle / weapon / armor / ianus /
cyborg / tron / tap / vehicle / residence / housingArea / combiner / general /
organization / lifePath)、および Card 3種(playingCards / neuroCards / other)を
DataModel 化する。

**Card type を移行対象に含める**: フェーズB の目的は template.json 依存の完全排除であり、
Card を残すと template.json ファイルを廃止できない。Card は description のみ(organization
と同型)で DataModel 化が容易。template.json ファイルの廃止とあわせて B-8 で実施する。

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

### B-5: 単純な Item type ✅ 完了(2026-05-22)

固有フィールドが少ないか存在しない Item type を DataModel 化する。3 グループに分けて実施。

#### B-5a: base のみ 3種 ✅ 完了(2026-05-22)

- housingArea / organization / lifePath

完了内容:
- `scripts/data/item/{housing-area,organization,life-path}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 3 type 登録(初回)
- `template.json` から housingArea / organization / lifePath エントリ削除
- テスト 25 件追加(計 283 件)
- `docs/DESIGN_REVIEW.md` に B-5a エントリ追加

#### B-5b: base + outfitBase 4種 ✅ 完了(2026-05-22)

- armor / cyborg / combiner / general

完了内容:
- `scripts/data/item/helpers.mjs` 新設、`defenceField()` をエクスポート
- `scripts/data/item/{armor,cyborg,combiner,general}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 4 type 追加
- `template.json` から armor / cyborg / combiner / general エントリ削除
- テスト 41 件追加(計 324 件)
- `docs/DESIGN_REVIEW.md` に B-5b エントリ追加

#### B-5c: base + outfitBase + extensible 3種 ✅ 完了(2026-05-22)

- ianus / tron / vehicle

完了内容:
- `scripts/data/item/{ianus,tron,vehicle}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 3 type 追加(B-5 全 10 type 登録完了)
- `template.json` から ianus / tron / vehicle エントリ削除
- テスト 23 件追加(計 347 件)
- `docs/DESIGN_REVIEW.md` に B-5c エントリ + B-5 全体完了の総括を追加

### B-6: 中程度の Item type の DataModel 化 ✅ 完了(2026-05-23)

中程度のフィールド数を持つ Item type を DataModel 化する。2 サブフェーズに分割する。

**設計判断**: 当初の B-6 定義には「データマイグレーション機構の導入」が含まれていたが、
実運用前で移行対象の実データが存在しないこと、および CLAUDE.md §4.2「将来のために拡張
ポイントを先回りで作らない」の方針に従い、マイグレーション機構の導入は見送った。
詳細は `docs/DESIGN_REVIEW.md` B-6a エントリ参照。

#### B-6a: outfit 系 3種 ✅ 完了(2026-05-23)

- weapon / tap / residence(base + outfitBase + extensible)

完了内容:
- `scripts/data/item/helpers.mjs` に `attackField()` を追加
- `scripts/data/item/cyborg.mjs` を `attackField()` 使用に変更(リファクタ、意味的変更なし)
- `scripts/data/item/{weapon,tap,residence}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 3 type 追加(計 13 type)
- `template.json` から weapon / tap / residence エントリ削除
- KI-007: tap DataModel を正しい綴り `combatSpeedMod` で定義し解消(マイグレーションなし)
- テスト 49 件追加(計 396 件)
- `docs/DESIGN_REVIEW.md` に B-6a エントリ追加
- `docs/KNOWN_ISSUES.md` の KI-007 を解消済みに更新、KI-016 の担当フェーズを修正

#### B-6b: skill 系 2種 ✅ 完了(2026-05-23)

- miracle / generalSkill(base + usage / base + usage + skillBase)

完了内容:
- `scripts/data/item/{miracle,general-skill}.mjs` 作成
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 2 type 追加(計 15 type)
- `template.json` から miracle / generalSkill エントリ削除
- テスト 37 件追加(計 443 件)
- `docs/DESIGN_REVIEW.md` に B-6b エントリ + B-6 全体完了の総括を追加

**B-6 全体完了**。template.json に残る Item type 別エントリは style / styleSkill のみ(B-7 対象)。

### B-7: 複雑な Item type

最もフィールド数が多く設計が複雑な Item type を DataModel 化する。
B-7a / B-7b の 2 サブグループに分割して進める。

#### B-7a: style ✅ 完了

- `scripts/data/item/style.mjs` 作成(base のみ mixin)
- ファイル内ローカル関数 `abilityField()` で reason / passion / life / mundane の
  `{value, control}` 2 フィールド構造を定義(style 専用のため helpers.mjs には出さない)
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に 1 type 追加(計 16 type)
- `template.json` から style エントリ削除
- テスト 28 件追加(計 471 件)
- `docs/DESIGN_REVIEW.md` に B-7a エントリを追加

#### B-7b: styleSkill ✅ 完了

- `scripts/data/item/style-skill.mjs` 作成(base + usage + skillBase mixin)
- 配列要素を実態の SchemaField で定義(template.json の `["blank"]` 近似には追従しない)
- template.json 未定義だがシート参照の ★ フィールド 8 個を明示定義
  (maxLevelNumber / maxLevelOther / targetOther / rangeOther /
   targetValueNumber / targetValueOther / comboSkillOther / confrontationOther)
- unique の initial を `"none"` に修正(template.json の `""` は誤り)
- RewritedTarget / RewritingMiracle_ID はタイポ・命名揺れを維持(KI-018/019 記録)
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Item.dataModels` に styleSkill を追加
  (**全 17 type 登録完了**)
- `template.json` の Item セクションを空オブジェクト `{}` に整理
  (styleSkill エントリ削除 + `Item.templates` セクション削除 + `Item.types` 配列削除)
  ※ template.json ファイル自体は B-8 まで維持(htmlFields 検証が必要)
- `tests/template-integrity.test.mjs` を新しい template.json 形状(Item: {})に対応更新
- テスト 60 件追加(計 530 件)
- `docs/DESIGN_REVIEW.md` に B-7b エントリ + B-7 全体総括 + フェーズB Item 完了総括を追加

**B-7 全体完了。フェーズB の DataModel 化作業(B-1〜B-7)が完了した。**
全 22 type(Actor 5 + Item 17)が DataModel に移行済み。
template.json の Item セクションは空オブジェクト。

### B-8: Card type の DataModel 化 ✅ 完了(2026-05-23)

Card 3 type(playingCards / neuroCards / other)を DataModel 化し、`CONFIG.Card.dataModels` に登録する。
フェーズB の DataModel 化対象(Actor 5 + Item 17 + Card 3 = 全 25 type)が揃う。

完了内容:
- `scripts/data/card/common/base.mjs` 新設(`CardBaseTemplate`、description のみ)
  - `Item.BaseTemplate` との層またぎ(data/card → data/item)を避けるため Card 用に独立定義
- `scripts/data/card/{playing-cards,neuro-cards,other}.mjs` 作成
  - `PlayingCardsDataModel` / `NeuroCardsDataModel` / `OtherDataModel`
  - 各々 `SystemDataModel.mixin(CardBaseTemplate)` を継承、固有フィールドなし
- `scripts/tnx.mjs` の `init` フックで `CONFIG.Card.dataModels` に 3 type 登録
- テスト 12 件追加(計 542 件)
- `docs/DESIGN_REVIEW.md` に B-8 エントリ追加
- template.json の Card セクションは B-9 まで残置(廃止は B-9)

### B-9: template.json 廃止 + description の HTMLField 化 ✅ 完了(2026-05-24)

全 type の DataModel 移行完了(B-8)後、`description` の HTMLField 化と template.json の廃止を実施。

完了内容:
- `scripts/data/item/common/base.mjs` / `scripts/data/card/common/base.mjs` /
  `scripts/data/actor/common/biography.mjs` の description を `StringField` → `HTMLField` 化
- `system.json` の `documentTypes` に `"htmlFields": ["description"]` を宣言:
  - Item 全 17 type / Card 全 3 type / Actor は cast・guest・extra のみ
  - troop・player は biography 非保有のため対象外
- `tests/setup.mjs` に `MockHTMLField` 追加・`foundry.data.fields.HTMLField` に登録
- `tests/data/item/common/base.test.mjs` の description 型検証を HTMLField に更新
- `template.json` ファイルを削除(全 25 type の権威が `system.json` の documentTypes に一本化)
- `tests/template-integrity.test.mjs` を documentTypes ベースに全面書き換え:
  - template.json 廃止確認 / system.json 妥当性 / 全 25 type の存在確認 /
    DataModel ファイルと documentTypes.Item の過不足なし確認
- `docs/KNOWN_ISSUES.md`:
  - KI-005: 担当フェーズを「HUD・カード再設計フェーズ以降」に更新
  - KI-016: StringField 維持で確定しクローズ([解消済み]に更新)
- テスト 2 件増加(計 544 件 / 38 ファイル)
- `docs/DESIGN_REVIEW.md` に B-9 エントリ追加

### B-10: 移行後の検証

※ 旧 B-8「移行後の検証」を B-9(template.json 廃止)の追加に伴い B-10 に繰り下げ。

template.json 廃止(B-9)完了後、既存機能との整合性を検証する。

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

- 既存シート(`tnx-cast-sheet.mjs` 等)の構造的な書き換え(新フェーズ2 で扱う)
- 既存の EXP 計算ロジック(`updateCastExp`)の意味的な変更
- カード判定・神業の usageCount 等、既存の業務ロジックへの介入
- データマイグレーション機構を B-6(またはフェーズB 全体)でまとめて導入しようとすること
  (実運用前で不要。必要になったフェーズで設計する)

## 既知の課題との関係

- KI-007 (tap.conbatSpeedMod のタイポ): B-6a で正しい綴り `combatSpeedMod` で定義し解消(マイグレーションなし)
- KI-014, KI-015: フェーズA-3/A-4 で解消済み

## 完了条件

- 全 25 type(Actor 5 + Item 17 + Card 3)が DataModel に移行されていること
- **template.json ファイルが廃止されていること**(documentTypes が type の権威)
- 既存機能が破壊されていないこと(B-10 で検証)
- B-0〜B-10 の各サブフェーズの記録が DESIGN_REVIEW.md / MECHANICS_AUDIT.md にあること

## 担当時期

フェーズA 完了直後より着手。週1〜2セッションペースで 2〜3ヶ月を見込む。
