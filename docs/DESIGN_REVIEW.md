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

---

### B-5a 単純な Item type の DataModel 化(base のみ 3種)(フェーズB)

**日付**: 2026-05-22
**レビュー対象**: `scripts/data/item/housing-area.mjs`, `scripts/data/item/organization.mjs`,
`scripts/data/item/life-path.mjs`, `scripts/tnx.mjs`(CONFIG.Item.dataModels 登録追加),
`template.json`(housingArea / organization / lifePath エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-3 / B-4 の Actor 実装パターンを踏襲しているか
- 拡張性: B-5b / B-5c での mixin 追加に向けて、今回のパターンが流用できる形か
- FVTT 慣行: `CONFIG.Item.dataModels` への登録が `init` フックで正しく行われているか
- 既存設計との整合: template.json から削除した範囲が対象 3 type に限定されているか

#### 良かった点

- **Actor 側パターンの踏襲**: `SystemDataModel.mixin(BaseTemplate)` の記法が
  `SystemDataModel.mixin(BiographyTemplate, ...)` と完全に対称で、Actor / Item 間の
  実装一貫性を保てている。
- **CONFIG.Item.dataModels の初回登録**: B-4 まで Actor 側のみだった `CONFIG.*DataModels`
  登録に Item 側が加わった。`init` フックの正しいタイミングで登録されており、
  Actor 側と同じブロックの直後に配置して視認性を確保している。
- **template.json の整理範囲が最小限**: `Item.types` 配列・`Item.templates` セクション
  は保持し、3 type のエントリのみ削除。B-5 全体完了まで二重管理を最小化しつつ進める
  方針と整合している。
- **lifePathType の型判断を記録**: `@fileoverview` に「実質的に enum だが StringField
  のままとした理由と将来の対応」を明記。設計上の妥協点を将来のメンテナーに伝えている。
- **Cast Actor との混同防止**: `life-path.mjs` の `@fileoverview` に Cast Actor 側の
  `lifePath`(origin / experience / encounter)とは別物であることを明記した。
  2種の同名概念が共存する状況でのドキュメント対応として適切。
- **テストカバレッジ**: 計 283 件(B-4 から 25 件増加)。初期値の一致確認と
  非存在確認(他 type のフィールドが混入していないこと)を含む。

#### 課題

- ⚠️ **lifePathType が実質 enum**: 現状は `StringField` で定義。将来のシート実装時に
  選択肢付きフィールドに変更する必要が生じる可能性がある。`life-path.mjs` の
  `@fileoverview` に申し送り済み。

#### 推奨アクション

B-5b(base + outfitBase の 4種: armor / cyborg / combiner / general)に進む。
以下を申し送る。

- armor / cyborg は `defence: { S_defence, P_defence, I_defence }` 構造を共有する。
  B-5b では `defenceField()` ヘルパーを `helpers.mjs` に追加して両者で流用することを推奨。
- cyborg は `attack: { damageType: [], value, mod }` も持つ。B-6 の weapon でも同構造が
  出るため、`attackField()` ヘルパーの追加も B-5b のタイミングで検討する。
- `CONFIG.Item.dataModels` への B-5b 対象の追加は、既存の B-5a 登録ブロックに追記する形で進める。

---

### B-5b 単純な Item type の DataModel 化(base + outfitBase 4種)(フェーズB)

**日付**: 2026-05-22
**レビュー対象**: `scripts/data/item/helpers.mjs`(新設),
`scripts/data/item/armor.mjs`, `scripts/data/item/cyborg.mjs`,
`scripts/data/item/combiner.mjs`, `scripts/data/item/general.mjs`,
`scripts/tnx.mjs`(CONFIG.Item.dataModels 追記),
`template.json`(armor / cyborg / combiner / general エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-5a のパターンを踏襲しつつ、OutfitBaseTemplate mixin が正しく合成されているか
- 拡張性: defenceField() の切り出しタイミングが適切か / attack の inline 判断が妥当か
- FVTT 慣行: ArrayField(StringField) の使い方が正しいか
- 既存設計との整合: template.json から削除した範囲が対象 4 type に限定されているか

#### 良かった点

- **defenceField() の切り出しタイミング**: armor / cyborg の 2 箇所で同構造が出た時点で
  `scripts/data/item/helpers.mjs` として切り出した。B-2 の前例(「再利用が必要になった
  時点で切り出す」)に正確に倣っている。
- **attack の inline 判断**: B-5b 時点では cyborg のみで使用されるため inline に留め、
  `@fileoverview` に「B-7 weapon 着手時に attackField() ヘルパー化を再検討」と申し送り。
  過剰な先回り設計を避けつつ将来の対応点を明記した。
- **Item 専用 helpers.mjs の分離**: `scripts/data/helpers.mjs`(Actor 側)と
  `scripts/data/item/helpers.mjs`(Item 側)を別ファイルに分離。
  責務の分離が明確で混在を防いでいる。
- **combiner.combinedOutfitID の型**: Item ID 文字列の配列として `ArrayField(StringField)`
  で定義。template.json が `[]` のみの定義で要素型が明示されていない状況で、
  ID 文字列という用途から型を推測した判断として適切。
- **general の固有フィールドなし**: B-3 の GuestDataModel・B-5a の OrganizationDataModel
  と同パターン。`{ ...super.defineSchema() }` のみのオーバーライドで「意図してフィールドを
  追加しなかった」ことを示す。
- **テストカバレッジ**: 計 324 件(B-5a から 41 件増加)。defenceField() ヘルパー単体の
  5 件、各 DataModel の mixin 確認と非存在確認を含む。

#### 課題

- ⚠️ **attack フィールドは B-7 までヘルパー化されない**: weapon(B-7)でも同構造が
  出るため、B-7 着手時に `attackField()` ヘルパーを `scripts/data/item/helpers.mjs`
  に追加して cyborg / weapon 共用にすることを推奨。申し送り済み。

#### 推奨アクション

B-5c(base + outfitBase + extensible の 3種: ianus / tron / vehicle)に進む。
以下を申し送る。

- ExtensibleTemplate の mixin は B-5b の OutfitBaseTemplate 追加パターンをそのまま拡張できる。
- ianus は `controlMod` フィールド(NumberField)のみの固有フィールドを持つ。
- vehicle は `speedFactor` / `passenger` / `controlMod` の 3 フィールドを持つ。
- tron は固有フィールドなし(B-3 の guest / B-5a の organization / B-5b の general と同パターン)。
- `CONFIG.Item.dataModels` への B-5c 対象の追加は、既存の B-5a / B-5b 登録ブロックに追記する形で進める。

---

### B-5c 単純な Item type の DataModel 化(base + outfitBase + extensible 3種)(フェーズB)

**日付**: 2026-05-22
**レビュー対象**: `scripts/data/item/ianus.mjs`, `scripts/data/item/tron.mjs`,
`scripts/data/item/vehicle.mjs`, `scripts/tnx.mjs`(CONFIG.Item.dataModels 追記),
`template.json`(ianus / tron / vehicle エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-5a / B-5b の mixin パターンに第 3 テンプレート(ExtensibleTemplate)を
  追加した形で一貫しているか
- 拡張性: `controlMod` のヘルパー化見送りが妥当か
- FVTT 慣行: 3 テンプレート合成の mixin 記述が正しいか
- 既存設計との整合: template.json から削除した範囲が対象 3 type に限定されているか

#### 良かった点

- **3 テンプレート mixin の記述一貫性**: B-5b の `mixin(Base, Outfit)` に
  `ExtensibleTemplate` を 3 番目に追加した形。テンプレート順序が
  template.json の `"templates"` 配列順に対応しており読みやすい。
- **controlMod のヘルパー化見送り**: ianus / vehicle / armor(B-5b)の 3 箇所に存在するが、
  単一 `NumberField({ initial: 0 })` のみであり関数化してもコード量が変わらないと判断。
  「ヘルパー化すべき」という判断基準(SchemaField / 再利用頻度 / 保守上の意義)を
  明文化したうえで見送った。
- **tron の固有フィールドなし**: guest / organization / general と同じ「意図してフィールドを
  追加しなかった」パターン。B-5 全体を通して一貫。

#### 課題

なし。B-5c のスコープ内で品質を満たした実装。

#### B-5 全体完了の総括

**日付**: 2026-05-22
**完了した 10 type**:
- B-5a: housingArea / organization / lifePath(base のみ)
- B-5b: armor / cyborg / combiner / general(base + outfitBase)
- B-5c: ianus / tron / vehicle(base + outfitBase + extensible)

**新設ファイル**:
- `scripts/data/item/helpers.mjs`(defenceField())
- `scripts/data/item/{housing-area, organization, life-path, armor, cyborg, combiner, general, ianus, tron, vehicle}.mjs`

**テスト**: B-5 全体で 89 件追加(258 → 347 件)

**`CONFIG.Item.dataModels`**: init フックで 10 type 全登録済み

**申し送り事項**:
- `attackField()` ヘルパー化は B-7 weapon 着手時に再検討
- `lifePathType` の選択肢付き型へのリファクタは将来サブフェーズに送り
- `Item.types` 配列・`Item.templates` セクションは B-7 完了時に整理

#### 推奨アクション

B-6a(中程度の Item type の DataModel 化: outfit 系 3種)に進む。
B-6a の対象 type: weapon / tap / residence。
KI-007(`tap.conbatSpeedMod` タイポ)は B-6a で正しい綴り `combatSpeedMod` で定義することで解消する。
データマイグレーション機構は導入しない(実運用前のため不要。詳細は B-6a エントリ参照)。

---

### B-6a 中程度の Item type の DataModel 化(outfit 系 3種)(フェーズB)

**日付**: 2026-05-23
**レビュー対象**: `scripts/data/item/helpers.mjs`(attackField() 追加),
`scripts/data/item/cyborg.mjs`(attackField() 適用に変更),
`scripts/data/item/weapon.mjs`, `scripts/data/item/tap.mjs`,
`scripts/data/item/residence.mjs`,
`scripts/tnx.mjs`(CONFIG.Item.dataModels 追記),
`template.json`(weapon / tap / residence エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: B-5c の 3 テンプレート mixin パターンを踏襲しているか
- 拡張性: attackField() の切り出しタイミングが適切か
- FVTT 慣行: BooleanField の使い方(weapon の boolean 群)が正しいか
- KI-007 対応: タイポ修正をマイグレーションなしで解消した設計判断の妥当性
- マイグレーション不採用の設計判断: CLAUDE.md §4.2 の方針との整合性

#### 良かった点

- **attackField() の切り出しタイミング**: B-5b の申し送り(「weapon 着手時に再検討」)に
  正確に応答した。cyborg / weapon の 2 箇所で同構造が出た時点でヘルパー化。
  B-5b での先送り → B-6a での実施という一貫した判断軸。
- **cyborg.mjs のリファクタが意味的に無変更**: `attack: attackField()` に置き換えた後も
  生成スキーマは不変。既存の cyborg テストがグリーンのままであることで担保されている。
  回帰リスクのないリファクタとして適切に実施。
- **KI-007 のマイグレーションなし解消**: 実運用前で実データが存在しない状況で、
  DataModel 定義を正しい綴りで書くだけでタイポを解消した。CLAUDE.md §4.2「将来のために
  拡張ポイントを先回りで作らない」の精神に合致する判断。
- **tap の fileoverview に判断根拠を明記**: `combatSpeedMod` を正しい綴りで定義した理由と、
  Actor 側 `combatSpeedField()`(5 フィールド構造)との別物である旨を明記。
  同名の紛らわしい概念が複数存在する状況でのドキュメント対応として適切。
- **residence の *Mod フィールドをヘルパー化しない**: housingArea との 2 箇所共有だが、
  単一 `NumberField({ initial: 0 })` であり関数化のメリットが薄い。B-5c の
  controlMod と同じ判断基準を一貫して適用している。
- **テストカバレッジ**: 計 396 件(B-5 全体 347 件から 49 件増加)。
  attackField() 単体テスト 7 件、KI-007 タイポ確認(conbatSpeedMod が存在しないこと)、
  weapon の Boolean フィールド 4 件の型確認を含む。

#### 課題

なし。B-6a のスコープ内で品質を満たした実装。

#### マイグレーション機構不採用の設計判断記録

B-6 は当初「中程度の Item type + データマイグレーション機構の導入」と定義されていたが、
以下の理由でマイグレーション機構の導入を見送った。

1. **実運用前**: 移行対象の実データが存在しない。マイグレーションを実行しても変換すべきデータが
   ない状態。
2. **CLAUDE.md §4.2**: 「将来のために拡張ポイントを先回りで作らない。必要になったときに追加する」
   という明示的な方針に反する。
3. **KI-007 の性質**: 参照コードのない無害なタイポであり、機構なしで「正しい綴りで定義する」だけで
   解消できる。マイグレーションが本来必要な「既存データの変換」は不要。
4. **本当に必要なタイミング**: 実データがある状態で破壊的変更を行うとき(フェーズ7 以降または公開
   準備フェーズ)。その時点で改めて設計する方が、実際の要件に合った実装になる。

#### 推奨アクション

B-6b(skill 系 2種: miracle / generalSkill の DataModel 化)に進む。
以下を申し送る。

- miracle / generalSkill は `base + skillBase + usage`(または usage なし)の mixin 構成になる見込み。
  usage テンプレートは「判定システムの基盤」(CLAUDE.md §4.3)のため、DataModel 化の範囲と
  既存の `usage-list.hbs` / `UsageCreationDialog` への影響を慎重に確認してから実装すること。
- `Item.types` 配列・`Item.templates` セクションは B-7 完了時に整理する方針を維持。
- `attackField()` は B-6a で weapon / cyborg 共用として確立済み。

---

### B-6b 中程度の Item type の DataModel 化(skill 系 2種)(フェーズB)

**日付**: 2026-05-23
**レビュー対象**: `scripts/data/item/miracle.mjs`, `scripts/data/item/general-skill.mjs`,
`scripts/tnx.mjs`(CONFIG.Item.dataModels 追記),
`template.json`(miracle / generalSkill エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: usage / skillBase テンプレートを初めて実 type に mixin した際のパターン一貫性
- 拡張性: usageCount / initialSkill 等のヘルパー化見送りが妥当か
- 既存設計との整合: 既存シートロジック(general-skill-sheet の連動更新)に触れていないか
- usage テンプレートの不変性: usage.mjs / usage-list.hbs / UsageCreationDialog を
  一切変更していないか

#### 良かった点

- **usage / skillBase の初適用**: B-2 で DataModel 化した UsageTemplate / SkillBaseTemplate
  が、本サブフェーズで初めて実 Item type の mixin として機能した。テンプレート設計の
  正しさがここで初めて実証される形となった。
- **mixin 合成順が templates 配列順に対応**: miracle は `mixin(Base, Usage)`、
  generalSkill は `mixin(Base, Usage, SkillBase)` と template.json の配列順に忠実。
  B-5 以降一貫している規約を正確に踏襲。
- **usageCount の初期値が 1**: template.json に忠実に `value: 1 / total: 1` とした。
  既存フック(preUpdateItem / preDeleteItem)が usageCount を参照しているため、
  初期値ミス(0 にするなど)は実機で重大バグになりえる。テストで明示的に `toBe(1)` を
  検証し、将来の誤修正を防いでいる。
- **既存シートロジックへの無介入**: general-skill-sheet の initialSuit ↔ suits ↔ level
  連動更新は DataModel 化の対象外として明確にスコープ外に置いた。`@fileoverview` に
  その旨を明記。
- **generalSkillCategory を StringField のままとした判断**: B-5a の lifePathType と同じ
  判断基準(実質 enum だが、将来の選択肢付き型リファクタまで StringField を維持)を
  一貫して適用。`@fileoverview` に申し送り済み。
- **ヘルパー化しない判断**: usageCount / initialSkill / onomasticSkill はいずれも当該
  type 固有の 1 箇所のみ。B-5c の controlMod と同じ判断で inline SchemaField に留めた。
  過剰な汎化を避ける一貫した姿勢。
- **テストカバレッジ**: 計 443 件(B-6a の 396 件から 37 件増加)。
  miracle の usageCount.value / total が 1 であることの明示的な検証、
  miracle に skillBase フィールドが含まれないことの非存在確認を含む。

#### 課題

- ⚠️ **generalSkillCategory が実質 enum**: B-5a の lifePathType と同じ状況。
  将来のシート実装時に選択肢付き型へのリファクタが必要になる可能性がある。
  `general-skill.mjs` の `@fileoverview` に申し送り済み。

#### B-6 全体完了の総括

**日付**: 2026-05-23
**完了した 5 type**:
- B-6a: weapon / tap / residence(base + outfitBase + extensible)
- B-6b: miracle / generalSkill(base + usage / base + usage + skillBase)

**新設ファイル**:
- `scripts/data/item/{weapon, tap, residence, miracle, general-skill}.mjs`
- `tests/template-integrity.test.mjs`(B-6 補助タスク: template.json 恒久健全性テスト)

**テスト**: B-6 全体で 96 件追加(347 → 443 件)

**`CONFIG.Item.dataModels`**: init フックで 15 type 登録済み

**設計判断**:
- マイグレーション機構は実運用前のため導入しない(CLAUDE.md §4.2 に準拠)
- KI-007(tap タイポ)は正しい綴りで定義することでマイグレーションなしで解消
- template.json の健全性(JSON 妥当性 + 二重定義なし)を恒久テストで CI 担保

**申し送り事項**:
- `Item.types` 配列・`Item.templates` セクションは B-7 完了時に整理
- generalSkillCategory / lifePathType の選択肢付き型リファクタは将来フェーズに送り
- B-7 対象: style / styleSkill(template.json に残る最後の 2 type 別エントリ)

#### 推奨アクション

B-7a(style の DataModel 化)に進む。以下を申し送る。

- style / styleSkill は Items の中で最もフィールド数が多く設計が複雑。
  特に styleSkill は confrontation / comboSkill / timing 等の配列フィールドと
  SchemaField のネストが複雑。事前に `tnx-style-sheet.mjs` / `tnx-style-skill-sheet.mjs`
  の getData() を読んで、どのフィールドがシートで使われているかを把握してから着手すること。
- B-7 完了時に `Item.templates` セクションと `Item.types` 配列の整理を行う。

---

### B-7a 複雑な Item type の DataModel 化(style)(フェーズB)

**日付**: 2026-05-23
**レビュー対象**: `scripts/data/item/style.mjs`,
`scripts/tnx.mjs`(CONFIG.Item.dataModels 追記),
`template.json`(style エントリ削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: base のみの mixin で素直に実装できているか
- 設計の正確性: reason 等が Actor の attributeField()(14 フィールド)と別物であることを
  認識して正しく実装されているか
- 既存ロジックへの無介入: preUpdateItem/preDeleteItem フック・style-sheet に触れていないか
- ローカルヘルパーの適切性: abilityField() を style.mjs 内に閉じた判断が妥当か

#### 良かった点

- **ローカルヘルパー関数 abilityField() の採用**: `{value, control}` の 2 フィールド
  SchemaField が reason/passion/life/mundane の 4 箇所で繰り返されるため、style.mjs 内に
  ローカル関数として切り出した。DRY の観点と「複数 type 共用にするほどではない(style 専用)」
  という判断を両立している。
- **Actor の attributeField() と明確に区別**: style の reason 等(2 フィールド)が
  Actor の reason(14 フィールド、`attributeField()`)と別物であることを `@fileoverview`
  に明記し、混同リスクを文書で排除した。
- **level の初期値が 1**: template.json に忠実。miracle.usageCount.value と同様、
  初期値ミス(0 にするなど)が実機で重大バグになりえる箇所を正確に実装し、
  テストで `toBe(1)` を明示的に検証している。
- **level の範囲制約を入れない判断**: 既存の preUpdateItem フックと cast-sheet が
  レベル制御を担っているため DataModel 側で min/max を設定しない。過剰な制約追加を避け、
  既存ロジックへの依存を変えない。`@fileoverview` に判断根拠を記録済み。
- **既存ロジックへの無介入**: preUpdateItem(style レベル変更時の miracle usageCount 増減
  および isPersona/isKey 強制設定)/ preDeleteItem(miracle 連動削除)/ cast-sheet の
  排他制御すべてを変更しなかった。B-7a のスコープを DataModel 化に限定する方針を徹底。
- **テストの ability ループ**: 4 つの能力値フィールドを `for...of` ループで検証。
  フィールドが増えた場合も一箇所の修正で対応できる形。

#### 課題

なし。B-7a のスコープ内で品質を満たした実装。

#### 推奨アクション

B-7b(styleSkill の DataModel 化)に進む。以下を申し送る。

- styleSkill は template.json 定義と実際のシート動作(getData)の間で乖離が確認されている
  (`tnx-style-skill-sheet.mjs` の getData を要事前確認)。
- confrontation / comboSkill / timing は `["blank"]` 初期値の配列フィールド。要素型の
  判断が必要(StringField か SchemaField か)。
- 4 種類の SchemaField ネスト(special / performance / secret / mystery)の expCost 等の
  初期値を正確に確認すること。
- B-7b 完了時に `Item.templates` セクションと `Item.types` 配列の整理を行う。

---

### B-7b 複雑な Item type の DataModel 化(styleSkill)+ Item 完了(フェーズB)

**日付**: 2026-05-23
**レビュー対象**: `scripts/data/item/style-skill.mjs`,
`scripts/tnx.mjs`(CONFIG.Item.dataModels 全 17 type 登録完了),
`template.json`(Item セクションを空オブジェクト {} に整理),
`tests/template-integrity.test.mjs`(フェーズB 完了形状に対応)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 設計判断の妥当性: 配列要素の型定義方針(SchemaField vs StringField)
- ★ フィールドの網羅: template.json 未定義だがシートが参照する 8 フィールドの明示定義
- mixin 合成の正確性: base + usage + skillBase の順序、skillBase 由来の重複定義なし
- unique の初期値修正: template.json の "" ではなく "none" が正しいことの確認
- タイポ・命名揺れの維持判断: RewritedTarget / RewritingMiracle_ID
- template.json Item セクション整理の適切性

#### 設計判断の汎用記録

**template.json の配列定義は要素スキーマを表現できない**。`template.json` では配列フィールドは
`["blank"]` のような「配列であること」しか表現できない形式で定義される。これは template.json の
制約によるもので、DataModel 化では追従すべき仕様ではない。**DataModel 化においては、シート
実装(getData() の ensureArray 正規化構造・_onSelectChange の保存データ)を真実の源として、
要素の SchemaField を確定する**。この方針は B-7b の styleSkill で初めて適用されたが、
将来の DataModel 化においても同様の状況では同じアプローチをとる。

#### 良かった点

- **★ フィールドの完全網羅**: template.json に未定義だがシートの `_onSelectChange` が
  リセット先として参照する 8 フィールド(maxLevelNumber / maxLevelOther / targetOther /
  rangeOther / targetValueNumber / targetValueOther / comboSkillOther / confrontationOther)
  をすべて明示定義した。未定義のままにすると `_onSelectChange` でバリデーションエラーになる。
- **配列要素を実態の SchemaField で定義**: comboSkill / confrontation / timing について、
  template.json の `["blank"]` 近似ではなく、getData() の正規化後の要素構造
  `{value, name, isMandatory}` / `{value, name}` / `{value, actionName, processName, timingOther}`
  を SchemaField で定義した。既存シートの `ensureArray` は引き続きフォールバックとして機能する。
- **unique の initial 修正**: template.json に `""` と定義されていたが、シートの選択肢定義
  (`TnxSkillUtils.getSkillOptions`) における先頭値が `"none"` であることから、正しい
  デフォルト値は `"none"` と判断。template.json の誤りを修正した。
- **タイポ・命名揺れの意識的な維持**: `RewritedTarget`(→ RewrittenTarget が正)および
  `RewritingMiracle_ID`(→ rewritingMiracleId が正)はタイポ・命名規約違反だが、
  シート・ロジックが同じ名前で参照しているため本フェーズではリネームせずそのまま維持。
  KI-018 / KI-019 として記録した。将来のシート全体整理フェーズで対応。
- **uses の inline 定義**: outfitBase の uses SchemaField と同型だが styleSkill 固有の
  別フィールド。OutfitBaseTemplate を共用せず inline 定義にとどめた。過剰な共用化を避けた。
- **template.json Item セクションの整理**: styleSkill(最後の type エントリ)削除と同時に
  `Item.templates` セクション・`Item.types` 配列も削除し `Item: {}` に整理。v13 では
  type の権威は system.json の documentTypes であり、両者が揃うことで二重管理が解消。
- **template.json ファイル自体の維持**: htmlFields 等のサニタイズ宣言が documentTypes に
  マージされる経路の検証を B-8 に委ねるため、ファイルは削除しなかった。安全な選択。
- **integrity テストの意図保持**: "Item.types が配列として存在する" テストを
  "フェーズB 完了後: Item セクションは空オブジェクト" に更新し、
  「JSON 妥当性 + DataModel と template.json の二重定義禁止」という本来の意図を維持。

#### B-7 全体総括(B-7a + B-7b)

| サブフェーズ | 対象 | mixin | 特記事項 |
|---|---|---|---|
| B-7a | style | base | ローカル abilityField() / level initial=1 |
| B-7b | styleSkill | base+usage+skillBase | ★8フィールド / 配列SchemaField / unique修正 |

#### フェーズB Item DataModel 化 完了総括

B-5〜B-7 の全サブフェーズで Item 全 17 type の DataModel 化が完了した。

| B-5 対象(10 type) | B-6 対象(4 type) | B-7 対象(3 type) |
|---|---|---|
| armor / ianus / cyborg / tron / vehicle | weapon / tap / residence / miracle / generalSkill | style / styleSkill |
| housingArea / combiner / general / organization / lifePath | (generalSkill は B-6b) | |

- `CONFIG.Item.dataModels` に全 17 type 登録完了
- `template.json` の Item セクションは空オブジェクト `{}` に整理
- `template.json` ファイル自体は B-8 での htmlFields 検証後に廃止予定
- 全テスト 530 件グリーン / ESLint 0 errors

#### 推奨アクション(B-8 申し送り)

1. **template.json ファイルの廃止**: Actor セクション(`types` 配列)の削除を含む。
   検証事項: `htmlFields` / `gmOnlyFields` 等のサニタイズ宣言が `system.json` の
   `documentTypes` 側に存在するか(または DataModel の `HTMLField` 等で代替されているか)。
   `description` の ProseMirror サニタイズがサニタイズ宣言を失わないことを確認してから廃止。
2. **v13 実機確認**: template.json 削除後も全 type が正常認識されること。
3. **既存機能の検証**: 既存シート・EXP 計算・カード判定・神業 usageCount 等が
   DataModel 移行後も正常動作することを確認。

---

### B-8 Card type の DataModel 化(フェーズB)

**日付**: 2026-05-23
**レビュー対象**: `scripts/data/card/common/base.mjs`(CardBaseTemplate),
`scripts/data/card/playing-cards.mjs`, `scripts/data/card/neuro-cards.mjs`,
`scripts/data/card/other.mjs`,
`scripts/tnx.mjs`(CONFIG.Card.dataModels 登録追加)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 保守性: organization.mjs パターンとの一貫性
- 層依存: data/card → data/item の依存を避けた CardBaseTemplate の独立定義の妥当性
- FVTT 慣行: `CONFIG.Card.dataModels` への登録が `init` フックで正しく行われているか
- スコープの適切性: Foundry Card コアフィールド(suit / value 等)を system 側に持たせないこと

#### 良かった点

- **organization.mjs パターンの踏襲**: `SystemDataModel.mixin(CardBaseTemplate)` と
  `defineSchema()` の記法が Actor / Item 側と完全に対称。フェーズB 全体の実装一貫性を保てている。
- **CardBaseTemplate の独立定義**: `Item.BaseTemplate` は「全 Item 共通」と明記されており、
  data/card → data/item の層またぎを避けるため `scripts/data/card/common/base.mjs`
  として独立定義した。フィールド定義は同一だが概念的に別階層に属する。
- **Foundry コアフィールドの不干渉**: suit / value / face 等は Foundry Card document の
  コアフィールドであり、system 側には持たせない方針を `@fileoverview` に明記した。
- **CONFIG.Card.dataModels への登録**: Actor / Item の登録ブロック直後に同スタイルで配置し、
  3 type のキー名が template.json の types 配列(playingCards / neuroCards / other)と
  完全一致することを確認。
- **テストカバレッジ**: 計 542 件(B-7b の 530 件から 12 件増加)。
  各 type で description の存在、level・suit の非存在を確認。

#### 課題

なし。B-8 のスコープ内で品質を満たした実装。

#### 推奨アクション

B-9(template.json の廃止)に進む。以下を申し送る。

- DataModel 化対象の全 25 type(Actor 5 + Item 17 + Card 3)が揃った。
- B-9 での template.json 廃止前に、description 等の ProseMirror 対象フィールドの
  サニタイズ宣言が system.json の documentTypes 側または DataModel の HTMLField で
  カバーされているかを確認すること(PHASE_B_TASKS.md B-9 の事前確認事項参照)。
- template.json には Actor.types 配列と Card セクションが残置。B-9 でこれらを含む
  ファイル全体を廃止する。

---

### B-9 template.json 廃止 + description の HTMLField 化(フェーズB)

**日付**: 2026-05-24
**レビュー対象**: `scripts/data/item/common/base.mjs`, `scripts/data/card/common/base.mjs`,
`scripts/data/actor/common/biography.mjs`(description HTMLField 化),
`system.json`(documentTypes に htmlFields 宣言追加),
`tests/setup.mjs`(MockHTMLField 追加),
`tests/template-integrity.test.mjs`(documentTypes ベースに全面書き換え),
`template.json`(廃止・削除)
**ステータス**: レビュー済(問題なし)

#### レビュー観点

- 不可逆作業の順序: HTMLField 化(可逆)→ テストグリーン確認 → template.json 削除(不可逆)
- htmlFields 宣言の type 集合と description 保有 type の完全一致
- template.json 削除後の全 25 type の正常認識可否(system.json documentTypes が権威)
- integrity テストの意図保持: JSON 妥当性 + 型定義整合を documentTypes ベースで継続

#### 良かった点

- **不可逆作業の安全な順序**: HTMLField 化をコミット(可逆)した後に npm test グリーンを
  確認し、その後 template.json を削除(不可逆)した。削除前のグリーン確認が安全弁として
  機能した。
- **htmlFields 宣言の type 集合が description 保有 type と完全一致**: biography mixin を
  持つ Actor(cast / guest / extra)のみに付与し、troop(memo のみ) / player(attributes + actorBase)
  を正しく除外した。Item 全 17 / Card 全 3 はすべて BaseTemplate / CardBaseTemplate 経由で
  description を持つため全件付与。過不足なし。
- **integrity テストの意図を documentTypes ベースで継続**: 旧テストの「JSON 妥当性」「DataModel
  との二重定義禁止」という意図を「system.json 妥当性」「documentTypes への全 25 type 存在確認」
  「DataModel ファイルと documentTypes.Item の過不足なし確認」として正確に置き換えた。
  テスト件数は 10 → 12 件(+2)と増加し、検証密度も向上した。
- **MockHTMLField の最小実装**: setup.mjs への追加は既存の MockStringField と同パターン。
  テスト環境を最小限の変更で拡張した。
- **description フィールドのトップレベル限定**: actions[].description(UsageTemplate 内の
  プレーンテキスト用)は対象外とし、ProseMirror 編集対象のトップレベル description のみを
  HTMLField 化した。スコープの逸脱なし。

#### 課題

なし。B-9 のスコープ内で品質を満たした実装。

#### フェーズB DataModel 化 完了総括

B-1〜B-9 の全サブフェーズが完了した。

| 完了項目 | 内容 |
|---|---|
| DataModel 化 | Actor 5 + Item 17 + Card 3 = 全 25 type |
| CONFIG 登録 | `CONFIG.Actor/Item/Card.dataModels` に全 type 登録済み |
| HTMLField 化 | description(トップレベル)を 3 テンプレートで HTMLField に変更 |
| htmlFields 宣言 | system.json documentTypes に全対象 type へ宣言追加 |
| template.json | 廃止済み。type 権威は system.json documentTypes に一本化 |
| テスト | 544 件グリーン / ESLint 0 errors |

#### 推奨アクション

B-10(移行後の検証)に進む。実機確認はユーザー主役。

- 既存シート(cast / guest 等)の正常表示
- EXP 計算が変わらず動作すること
- カード判定・神業 usageCount 等の既存ロジックが破壊されていないこと
- 確認後に v0.2.0 タグを打つ(PHASE_B_TASKS.md の完了条件を参照)
