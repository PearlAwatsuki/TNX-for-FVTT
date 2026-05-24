# フェーズ2 事前調査メモ: User 移行

フェーズ2(Player Actor → User DataModel 移行)着手前の一次情報調査で判明した
重要な制約・トレードオフを記録する。

**作成**: 2026-05-24  
**更新**: 2026-05-25(設計確定事項追記)  
**ステータス**: 設計確定・サブフェーズ構成は次セッションで設計

---

## 1. 現状把握: player Actor の役割(廃止対象)

player Actor は以下の役割を担う「プレイヤー単位のデータ権威」。

| 役割 | フィールド | 型 |
|---|---|---|
| 共有経験点履歴 | `system.history` | ObjectField(オブジェクトマップ) |
| 履歴経験点合計 | `system.exp.total` | NumberField |
| 手札の所有 | `system.handPileId` | StringField(Cards UUID) |
| 切り札の所有 | `system.trumpCardPileId` | StringField(Cards UUID) |
| cast との紐付け | cast 側の `system.playerId` に player の UUID | 参照方向は cast → player |

複数の cast を1人のプレイヤーに束ねる単位であり、
cast シートのヘッダーで player を参照して EXP を表示している。

### EXP 双方向同期の仕組み

`tnx.mjs` の `updateActor` フック内で双方向同期を実装:

- **player → cast 方向**: `syncPlayerExpFromCasts` が `history` / `exp.total` を cast にコピー
- **cast → player 方向**: `updateCastExp` が cast の overflow 合計を player に書き込む
- **無限ループ防止**: `{syncing: true}` コンテキストフラグで再帰を遮断

実体は `TokyoNovaCastSheet.updateCastExp`(static) と `syncPlayerExpFromCasts`。

---

## 2. 決定的な制約: User はカスタム DataModel を持てない

### 一次情報での確認結果

Foundry VTT v13 で **DataModel(system データ)を持てるドキュメント**は以下に限られる:

> ActiveEffect / Actor / Card / Cards / ChatMessage / Combat /
> Combatant / Item / JournalEntryPage

**User はこのリストに含まれない。**

出典:
- [Foundry VTT: System Data Models](https://foundryvtt.com/article/system-data-models)
- [Foundry VTT Wiki: Flags / Document](https://foundryvtt.wiki)

### 帰結

User にシステム固有データを持たせる手段は **flags のみ**。

flags は任意 JSON であり:
- 型検証なし
- スキーマ定義なし
- TypeDataModel の prepare* ライフサイクルなし

---

## 3. これが生むトレードオフ(次回の設計判断事項)

### 現状(player Actor)と移行後(User flags)の対比

| 観点 | 現状: player Actor | 移行後: User flags |
|---|---|---|
| 型保証 | ObjectField / SchemaField で型付き | 型なし(任意 JSON) |
| スキーマ定義 | DataModel で一元管理 | なし(実装者の自己管理) |
| Foundry 慣行 | DataModel が v13 推奨 | flags は補助的な用途が本来の意図 |
| 実装コスト | 移行コスト大 | EXP 同期ロジックの flag ベース再構築が必要 |
| 将来の保守 | v13 の API 変化に追随しやすい | flag 構造は自由なため暗黙の依存が生まれやすい |

### 「User 移行」を持ち上げた当初の理由

1. **所有モデルを先に据える**: 手札・EXP が cast と密結合しており、
   cast シートより先に所有モデルを確立することで二度手間を避けられる。
2. **player Actor の廃止**: Actor が余分に存在することで UI が煩雑になる。
3. **User が自然な所有者**: FEAR 系の「EXP はプレイヤーに付与」のルールを
   データ構造で表現するなら User が意味的に正しい。

### トレードオフのまとめ

「User 移行は **型付き Actor → 型なし flag への移行**」という側面を持つ。
フェーズB で完成させた「DataModel で型を持つ」流儀から、User だけは外れることになる。

---

## 4. 次回フェーズ2 着手時の最初の判断事項

以下の問いに答えてから実装着手すること:

**Q: User 移行を予定通り進めるか、所有モデル設計を見直すか？**

### 選択肢 A: User 移行を予定通り進める
- `history` / `exp` / `handPileId` / `trumpCardPileId` を User flags に格納
- EXP 同期ロジックを flags ベースで再構築(getFlag / setFlag)
- 型検証は実装側で手動管理

### 選択肢 B: player Actor を維持し cast との関係を整理する
- player Actor の DataModel を維持(型付き)
- cast との紐付け方式を見直す(UI 改善・重複 Actor の問題を別アプローチで解決)
- フェーズB で完成した DataModel 流儀を player にも適用できる

### 選択肢 C: 別のドキュメント型を検討する
- flags ではなくカスタム Item(type: playerRecord 等)に格納する案
- Item は DataModel を持てるため型付きを維持できる
- ただし「プレイヤーに紐付く Item」という設計は Foundry 慣行から外れる

---

*この判断はルール解釈(EXP がプレイヤーに帰属するという FEAR 系のルール)にも
関わるため、チャット(Opus)での設計議論を経てから着手する。*

→ **2026-05-25 チャット(Opus)での設計議論により確定。下記「設計確定事項」を参照。**

---

## 設計確定事項(2026-05-25)

### 1. 所有モデル移行の基本方針: User flag 移行・player Actor 廃止

player Actor が担う全役割(EXP・履歴の権威 / 手札・切り札の所有 / 複数 cast を束ねる単位)を
User へ移行し、**player Actor は廃止する**。

User へのデータ保持は **flag** で行う。User は DataModel(system フィールド)を持てないことが
一次情報で確定済み(§2 参照)。

**【訂正記録】** 過去の検討メモにあった「選択肢2: User の system 拡張
(`CONFIG.User.dataModels = ...`)」は**実現不可能であり誤り**。User は flag 運用が唯一の道。
選択肢 B(player 維持)・選択肢 C(別ドキュメント型)も検討の結果棄却。

---

### 2. EXP・履歴の保持と UI

- `history`(オブジェクトマップ構造を維持)・`exp.total` を **User flag** に保持する。
  型検証・初期値はコード側責任(flag は任意 JSON)。
- 表示・編集 UI は自作の Application「**レコードシート**」(F.E.A.R. 系の慣例呼称)として実装。
- 開く導線: **左下プレイヤーリストのユーザー右クリックコンテキストメニュー**に
  「レコードシートを開く」項目を追加。対象 User の flag を読んで開く。

---

### 3. 手札・切り札の所有モデル

- **「1 参加者(User)= 1 手札」**。複数 cast および将来のゲストシートが同じ User の手札を共有。
  RL・ゲスト運用(同一プレイヤーが複数キャラを操作する場合)がこの共有モデルの目的。
- 手札主体 User の UUID を **cast.system に記録**する。
  現 `system.playerId`(player Actor UUID)を User UUID 参照へ張り替え。
  手札取得・EXP 同期はすべて `cast.system` 経由で User を引く構造に変更。
- 記録のトリガ: **cast の ownership 変更を検知**(既存 `tnx.mjs` の `updateActor` フックに乗せる):
  - 複数 User が所有者になった場合: 最初の一人を記録。別 User 設定時は上書き確認ダイアログを表示。
  - 所有者権限を外しても記録はクリアしない(ownership は初期設定のきっかけ、主体の権威ではない)。
  - 直接 UUID を編集できる矯正用フィールドは将来必要になるが今回は**保留**。

---

### 4. EXP・履歴の同期ロジック再構築

現状の `updateActor` フック一本(player ↔ cast 双方向)から
**二フック構成**へ再構築する:

| フック | 方向 | 処理 |
|---|---|---|
| `updateActor`(cast 分岐) | cast → User | 集約先を `player.update` から `User.setFlag` へ変更。既存ロジックを流用。 |
| `updateUser`(新規) | User → cast | その User を主体とする全 cast へ flag から配布。 |

- 無限ループ防止: 現状の `{syncing: true}` 相当の仕組みを踏襲するが、
  **二フックをまたぐ往復になる**ため設計を慎重に行う(サブフェーズで詳細設計)。

---

### 5. キャストシートの手札表示: フェーズ2 では削除しない

フェーズ2 では手札表示を**削除しない**。
所有モデルの変更(User 参照化)で表示が壊れない最小限の追従にとどめる。
表示の存廃(オミット判断)は **フェーズ3(既存シート V2 化)** へ持ち越し。

---

### 6. player Actor の廃止

§1〜4 の対応(User flag への全役割移行)が完了したら **player Actor を廃止**する。
既存 player Actor からのデータ移行(flag への移し替え)の要否・方法は
サブフェーズ構成検討時に詰める。

---

## 次セッションの最初のタスク

上記確定方針に基づく**サブフェーズ構成の設計**(フェーズB の B-0〜B-10 同様の分割)を行う。

以下は未確定の細部であり、サブフェーズに割り当てて各着手時に詰める:
- User flag 内データの具体スキーマ(キー名・初期値・バリデーション方式)
- レコードシートの ApplicationV2 実装作法(新規シートのため ApplicationV2 直接使用)
- 二フック同期の無限ループ防止の具体設計
- player Actor 廃止時の既存データ移行(移行スクリプトの要否)
- 矯正用 UUID 編集フィールドの実装時期
