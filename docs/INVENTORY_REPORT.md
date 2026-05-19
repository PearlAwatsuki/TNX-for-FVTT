棚卸しレポート

  1. 対象FVTTバージョン

  - system.json : minimum: 11, verified: 12.343
  - コード上の根拠:
    - foundry.utils.mergeObject / setProperty / hasProperty / deepClone / isEmpty / randomID（v10+）
    - actor.updateSource()（v11+）
    - CONST.DOCUMENT_OWNERSHIP_LEVELS（v10+）
    - Math.clamp（コメントで「Math.clamped → Math.clamp
  に修正」と記されている。Math.clampedはv11以前、Math.clampはv12で変更）
    - Cards API（card.play(), pile.pass(), deck.draw(), deck.recall()）はv10で安定化されv12で確認
  - 実態: FVTTv12をターゲットとしたコード

  ---
  2. データモデル

  DataModelクラスの使用有無

  template.json 依存のみ。DataModel / TypeDataModel / SystemDataModel のサブクラスは一切存在しない。

  TokyoNovaItem（scripts/item/item.mjs）は Item
  を継承するが、コンストラクタでデフォルトアイコンを設定するだけで、データ定義は行っていない。Actor
  のサブクラスも定義されていない。

  Actorフィールド構成（template.json）

  ┌────────┬─────────────────────────┬──────────────────────────────────────────────────────────────────────────────┐
  │  種別  │      テンプレート       │                                固有フィールド                                │
  ├────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
  │ cast   │ biography, attributes,  │ player_name, playerId, history, exp(value/spent/total/additional),           │
  │        │ actorBase               │ lifePath(origin/experience/encounter)                                        │
  ├────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
  │ guest  │ biography, attributes,  │ なし                                                                         │
  │        │ actorBase               │                                                                              │
  ├────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
  │ troop  │ attributes, actorBase   │ memo                                                                         │
  ├────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
  │ extra  │ biography               │ なし                                                                         │
  ├────────┼─────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
  │ player │ actorBase               │ history, exp(value/total/spent)                                              │
  └────────┴─────────────────────────┴──────────────────────────────────────────────────────────────────────────────┘

  biography テンプレート: charaname_ruby, handle, handle_ruby, post(name/id), citizenRank, age, gender, birthday,
  height, weight, eyes, hair, skin, description

  attributes テンプレート: reason/passion/life/mundane それぞれに
  value/control/styleA_value/styleA_control/.../styleC_control/growth/controlGrowth/mod/controlMod/effectMod/controlEffe
  ctMod。combatSpeed(value/base/current/mod/freeMod)。physicalDamage/mentalDamage/socialDamage(value/min/max)。

  actorBase テンプレート: handMaxSize, handPileId, trumpCardPileId

  備考:
  - template.json の "types": ["cast", "guest", "troop", "extra"] に player は含まれていない。player は system.json の
  documentTypes にのみ記載されており、v12ではこちらが権威となる。ただし template.json の player
  ブロック自体は存在し、フィールドは有効に機能する。
  - attributes.combatSpeed は system.json の initiative 式 @system.CS.value
  と対応していない（フィールドパスが合っていない）。

  Itemフィールド構成（template.json）

  種別: style
  テンプレート: base
  固有フィールド（主要）: isPersona, isKey, level(1-3), miracle(name/id), reason/passion/life/mundane(value/control)
  ────────────────────────────────────────
  種別: miracle
  テンプレート: base, usage
  固有フィールド（主要）: furigana, usageCondition, isKill, isDefence, isAll, isUsed, usageCount(value/total/mod)
  ────────────────────────────────────────
  種別: generalSkill
  テンプレート: base, usage, skillBase
  固有フィールド（主要）: generalSkillCategory, initialSkill(initialSuit/expCost), onomasticSkill(isInitial/expCost)
  ────────────────────────────────────────
  種別: styleSkill
  テンプレート: base, usage, skillBase
  固有フィールド（主要）: styleSkillCategory, unique, style, comboSkill[], maxLevel, timing[], target, range,
    targetValue, confrontation[], isFixedRange, isFixedTarget, isEssentialSkill, isSubstitute, substituteTarget[],
    RewritedTarget, rewritingMiracleName, RewritingMiracle_ID, uses, special/performance/secret/mystery(expCost)
  ────────────────────────────────────────
  種別: weapon
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: attack(damageType/value/mod), guardValue, range, isthrow, isLaser, isBiological, isFullAuto,
    FAValue
  ────────────────────────────────────────
  種別: armor
  テンプレート: base, outfitBase
  固有フィールド（主要）: defence(S/P/I_defence), controlMod
  ────────────────────────────────────────
  種別: ianus
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: controlMod
  ────────────────────────────────────────
  種別: cyborg
  テンプレート: base, outfitBase
  固有フィールド（主要）: defence, attack, guardValue
  ────────────────────────────────────────
  種別: tron
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: なし
  ────────────────────────────────────────
  種別: tap
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: cycle, conbatSpeedMod ※タイポ
  ────────────────────────────────────────
  種別: vehicle
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: speedFactor, passenger, controlMod
  ────────────────────────────────────────
  種別: residence
  テンプレート: base, outfitBase, extensible
  固有フィールド（主要）: appearanceTarget, cyberSecurity, analogSecurity, housingArea, buyRatingMod等
  ────────────────────────────────────────
  種別: housingArea
  テンプレート: base
  固有フィールド（主要）: buyRatingMod, preserveExpMod, appearanceTargetMod, cyberSecurityMod, analogSecurityMod
  ────────────────────────────────────────
  種別: combiner
  テンプレート: base, outfitBase
  固有フィールド（主要）: combinedOutfitID[]
  ────────────────────────────────────────
  種別: general
  テンプレート: base, outfitBase
  固有フィールド（主要）: なし
  ────────────────────────────────────────
  種別: organization
  テンプレート: base
  固有フィールド（主要）: なし
  ────────────────────────────────────────
  種別: lifePath
  テンプレート: base
  固有フィールド（主要）: lifePathType, skillName

  skillBase テンプレート: level, suits(spade/heart/diamond/club), isAction

  outfitBase テンプレート: isPrepared, isOption, isPre-play, isCyber, majorCategory, minorCategory, buy, preserveExp,
  hide, appearancePenalty, hack, part, timing, exclusive, uses(isLimit/max/value)

  extensible テンプレート: slotlabel/value/optionId[]

  usage テンプレート: actions[]

  ---
  3. 派生値・計算ロジック

  prepareData等の有無

  Actor / Item での prepareData() / prepareDerivedData() オーバーライドは存在しない。

  派生値はすべて「イベント駆動の手動計算」として実装されている。

  能力値の導出（表示用）

  TokyoNovaCastSheet.getData() 内の _getAbilitiesData() で毎回計算される（永続化されない）。

  totalValue = growth + (Σ styleLevel × styleValue) + mod + effectMod
  totalControl = controlGrowth + (Σ styleLevel × styleControl) + controlMod + controlEffectMod

  スタイル技能の level はスートのチェック数と連動（TnxSkillUtils.onSuitChange）。

  経験点の計算（TokyoNovaCastSheet.updateCastExp static）

  ready フックで登録された createItem / deleteItem / updateItem / updateActor の全フックから呼ばれる。計算後に
  actor.update() で DB に書き戻す（{calcExp: false} オプションで再帰を防止）。

  historyTotal = プレイヤーリンクあり → playerActor.system.exp.total
                リンクなし  → Σ actor.system.history[*].exp

  abilityExpCost = Σ ability (growth × 段階コスト: baseValue < 閾値なら20, 以上なら40)
                   ※control系は閾値=17、value系は閾値=11

  itemExpCost = generalSkill: カテゴリ・isInitialによりlevel×コスト
                styleSkill: カテゴリによりlevel×コスト(special:10, performance:2, secret:20, mystery:50)

  newTotal  = additional + historyTotal
  newValue  = (newTotal + 170) - (abilityExpCost + itemExpCost)
  newSpent  = (abilityExpCost + itemExpCost) - 170

  プレイヤー↔キャストEXP同期

  updateActor フックで syncPlayerExpFromCasts() が呼ばれ、リンクされた全キャストの exp.spent を集計してプレイヤーの
  exp.spent / exp.value を更新する。

  手札上限

  ready フック起動時に全キャストの handMaxSize を defaultHandMaxSize 設定値（＋ActiveEffect の handMaxSizeMod
  修正値）に一括更新する。ただし handMaxSizeMod は template.json に定義されていない。

  ---
  4. シート（UI）

  ApplicationV1 / V2

  全シートが ApplicationV1（ActorSheet / ItemSheet / Application / FormApplication / JournalSheet
  の直接継承または継承チェーン）。ApplicationV2 / DocumentSheetV2 は使用していない。

  実装済みシート一覧

  ┌────────────────────────┬─────────────────┬──────────────────────────┬──────────────────────────────────────────┐
  │         クラス         │     継承元      │           対象           │                 ファイル                 │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaCastSheet     │ ActorSheet      │ cast                     │ scripts/actor/tnx-cast-sheet.mjs         │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaPlayerSheet   │ ActorSheet      │ player                   │ scripts/actor/tnx-player-sheet.mjs       │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaItemSheet     │ ItemSheet       │ 基底（直接登録なし）     │ scripts/item/tnx-item-sheet.mjs          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaStyleSheet    │ TokyoNovaItemSh │ style                    │ scripts/item/tnx-style-sheet.mjs         │
  │                        │ eet             │                          │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaMiracleSheet  │ TokyoNovaItemSh │ miracle                  │ scripts/item/tnx-miracle-sheet.mjs       │
  │                        │ eet             │                          │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaGeneralSkillS │ TokyoNovaItemSh │ generalSkill             │ scripts/item/tnx-general-skill-sheet.mjs │
  │ heet                   │ eet             │                          │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaStyleSkillShe │ TokyoNovaItemSh │ styleSkill               │ scripts/item/tnx-style-skill-sheet.mjs   │
  │ et                     │ eet             │                          │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TokyoNovaOrganizationS │ ItemSheet（直接 │ organization             │ scripts/item/tnx-organization-sheet.mjs  │
  │ heet                   │ ）              │                          │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TnxScenarioSheet       │ JournalSheet    │ JournalEntry（アクトシー │ scripts/journal/tnx-scenario-sheet.mjs   │
  │                        │                 │ ト）                     │                                          │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TnxHud                 │ Application     │ 常駐HUD                  │ scripts/module/tnx-hud.mjs               │
  ├────────────────────────┼─────────────────┼──────────────────────────┼──────────────────────────────────────────┤
  │ TnxScenarioSettingWiza │ FormApplication │ セットアップウィザード   │ scripts/module/tnx-scenario-setting-wiza │
  │ rd                     │                 │                          │ rd.mjs                                   │
  └────────────────────────┴─────────────────┴──────────────────────────┴──────────────────────────────────────────┘

  カスタムシートが未登録の Actor 種別: guest / troop / extra → コアデフォルトのActorSheetが使用される

  カスタムシートが未登録の Item 種別: weapon, armor, ianus, cyborg, tron, tap, vehicle, residence, housingArea,
  combiner, general, lifePath → コアデフォルトのItemSheetが使用される

  共通UIパターン

  - 全シートに view/edit モード切替（_isEditMode フラグ + CSS クラス付け替え）を _render() オーバーライドで実装
  - UUID コピーボタンをすべてのシートヘッダーに追加
  - テキスト自動スケーリング（_applyTextSqueezing()）をCastSheetとPlayerSheetに実装

  テンプレート構成

  templates/
    actor/cast-sheet.hbs        ← castシート本体
    actor/player-sheet.hbs      ← playerシート本体
    item/style-sheet.hbs
    item/miracle-sheet.hbs
    item/general-skill-sheet.hbs
    item/style-skill-sheet.hbs
    item/organization-sheet.hbs
    journal/scenario-sheet.hbs
    hud/hud.hbs
    chat/scene-card.hbs         ← シーン/ニューロカードのチャット表示
    dialog/ (8ファイル)
    parts/
      active-effects-list.hbs   ← エフェクトリスト（共通パーシャル）
      bad-status-list.hbs       ← バッドステータス表示
      history-list.hbs          ← 経験点履歴リスト
      usage-list.hbs            ← 用途リスト
      prosemirror-editor.hbs
      scenario-setting-wizard.hbs

  ---
  5. 判定ロジック

  Roll クラスの使用は一切ない。ダイスロールは実装されていない。

  トーキョーN◎VAのゲームシステムはカードで判定を行う。実装されている判定操作は以下のみ：

  ┌───────────────┬────────────────────────┬───────────────────────────────────────────────────────────────────────┐
  │     操作      │        実装箇所        │                                 内容                                  │
  ├───────────────┼────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ 山札から判定  │ TnxActionHandler.check │ 山札から1枚を捨て札に表向きで移動し、チャット通知                     │
  │               │ FromDeck()             │                                                                       │
  ├───────────────┼────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ ドロー        │ TnxActionHandler.drawC │ 山札から手札に1枚引く                                                 │
  │               │ ard()                  │                                                                       │
  ├───────────────┼────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ プレイ        │ TnxActionHandler.playC │ 手札から捨て札に移動                                                  │
  │               │ ard()                  │                                                                       │
  ├───────────────┼────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ 切り札使用    │ TnxActionHandler.useTr │ 切り札置き場からシーンカード置き場（PCの場合）またはRL切り札捨て場（G │
  │               │ ump()                  │ Mの場合）へ移動し、チャット投稿                                       │
  ├───────────────┼────────────────────────┼───────────────────────────────────────────────────────────────────────┤
  │ ニューロカー  │ TnxActionHandler.drawN │ ニューロデッキからシーンカード置き場に移動し、チャット投稿            │
  │ ドドロー      │ euroCard()             │                                                                       │
  └───────────────┴────────────────────────┴───────────────────────────────────────────────────────────────────────┘

  チャット投稿はすべて ChatMessage.create() で生のHTMLを送信しており、カスタム ChatMessage クラスや renderChatMessage
  フックは実装されていない。

  ---
  6. その他のモジュール

  登録済みHooks（tnx.mjs）

  init フック内:
  - preCreateActor: castタイプ作成時に所有権をOBSERVER/OWNERに設定
  - preCreateItem: 非GMが作成した場合にOWNER権限を付与
  - preCreateCard: 切り札置き場の上限（1枚）チェック
  - createActor: player→手札/切り札自動作成、cast→初期技能インポート＋手札作成確認ダイアログ
  - preDeleteItem: miracleのusageCount-1による削除抑制、styleのmiracle連動削除
  - preDeleteActor: cast/playerのリンクカード削除確認ダイアログ
  - preUpdateItem: miracleのisUsedリセット時にtotalをリセット、styleレベル変更時のmiracle
  usageCount増減とisPersona/isKey強制設定
  - updateActor: playerタイプのカード権限名前同期
  - createCard / deleteCard: game.tnx.refreshSheets()によるUI更新（50ms setTimeout）
  - renderSettingsConfig: 設定画面のドロップダウン化
  - renderJournalDirectory: ジャーナル作成ボタンのカスタムメニュー化
  - renderHotbar: ホットバーを初期折りたたみ状態に

  ready フック内:
  - createItem / deleteItem / updateItem: TokyoNovaCastSheet.updateCastExp()
  - updateActor: EXP再計算、プレイヤーEXP同期、リンクキャストへの履歴/exp同期

  ソケット

  system.json に "socket": true が設定されているが、game.socket.emit() / game.socket.on() の実装は存在しない。

  カードデータ生成

  - tnx-playing-cards.mjs: 標準トランプ52枚×デッキ数＋ジョーカー2枚を生成
  - tnx-neuro-cards.mjs: ニューロデッキ31枚の定義（value: -18〜21）
  - tnx-access-cards.mjs: アクセスカード8枚の定義（シーン・プレイヤー、切り札、YES/NO等）

  CompendiumPacks

  system.jsonで7パックを定義：styles, miracles, general-skills, style-skills, works-skills, outfits,
  works-outfits（すべてItemタイプ）。PLAYER=OBSERVER, ASSISTANT=OWNERのデフォルト所有権設定。

  ダイアログクラス（tnx-dialog.mjs）

  - DeckCreationDialog, AmountInputDialog, TargetSelectionDialog, CardSelectionDialog, RichConfirmDialog,
  DealTrumpDialog, UnlinkConfirmDialog, UsageCreationDialog

  すべてPromiseをwrapした静的メソッドprompt()パターン。

  Mixin

  - TnxHistoryMixin: EXP履歴テーブルの行追加/削除/変更。_performHistoryUpdate()を実装側で定義する設計。
  - EffectsSheetMixin:
  ActiveEffectのCRUD。静的オブジェクトとして定義し、インスタンスメソッドへの代入または直接呼び出しで使用。

  ---
  7. 未実装・残作業として読み取れる事項

  コード内コメントから明示されているもの

  1. handMaxSizeMod (tnx.mjs:893): 'system.handMaxSizeMod'
  というキーへのコメントに「このキーはアクターのデータモデルに合わせてください」とある。このフィールドは template.json
  に定義されていない。

  登録なし・未実装のシート

  2. Outfit系Itemシート: weapon, armor, ianus, cyborg, tron, tap, vehicle, residence, housingArea, combiner, general,
  lifePath の11種別にカスタムシートが存在しない。コアのItemSheetで開かれる状態。
  3. Guest/Troop/Extra Actorシート: 3種別にカスタムシートが存在しない。

  データ不整合

  4. initiative式のパスミス: system.json の "initiative": "@system.CS.value" に対して、template.json のフィールドは
  system.combatSpeed.value。CS というショートハンドに対応するフィールドが存在しない。
  5. tap の conbatSpeedMod: template.json:346 に "conbatSpeedMod" とタイポ（combat →
  conbat）。コード中に参照箇所は確認されない。

  ソケット

  6. "socket": true の未実装: system.jsonでソケットを宣言しているが、game.socket
  の実際の使用コードが存在しない。game.tnx.refreshSheets()
  は全クライアントへの再描画要求として機能させたい意図が見えるが（コメント「All
  Clients」）、実際には自クライアントのみで動作する。

  テンプレートとリスナーの不一致

  7. usage-list.hbsのedit操作: テンプレートに data-action="edit"
  のボタン（.action-edit）があるが、TokyoNovaItemSheet.activateListeners() に対応するハンドラが存在しない。
  8. active-effects-list.hbs のaction名: テンプレートでは data-action="createEffect" / "toggleEffect" / "editEffect" /
  "deleteEffect" を使用しているが、EffectsSheetMixin.activateEffectListListeners() の switch 文は "create" / "edit" /
  "delete" / "toggle"
  で分岐している。ItemSheetでこのパーシャルを使用した場合、エフェクトの操作ボタンは動作しない。（CastSheetは
  [data-action] の汎用ディスパッチを使い _onCreateEffect 等のインスタンスメソッドを呼ぶため影響を受けない。）

  ---
  8. 設計上、見直したほうがよい点（事実の整理として）

  1. EXP計算の連鎖更新: updateCastExp() が ready フックで登録された updateItem / updateActor 毎に呼ばれ、内部で
  actor.update() を行う。{calcExp: false} で再帰は止まるが、複数アイテムの一括更新があると、アイテム数分の
  updateCastExp() が並列に走り同数のDB書き込みが発生する。FoundryVTTのhookは同期的でないため競合が起きうる。
  2. template.json依存: FVTTv12ではDataModelクラスによるスキーマ定義が推奨されており、template.jsonは非推奨になりつつあ
  る。現状では型安全性・バリデーション・prepareDerivedData()との統合が得られない。
  3. 履歴データのオブジェクトマップ: system.history
  がランダムIDをキーとするオブジェクトとして保存されている。FVTTのEmbeddedDocumentではなくplain
  objectのため、FoundryVTTの標準的な追加/削除APIが使えず、-=id パターンによる削除を手動実装している。
  4. EffectsSheetMixin の2系統: CastSheetはインスタンスプロパティへの代入でMixinを適用し、ItemSheetは
  activateEffectListListeners() の静的呼び出しで使う。前述のaction名不一致と合わせ、Mixinの使われ方が統一されていない。
  5. TokyoNovaStyleSkillSheet._onSelectChange() のパスミス:
  fieldName.match(/^system\.styleSkill\.comboSkill\.(\d+)\.value$/) でマッチを試みているが、実際のフォーム name 属性は
  system.comboSkill.N.value 形式（system.styleSkill. のプレフィックスは存在しない）。このため配列項目の select
  変更時に連動リセット処理が動作しない。