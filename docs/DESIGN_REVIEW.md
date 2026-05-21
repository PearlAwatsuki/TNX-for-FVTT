# DESIGN_REVIEW

トーキョーN◎VA THE AXLERATION の実装について、技術的妥当性をレビューする記録。

ルール解釈の正しさは `MECHANICS_AUDIT.md` 側で扱う。本ドキュメントは「ルールが正しく
実装されている前提で、コードとして良い設計か」を見る。

## 運用ルール

- 新規実装時: その実装の範囲で1エントリ追加
- 既存実装に影響する変更時: 影響を受けるエントリのステータスを「リファクタ予定」等に更新
- フェーズ完了時: そのフェーズで増えた全エントリを通読してステータスを最新化

## エントリテンプレート

```
### [機能名 / モジュール名](フェーズX)

**日付**: YYYY-MM-DD
**レビュー対象**: `path/to/file.mjs` または `クラス名`
**ステータス**: レビュー中 | レビュー済(問題なし) | レビュー済(課題あり) | リファクタ予定

#### レビュー観点
- 保守性: コードが読みやすく、後から手を入れやすいか
- 拡張性: フェーズが進んだとき破綻しないか
- パフォーマンス: 実用上の問題はないか
- FVTT 慣行: Foundry VTT の標準的なパターンに準拠しているか
- 既存設計との整合: 既存の TnxActionHandler、Sheet 等と整合しているか

#### 良かった点
- (保守性・拡張性などの観点で評価できる点)

#### 課題
- ⚠️ 課題1: 内容と影響範囲
- ❌ 課題2: 内容と影響範囲

#### 推奨アクション
- 即時対応するか、フェーズXX で対応するか、対応しない(意図的に妥協)か
```

## エントリ一覧

### B-0 設計方針(DataModel 移行)(フェーズB)

**日付**: 2026-05-21
**レビュー対象**: フェーズB 全体の DataModel 実装方針
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: 長期戦(2〜3ヶ月)の DataModel 実装で破綻しないか
- 拡張性: フェーズ1 以降の判定システム実装で破綻しないか
- パフォーマンス: 22 type 分の DataModel 実装で大きな問題が出ないか
- FVTT 慣行: Foundry VTT v13 の推奨パターンに準拠しているか
- 既存設計との整合: 既存の TnxCastSheet、TnxActionHandler 等と整合しているか

#### 決定事項

##### 論点1: クラス命名規約

**決定**: 案C(`CastDataModel` / `StyleSkillDataModel` 等、プレフィックスなし)

検討した他の案:
- 案A: `TnxCastDataModel`(プロジェクトプレフィックス付き)
- 案B: `CastData`(短い)

決定理由: dnd5e の慣行に近く、データモデル単独でクラス名から型がわかる。

見直しの可能性: 既存の `Tnx` プレフィックスクラスとの命名一貫性で違和感が強くなる場合は
案A への切り替えを検討する。

##### 論点2: ファイル配置

**決定**: 案A(`scripts/data/` 配下に集約)

ディレクトリ構造:

```
scripts/
  data/
    abstract.mjs
    actor/
      common/      # biography, attributes, actor-base
      cast.mjs
      guest.mjs
      troop.mjs
      extra.mjs
      player.mjs
    item/
      common/      # base, usage, skill-base, outfit-base, extensible
      style.mjs
      style-skill.mjs
      ...
```

検討した他の案:
- 案B: `scripts/data-models/`(より明示的)
- 案C: 既存の `scripts/actor/` `scripts/item/` の隣に `*.data.mjs`

決定理由: dnd5e の構造を踏襲し、Actor / Item をディレクトリで分離。共通 template を
`common/` に閉じ込めることで依存関係を明示。

見直しの可能性: 実装してみてディレクトリが浅すぎる・深すぎると感じたら再構成する。

##### 論点3: 共通 template の継承戦略

**決定**: 案A(Mixin パターン)

検討した他の案:
- 案B: 単純な継承(1つの親クラスから派生)
- 案C: SchemaField の合成(継承なし)

決定理由: TNX は1つの type が複数の template を使う構造(cast = biography + attributes
+ actorBase など)。多重継承相当の機能が必要。dnd5e の `SystemDataModel.mixin()` パターン
を踏襲する。

参考実装イメージ:

```javascript
// scripts/data/abstract.mjs
export class SystemDataModel extends foundry.abstract.TypeDataModel {
  static mixin(...mixins) {
    const Class = class extends this {};
    for (const mixin of mixins) {
      // mixin の defineSchema、メソッドを Class に追加
    }
    return Class;
  }
}

// scripts/data/actor/cast.mjs
export class CastDataModel extends SystemDataModel.mixin(
  BiographyTemplate, AttributesTemplate, ActorBaseTemplate
) {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      // cast 固有のフィールド
    };
  }
}
```

見直しの可能性: Mixin の実装が複雑すぎる・型エラーが頻発する場合は案C(SchemaField
合成)に切り替える。

##### 論点4: defineSchema の記述スタイル

**決定**: 案A(インライン)+ 一部 案C(ヘルパー関数)

検討した他の案:
- 案B: フィールド定義を別ファイルに切り出してインポート

決定理由: 基本はインラインで可読性を優先。ただし `{ value, min, max }` のような
TNX 固有の繰り返しパターンはヘルパー関数(`scripts/data/helpers.mjs`)に集約する。

ヘルパー関数の例:

```javascript
// scripts/data/helpers.mjs
export function damageField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value: new fields.NumberField({ initial: 0 }),
    min: new fields.NumberField({ initial: 0 }),
    max: new fields.NumberField({ initial: 0 }),
  });
}
```

見直しの可能性: ヘルパー関数が肥大化したらモジュール分割を検討する。

##### 論点5: 既存シートとの接続方式

**決定**: 案A(既存シートはそのまま、`actor.system.xxx` でアクセスする方式を維持)

検討した他の案:
- 案B: DataModel に getter / setter / メソッドを足して、シートロジックを DataModel に寄せる
- 案C: シートも一緒に書き換える

決定理由: フェーズB のスコープは「DataModel への移行」であってシート書き換えではない。
シートの構造的書き換えはフェーズ6(既存シートの ApplicationV2 完全移行)で扱う。
DataModel に必要最小限のメソッド(`prepareDerivedData` 等)を実装するのは OK だが、
シートのロジックを移すことはしない。

見直しの可能性: 既存シートが DataModel と整合しない箇所が出てきた場合、フェーズB の
範囲で最小限の調整を許容する(ただし大幅な書き換えはしない)。

#### 良かった点

- フェーズB のスコープが明確になった(DataModel 化のみ、シート書き換えは含まない)
- dnd5e という参照例があるため、実装方針に迷ったときに参照できる
- 命名規約・ファイル配置の決定により、Claude Code への実装プロンプトが簡潔になる

#### 課題

なし。実装着手前の方針確定として、必要な決定はすべて行えた。

#### 推奨アクション

B-1(Actor 共通 template の DataModel 化)に進む。実装中に方針見直しが必要と感じた
時点で、本エントリの「見直しの可能性」セクションを更新する。

---

### B-1 Actor 共通 template の DataModel 化(フェーズB)

**日付**: 2026-05-21
**レビュー対象**: `scripts/data/abstract.mjs`, `scripts/data/helpers.mjs`,
`scripts/data/actor/common/biography.mjs`, `scripts/data/actor/common/attributes.mjs`,
`scripts/data/actor/common/actor-base.mjs`
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-0 で確定した方針に沿った実装になっているか
- 拡張性: B-3 / B-4 で実 Actor type が mixin として利用できる形になっているか
- パフォーマンス: 22 type への展開に耐える設計か
- FVTT 慣行: foundry.abstract.TypeDataModel を正しく継承しているか
- 既存設計との整合: template.json の Actor 共通 template 定義に忠実か

#### 良かった点

- **Mixin パターンの実装**: `class extends this` で動的にクラスを生成する dnd5e 流派を採用。
  プロトタイプチェーンが綺麗で、デバッグ性が高い。
- **getter/setter 対応**: `Object.getOwnPropertyDescriptors` を使うことで、template の
  プロトタイプメソッドだけでなく getter/setter も正しく引き継げる。普通の `Object.assign`
  ではここが壊れがちなので、丁寧な実装。
- **defineSchema の空オブジェクト初期値**: `SystemDataModel.defineSchema()` が `{}` を返す
  ことで、mixin を使わない type も SystemDataModel を継承できる。設計の余地を残しつつ
  最小限。
- **テストの段階性**: 段階1 で Mixin パターン自体を 5 件のテストで検証してから、段階2 で
  template 実装に進んだ。心臓部の信頼性を先に確保する進め方は理に適っている。
- **`tests/setup.mjs` の静的インポート方式**: vitest.config.mjs の setupFiles を使わず、
  テストファイル先頭で `import "../../../setup.mjs"` するだけで済む構成。ESM の評価
  順序を正しく利用しており、設定の複雑化を避けている。
- **ダメージフィールドの max 値の扱い**: `damageField()` の汎用化を急がず、TNX 固有の
  max:21 を attributes.mjs 内に明示。「ダメージの max は型ごとの固定値」という TNX の
  ルール構造が読み取れる形を維持している。
- **ヘルパー関数の追加判断**: reason/passion/life/mundane の 14 フィールド構造の繰り返し
  に対して `attributeField()`、combatSpeed の 5 フィールド構造に対して
  `combatSpeedField()` を helpers.mjs に追加。重複削減と可読性向上を両立。
- **テストカバレッジ**: 計 88 件のテスト。defineSchema の構造、ネストフィールドのキー
  存在まで検証している。

#### 課題

なし。B-1 のスコープ内で品質を満たした実装。

#### 推奨アクション

B-2(Item 共通 template の DataModel 化)に進む。Item の共通 template は 5 種
(base / usage / skillBase / outfitBase / extensible)あり、Actor 共通 template の
パターンを踏襲する形で実装可能。

実装中に B-0 の方針見直しが必要と感じた時点で、B-0 エントリの「見直しの可能性」
セクションを更新する。

---

### B-2 Item 共通 template の DataModel 化(フェーズB)

**日付**: 2026-05-21
**レビュー対象**: `scripts/data/item/common/base.mjs`,
`scripts/data/item/common/usage.mjs`, `scripts/data/item/common/skill-base.mjs`,
`scripts/data/item/common/outfit-base.mjs`, `scripts/data/item/common/extensible.mjs`,
`tests/setup.mjs`(MockArrayField 追加)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-0 / B-1 の方針を踏襲しているか
- 拡張性: B-5 / B-6 / B-7 で実 Item type が mixin として利用できる形になっているか
- FVTT 慣行: foundry.data.fields の ArrayField / SchemaField を適切に使えているか
- 既存設計との整合: template.json と既存コード(usage-list.hbs 等)に忠実か

#### 良かった点

- **既存コードを情報源とした型推測**: actions の要素構造について、
  `tnx-item-sheet.mjs` の `_onActionCreate()` と `usage-list.hbs` を読んで
  `{type, name, description}` の StringField 3 つと判断。template.json だけでなく
  実装コードまで参照する姿勢は信頼できる。
- **ハイフン含みフィールド名への配慮**: "isPre-play" について、オブジェクトリテラルでは
  キー文字列として記述可能だがアクセス時は `system["isPre-play"]` 記法が必要、と
  JSDoc に明示。将来のメンテナーへの申し送り。
- **template.json への忠実性**: hide / exclusive 等のフィールドが template.json で
  `"-"` で初期化されていることを確認し、StringField で統一。憶測でなく現状を尊重。
- **MockArrayField の最小実装**: setup.mjs に追加する形で対応。element プロパティで
  ラップされた要素スキーマを保持する最小限の実装に留めた。
- **helpers 追加の保留判断**: uses の `{isLimit, max, value}` 構造は outfitBase の
  1 箇所のみのため、ヘルパー化を急がず inline で実装。将来 styleSkill (B-7) で
  同構造が出てくる可能性についても申し送り済み。
- **テストカバレッジ**: 計 138 件(B-1 から 50 件増加)。空配列がデフォルト値である
  ことの検証も含む。

#### 課題

- template.json のフィールド型の一部に、本来あるべき型(Boolean)と異なる型
  (String、`"-"` で初期化)が混在している可能性がある(例: exclusive)。
  これは template.json の設計上の問題であり、B-2 のスコープ
  (「template.json を忠実に再現する」)では対応外。`docs/KNOWN_ISSUES.md` に
  KI-016 として記録し、将来検討対象とする。

#### 推奨アクション

B-3(単純な Actor type: guest / troop / extra)に進む。Item 共通 template の
パターンが揃ったので、Actor type 実装は B-1 のパターンと B-2 で確立した
ArrayField モックを組み合わせる形で進められる。

---

### B-3 単純な Actor type の DataModel 化(フェーズB)

**日付**: 2026-05-21
**レビュー対象**: `scripts/data/actor/guest.mjs`, `scripts/data/actor/troop.mjs`,
`scripts/data/actor/extra.mjs`, `scripts/tnx.mjs`(CONFIG 登録追加)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-0 / B-1 の方針(Mixin パターン・プレフィックスなし命名・インライン defineSchema)に沿った実装になっているか
- 拡張性: B-4 の cast / player DataModel 化に向けて、今回のパターンが踏襲できる形か
- FVTT 慣行: `CONFIG.Actor.dataModels` への登録が `init` フックで正しく行われているか
- 既存設計との整合: template.json から削除した範囲が guest / troop / extra に限定されているか

#### 良かった点

- **mixin の合成順が B-1 のパターンを踏襲**: `SystemDataModel.mixin(...)` の引数順は
  template.json の `"templates"` 配列順(biography → attributes → actorBase)に揃えた。
  コードとデータ定義の対応が読み取りやすい。
- **固有フィールドがない場合も `defineSchema()` を明示的に定義**: `{ ...super.defineSchema() }`
  のみでも `defineSchema` をオーバーライドしている。「意図してフィールドを追加しなかった」
  ことが将来のメンテナーに伝わる形。
- **template.json の削除範囲が最小限**: `Actor.types` 配列・`Actor.templates` セクションは
  手を付けず、3 type のエントリのみ削除。二重管理の解消と既存依存(cast / player)の保護を
  両立している。
- **CONFIG 登録が `init` フック内で行われている**: `ready` フックではなく `init` で登録。
  Foundry が Actor インスタンス化より前に DataModel を解決できる正しいタイミング。
- **テストの非存在確認**: 「mixin されていない template のフィールドが含まれない」ことを
  troop(biography なし)・extra(attributes / actorBase なし)で検証。存在確認と非存在確認を
  組み合わせることで mixin の選択を保護している。
- **テストカバレッジ**: 計 201 件(B-2 から 63 件増加)。

#### 課題

なし。B-3 のスコープ内で品質を満たした実装。

#### 推奨アクション

B-4(複雑な Actor type: cast / player の DataModel 化)に進む。以下を申し送る。

- `Actor.templates` セクション(biography / attributes / actorBase)の template.json
  からの削除は、cast / player の DataModel 化が完了する B-4 で行う。
- cast / player の DataModel 化でも今回の「mixin + 固有フィールド追加」パターンが
  そのまま使える。cast は biography + attributes + actorBase の mixin に加え、
  `player_name` / `playerId` / `history` / `exp` / `lifePath` の固有フィールドを追加する形になる。
- B-4 完了後、`CONFIG.Actor.dataModels` に cast / player を追加で登録する。

---

### B-4 複雑な Actor type の DataModel 化(フェーズB)

**日付**: 2026-05-22
**レビュー対象**: `scripts/data/actor/cast.mjs`, `scripts/data/actor/player.mjs`,
`scripts/tnx.mjs`(CONFIG 登録追加), `template.json`(Actor セクション整理),
`tests/setup.mjs`(MockObjectField 追加)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: 既存の経験点同期ロジック(`updateCastExp` / `syncPlayerExpFromCasts`)を
  一切変更せず DataModel 化のみを行えているか
- 拡張性: 将来の `prepareDerivedData` 化への移行余地を残しているか
- FVTT 慣行: `ObjectField` の使い方が適切か
- 既存設計との整合: `history` の実際のデータ構造(オブジェクトマップ)に対して
  DataModel 定義が破壊的でないか
- template.json の整理範囲が正確か(`Actor.types` 配列への player 追加含む)

#### 良かった点

- **既存ロジックへの無介入**: `updateCastExp` / `syncPlayerExpFromCasts` /
  `TnxHistoryMixin` / `tnx.mjs` の updateActor フックをすべて無変更のまま DataModel
  化を完了した。経験点同期という複雑な非同期ロジックを壊さないための最小限の変更に留めた。
- **ObjectField による history の表現**: template.json では `{}` の空オブジェクトとして
  定義されていた `history` フィールドを `ObjectField` で表現。中身スキーマを定義しない
  ことで、`system.history.${randomId}` 形式での動的な追加・削除・マージを既存コードの
  変更なしにサポートした。
- **MockObjectField の最小実装**: setup.mjs への追加は `MockArrayField` と同パターン。
  テスト環境を最小限の変更で拡張できた。
- **cast / player の構造差異をテストで明示**: `exp.additional` の有無、`biography` /
  `attributes` の mixin 有無など、cast と player の差異を「非存在確認」テストで保護した。
- **template.json の完全整理**: B-4 完了により Actor セクションが `types` 配列のみとなり、
  template.json のデータ二重管理が完全に解消された。`player` の `Actor.types` 追加により
  `system.json` の `documentTypes.Actor` との整合性も確保した。
- **テストカバレッジ**: 計 258 件(B-3 から 57 件増加)。

#### 課題

- ⚠️ **player_name がデッドフィールド**: template.json 準拠で `StringField` として定義
  したが、スクリプト・テンプレートのどこからも参照されていない。将来シートを実装する際に
  使用するか削除するかを判断する必要がある。フェーズ6(シート書き換え)で判断予定。
- ⚠️ **lifePath が UI 未実装**: cast の `lifePath.origin` / `experience` / `encounter` は
  DataModel に定義したが、cast-sheet.hbs に表示 UI が存在しない。フェーズ7(未実装シート
  の追加)または将来の cast シート実装時に対応予定。
- ⚠️ **exp 派生計算が非同期フックに依存**: `updateCastExp` / `syncPlayerExpFromCasts` は
  `async` で `Actor.update()` を呼ぶ設計。本来 DataModel の `prepareDerivedData` で
  同期的に計算すべき値だが、非同期処理への移行は大規模な設計変更を伴うため B-4 のスコープ外
  とした。将来フェーズ(B-8 以降の検証フェーズまたは独立したリファクタリングフェーズ)で
  検討する余地がある。

#### 推奨アクション

B-5(単純な Item type の DataModel 化)に進む。以下を申し送る。

- Actor 側の DataModel 化はすべて完了した。`CONFIG.Actor.dataModels` に全5 type が登録済み。
- B-5 / B-6 / B-7 で Item type の DataModel 化を進める際、`ObjectField` は今回の実装例
  (cast / player の `history`)を参照できる。
- `player_name` / `lifePath` のデッドフィールド / UI 未実装問題はフェーズ6 / 7 で対応。
