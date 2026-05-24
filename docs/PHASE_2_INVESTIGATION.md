# フェーズ2 事前調査メモ: User 移行

フェーズ2(Player Actor → User DataModel 移行)着手前の一次情報調査で判明した
重要な制約・トレードオフを記録する。

**作成**: 2026-05-24  
**ステータス**: 調査完了・設計判断未確定

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
