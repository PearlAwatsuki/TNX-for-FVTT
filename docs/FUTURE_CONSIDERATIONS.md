# Future Considerations

正式にフェーズとしてロードマップに組み込む前の、検討段階の項目を記録する。

各項目は「背景」「移行先候補」「想定される作業」「着手時期の目安」を含む形で
記述する。確定したらロードマップ(PHASE_*.md 等)に移し、本ファイルから削除する。

---

## 項目一覧

### Player Actor → User ベースへの移行

**起票**: 2026-05-22(フェーズB-4 完了時)

#### 背景

現状、TNX システムではプレイヤーに紐づく経験点・履歴を「Player Actor」として
Actor ドキュメントで管理している。これは Foundry の標準パターンを活用した実装だが、
F.E.A.R. 製ゲームのルール上の実態である「経験点・履歴はプレイヤー個人に紐づく」
という概念とは微妙にズレている。

Actor として実装している現状の懸念:
- Actor 一覧にプレイヤー名の Actor が混じり、キャラクター Actor と区別しにくい
- 「プレイヤーの所有物」というルール上の実態を Actor で表現することの不自然さ
- cast.system.playerId が Player Actor の UUID を保持する形になっており、
  ログインユーザーとの紐付けが間接的

#### 移行先候補

- **User の DataModel 拡張**(`CONFIG.User.dataModels`)
  - 概念的にもっとも自然
  - DataModel の型・バリデーション・初期値の恩恵を受けられる
  - User シートは Foundry のサポートが Actor ほど手厚くなく、独自実装が必要
  - 他ユーザーの値を見るための権限設計が必要(GM のみ全員参照、等)
  - Actor/Item ほど普及した実装例が少なく、ハマったときの参照先が薄い

- 他選択肢(User Flags、World Settings + JournalEntry)も検討対象だが、
  概念整合性の観点で User DataModel がもっとも有力。

#### 想定される作業

- User DataModel の設計・実装
- User シート(または経験点・履歴ビュー)の実装
- 既存 Player Actor からのデータマイグレーション機構
- cast.system.playerId(Player Actor の UUID)→ User ID 参照への移行
- updateCastExp / syncPlayerExpFromCasts 等の同期ロジックの再設計
- 既存ワールドの移行をどう案内するか(自動 or 手動)

#### 着手時期の目安

フェーズB(DataModel 化)完了後。フェーズ6.5(サイバーパンク基調のデザイン刷新)
等と並べて優先度判断する。スコープが大きく、シート UI 含む実装になるため、
独立したフェーズとして扱う想定。

#### 関連する既存実装

- `scripts/actor/tnx-cast-sheet.mjs` の `updateCastExp` / `_onDrop` 等
- `scripts/tnx.mjs` の updateActor フック(cast / player 同期処理)
- `scripts/module/tnx-history-mixin.mjs`
- `scripts/data/actor/player.mjs`(B-4 で DataModel 化済)
- `scripts/data/actor/cast.mjs` の `playerId` フィールド(B-4 で DataModel 化済)
