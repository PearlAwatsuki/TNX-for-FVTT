# B-4 事前調査レポート

作成日: 2026-05-22  
調査者: Claude Code  
対象フェーズ: B-4(cast / player Actor type の DataModel 化)

---

## 1. updateCastExp 関数

### 定義場所

`scripts/actor/tnx-cast-sheet.mjs:1424`

```javascript
static async updateCastExp(actor, linkedPlayer = null)
```

### 動作概要

cast Actor の消費経験点を再計算し、`exp.total` / `exp.spent` / `exp.value` の3フィールドを
まとめて更新する静的メソッド。`linkedPlayer` はオプション引数で、渡された場合は再フェッチを
省略する最適化。

### 読み取るフィールド

| フィールド | 用途 |
|---|---|
| `actor.system.exp.additional` | 追加経験点(独立管理フィールド) |
| `actor.system.playerId` | リンク先プレイヤー Actor の UUID |
| `actor.system.history` | 未リンク時の経験点合計算出用(オブジェクトマップ) |
| `actor.system.reason.growth` 等の `growth` / `mod` / `effectMod` 等 | 能力値コスト計算 |
| `linkedPlayer.system.exp.total` または `fromUuid(playerId).system.exp.total` | 履歴経験点合計(リンク時) |

### 書き込むフィールド

すべて派生値として `updateCastExp` が上書きする(即時 `actor.update` を発行):

| フィールド | 算出式 |
|---|---|
| `system.exp.total` | `additional + historyTotal` |
| `system.exp.spent` | `realSpent - 170` |
| `system.exp.value` | `(total + 170) - realSpent` |

更新時は `{ calcExp: false }` オプションを付けて再帰呼び出しを防いでいる。

### 呼び出し元と呼び出しタイミング

| 場所 | タイミング |
|---|---|
| `tnx.mjs:928` | `createItem` / `deleteItem` / `updateItem` フック(親が cast の場合) |
| `tnx.mjs:935` | `updateActor` フック(actor.type === 'cast' かつ diff.system あり) |
| `tnx.mjs:968` | `updateActor` フック(actor.type === 'player' のとき、リンクされた全キャストに対して) |
| `tnx-cast-sheet.mjs:241` | `_performHistoryUpdate()` の末尾(履歴変更後の再計算) |
| `tnx-cast-sheet.mjs:636` | `_onDrop()` でプレイヤーとのリンク確立直後 |

---

## 2. cast / player 同期ロジック

### cast → player への参照方法

`cast.system.playerId` に player Actor の **UUID 文字列**が格納される。
`fromUuid(cast.system.playerId)` で player Actor インスタンスを取得する。

逆方向(player → cast の一覧取得):
```javascript
game.actors.filter(a => a.type === 'cast' && a.system.playerId === playerActor.uuid)
```

### リンク確立のトリガー

`tnx-cast-sheet.mjs:584` の `_onDrop()`:  
キャストシートに player Actor をドラッグ&ドロップすると、`cast.system.playerId` に
`sourceActor.uuid` がセットされる。

### 同期のトリガーと方向

#### updateActor フック(cast が更新されたとき) — `tnx.mjs:932`

1. `cast.system` に変更がある → `updateCastExp(actor)` で exp を再計算
2. `cast.system.playerId` がある → `syncPlayerExpFromCasts(playerActor)` を実行

`syncPlayerExpFromCasts` の処理:
- リンクされた全 cast の `max(0, castSpent - additional)` を合計
- player の `exp.spent` と `exp.value` を更新(戻り値: `{ syncing: true }` で無限ループ防止)

#### updateActor フック(player が更新されたとき) — `tnx.mjs:948`

`system.history` または `system.exp.total` に変更があった場合:
- リンクされた全 cast に `system.history` と `system.exp.total` を同期
  (`{ syncing: true }` で無限ループ防止)
- その後、全 cast で `updateCastExp` を実行

### 同期されるフィールドの一覧

| 方向 | フィールド | 備考 |
|---|---|---|
| player → cast | `system.history` | history の実体は player 側が権威 |
| player → cast | `system.exp.total` | player の履歴 exp 合計 |
| cast → player | `system.exp.spent` | 全リンクキャストの overflow 合計 |
| cast → player | `system.exp.value` | `total - spent` |

---

## 3. history フィールドの構造

### 実際のデータ構造

**オブジェクトマップ形式**(配列ではない):

```javascript
{
  [randomId: string]: {
    id: string,      // foundry.utils.randomID() で生成
    date: string,    // 入力された日付文字列
    title: string,   // シナリオ名
    exp: number,     // 獲得経験点
    rl: string,      // RL 名
    players: string  // プレイヤー一覧
  },
  ...
}
```

エントリの追加は `system.history.${newId}` キー形式(Foundry のドット記法)で行う。
削除は `system.history.-=${targetId}` キー形式。

### データの読み書き箇所

| 操作 | 場所 | 説明 |
|---|---|---|
| 追加 | `tnx-history-mixin.mjs:34` | `_onHistoryAdd` |
| 削除 | `tnx-history-mixin.mjs:63` | `_onHistoryDelete` |
| フィールド更新 | `tnx-history-mixin.mjs:94` | `_onHistoryChange` |
| 表示用整形 | `tnx-history-mixin.mjs:112` | `Object.values()` でソート済み配列に変換 |
| cast→player マージ | `tnx-cast-sheet.mjs:602` | ドロップ時に `{ ...playerHistory, ...castHistory }` でマージ |
| player→cast 同期 | `tnx.mjs:957` | `system.history` 丸ごとコピー |

### cast と player の構造差異

**同じ構造**。player が「共有履歴の実体」として権威を持ち、リンクされた cast は
player の history を表示・操作する。

### テンプレートからの参照

`history-list.hbs` で `{{#each history as |entry i|}}` で展開。
`context.history` は `_prepareHistoryForDisplay()` で変換済みの配列が渡される。

---

## 4. exp フィールドの派生値 / 独立管理の区別

### cast の exp フィールド

| フィールド | 管理方式 | 初期値(template.json) | 主な変更箇所 |
|---|---|---|---|
| `additional` | **独立管理** | `0` | シートの `system.exp.additional` 入力欄から直接 |
| `value` | **派生値** | `170` | `updateCastExp` が `(total + 170) - realSpent` で算出 |
| `spent` | **派生値** | `-170` | `updateCastExp` が `realSpent - 170` で算出 |
| `total` | **派生値** | `0` | `updateCastExp` が `additional + historyTotal` で算出 |

例外: `system.exp.value` へのシートからの直接書き込みが `tnx-cast-sheet.mjs:1260` に
あり(スキル購入時の消費処理)。`updateCastExp` がすぐ後で再計算して上書きするため
一時的な値として機能している。

### player の exp フィールド

| フィールド | 管理方式 | 初期値(template.json) | 主な変更箇所 |
|---|---|---|---|
| `total` | **独立管理** | `0` | `tnx-history-mixin.mjs:70` — history の exp 変更時に集計して更新 |
| `spent` | **派生値** | `0` | `syncPlayerExpFromCasts` が全リンクキャストの overflow 合計 |
| `value` | **派生値** | `0` | `syncPlayerExpFromCasts` が `total - totalSharedSpent` で算出 |

### DataModel 化への示唆

いずれのフィールドも DataModel では `NumberField` で問題ない。
`prepareDerivedData` でこれらの派生計算を行う選択肢もあるが、
既存の `updateCastExp` / `syncPlayerExpFromCasts` は非同期処理(async/await)で
`Actor.update()` を発行する設計のため、同期的な `prepareDerivedData` への移行は
B-4 のスコープを大きく超える。**B-4 では既存の計算フックをそのまま維持し、
DataModel は単純な数値フィールドとして定義する**のが安全。

---

## 5. lifePath の Actor 側使用

### 調査結果

`scripts/` 全体で `system.lifePath` へのアクセス: **ゼロ件**  
`templates/actor/cast-sheet.hbs` に `lifePath` 関連の記述: **なし**

### 結論

cast の `lifePath: { origin: "", experience: "", encounter: "" }` フィールドは
template.json に定義されているが、**現時点では UI から入力・参照される実装が存在しない**。

Item type の `lifePath` アイテムからのインポート機能も**未実装**。

DataModel 化においては `origin` / `experience` / `encounter` の3フィールドを
`StringField` として定義するのが template.json に忠実な対応。
使われていないことを B-4 エントリの課題として記録する。

---

## 6. player type の使用状況

### system.json の documentTypes

`system.json` の `documentTypes.Actor` には `player: {}` が**明示的に記載されている**。
Foundry VTT v10 以降では `system.json` の `documentTypes` が type 定義の権威であり、
`template.json` の `Actor.types` 配列は補助的な役割。

### template.json の状況

`template.json` の `"types": ["cast", "guest", "troop", "extra"]` に `player` が**含まれていない**。
これは過去からの未整備。`system.json` に登録があるため実運用上は問題なく動作している。

### 実コードでの使用確認

| 箇所 | 内容 |
|---|---|
| `tnx.mjs:252` | `Actors.registerSheet(..., { types: ["player"] })` でシート登録 |
| `tnx.mjs:562` | `actor.type === "player"` で手札作成 |
| `tnx.mjs:639,789,948` | `actor.type === "player"` でフック分岐 |
| `tnx-cast-sheet.mjs:590` | ドロップ処理でのプレイヤー判定 |

player type は実運用で完全に稼働している。

### 既存テストの状況

`tests/` 配下に cast / player を扱うテストは**存在しない**。
(B-4 で新規作成が必要)

### DataModel 化における扱い

player は `template.json` に未記載だが `system.json` に登録済みのため、
DataModel 化は通常の型と同様に `CONFIG.Actor.dataModels` へ登録するだけでよい。
template.json の `Actor.types` からの除外は**B-4 完了後に整理する**
(現状の `template.json` 構造との整合性を保つため)。

---

## 7. cast 固有フィールドの型推定

### player_name

`scripts/` 全体で `player_name` への参照: **ゼロ件**  
`templates/` でも参照なし。

**結論**: `player_name` は template.json にのみ存在するデッドフィールド。
DataModel では `StringField({ initial: "" })` として定義するが、B-4 エントリの課題として
「未使用フィールド」であることを明記する。

### playerId

`cast.system.playerId` は Player Actor の **UUID 文字列**として使われる。
`fromUuid()` で解決するため、常に文字列(UUID または空文字)。

型: `StringField({ initial: "" })`

### history

3 節参照。型は Foundry の `ObjectField` が適切。  
template.json では `{}` だが、実際はランダム ID をキーとするオブジェクトマップ。

### exp (cast)

| フィールド | template.json 初期値 | 型 |
|---|---|---|
| `value` | `170` | `NumberField({ initial: 170 })` |
| `spent` | `-170` | `NumberField({ initial: -170 })` |
| `total` | `0` | `NumberField({ initial: 0 })` |
| `additional` | `0` | `NumberField({ initial: 0 })` |

`updateCastExp` の `initialExp = 170` ハードコード値と一致させること。

### lifePath (cast)

`{ origin: "", experience: "", encounter: "" }` の各フィールドは
`StringField({ initial: "" })`。

---

## 総合所見

### B-4 本体実装で特に注意すべき点

1. **history フィールドの型は ObjectField**  
   template.json では `{}` だが実体はオブジェクトマップ。B-1 / B-2 で登場しなかった
   `foundry.data.fields.ObjectField` を初めて使用することになる。
   `tests/setup.mjs` に `MockObjectField` の追加が必要。

2. **exp フィールドはすべて NumberField で定義し、計算ロジックは触らない**  
   `updateCastExp` / `syncPlayerExpFromCasts` はともに非同期で `Actor.update()` を呼ぶ
   設計。`prepareDerivedData` への移行は B-4 のスコープ外。DataModel は `SchemaField`
   内の数値フィールド群として定義するだけ。

3. **cast の exp.value 初期値は 170**  
   template.json 準拠。`updateCastExp` 内の `initialExp = 170` ハードコードと整合すること。

4. **player type は template.json の types 配列に未記載だが system.json に登録済み**  
   DataModel 登録は `CONFIG.Actor.dataModels` への追加のみで問題ない。
   template.json の `Actor.types` 整理は B-4 完了後に行う。

5. **player の exp.value / exp.spent は「書き込まれない」初期値で動く**  
   `syncPlayerExpFromCasts` が常に上書きする前提。DataModel では template.json の
   初期値(すべて 0)で定義してよい。

### DataModel 設計の選択肢が分かれそうな箇所

1. **history の DataModel 化方針**  
   選択肢A: `ObjectField` — 中身のスキーマを Foundry が検証しない。既存の動的マップ構造に最も素直。  
   選択肢B: `ObjectField` 内にエントリスキーマを `SchemaField` で定義 — 型安全だが
   Foundry の `ObjectField` がネスト検証をどこまでサポートするかは確認が必要。  
   **推奨**: 選択肢A(既存実装の動的な追加・削除・マージに干渉しない)。

2. **player_name の扱い**  
   コードで使われていないが、template.json 準拠で `StringField({ initial: "" })` として
   定義してよい。除外する場合は理由を明記する。

### 調査の過程で見つかった既存コードの問題

**KI-017 候補: tnx-cast-sheet.mjs の未使用デッドコード**

以下の3メソッドが定義されているが、コード内に呼び出し元が存在しない:
- `_getHistoryData()` (line 1364)
- `_saveHistoryData()` (line 1374)
- これらのメソッドは `_sortHistory()` を呼び出しているが、`_sortHistory` 自体も未定義

実害はないが、将来誰かが誤って呼び出した場合クラッシュする。
B-4 実装の際に `docs/KNOWN_ISSUES.md` に KI-017 として記録する(修正はスコープ外)。
