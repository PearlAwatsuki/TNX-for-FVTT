/**
 * @fileoverview CONFIG の基本設定・文書クラス・DataModel・状態の登録。
 *
 * tnx.mjs の init フックから切り出したもの(2026-09-07)。**呼ぶ順序に意味がある**ため、
 * tnx.mjs 側は元の並びのまま順に呼ぶ。ここで並びを変えないこと。
 */

import { preloadHandlebarsTemplates } from "./preload-templates.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { CastDataModel } from "../data/actor/cast.mjs";
import { GuestDataModel } from "../data/actor/guest.mjs";
import { TroopDataModel } from "../data/actor/troop.mjs";
import { ExtraDataModel } from "../data/actor/extra.mjs";
import { HousingAreaDataModel } from "../data/item/housing-area.mjs";
import { OrganizationDataModel } from "../data/item/organization.mjs";
import { LifePathDataModel } from "../data/item/life-path.mjs";
import { ArmorDataModel } from "../data/item/armor.mjs";
import { CyborgDataModel } from "../data/item/cyborg.mjs";
import { CombinerDataModel } from "../data/item/combiner.mjs";
import { GeneralDataModel } from "../data/item/general.mjs";
import { IanusDataModel } from "../data/item/ianus.mjs";
import { TronDataModel } from "../data/item/tron.mjs";
import { VehicleDataModel } from "../data/item/vehicle.mjs";
import { WeaponDataModel } from "../data/item/weapon.mjs";
import { TapDataModel } from "../data/item/tap.mjs";
import { ResidenceDataModel } from "../data/item/residence.mjs";
import { MiracleDataModel } from "../data/item/miracle.mjs";
import { GeneralSkillDataModel } from "../data/item/general-skill.mjs";
import { StyleDataModel } from "../data/item/style.mjs";
import { StyleSkillDataModel } from "../data/item/style-skill.mjs";
import { PlayingCardsDataModel } from "../data/card/playing-cards.mjs";
import { NeuroCardsDataModel } from "../data/card/neuro-cards.mjs";
import { OtherDataModel } from "../data/card/other.mjs";
import { TokyoNovaItem } from "../item/item.mjs";
import { TokyoNovaActiveEffect } from "./active-effect.mjs";
import { TnxCombat } from "../combat/tnx-combat.mjs";
import { TnxCombatant } from "../combat/tnx-combatant.mjs";
import { TnxCombatTracker } from "../combat/tnx-combat-tracker.mjs";
import { formatWeaponRangeLabel } from "../ui/outfit-view.mjs";
import { durationLabelOf } from "../rules/time-boundary.mjs";
import { registerEffectScratchHiding } from "./effect-authoring.mjs";
import { CONDITION_KINDS, conditionDisplayName } from "../rules/conditions.mjs";
import { decoratedItemName } from "./identification.mjs";

export async function registerSystemConfig() {
    // 効果の下書き置き場はアイテムディレクトリに出さない(組み立て中だけ存在する器)。
    // サイドバーの初回描画は ready より前なので、隠すフックの登録は init で行う
    registerEffectScratchHiding();

    // チャット通知のデフォルトを「チャットカード」から「通知バッジ」に変更する。
    // ユーザーが明示的に設定済みの場合はその値が優先される(デフォルト値のみの変更)。
    const chatNotifSetting = game.settings.settings.get("core.chatNotifications");
    if (chatNotifSetting) chatNotifSetting.default = "pip";
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });

    // 符号付き表記(判定修正の内訳等)。負値は "-n"、0以上は "+n"。ハードコードの "+" 前置だと
    // マイナス修正が "+-n" になるため(眼部損傷 -5 等)、必ず本ヘルパーで符号を付ける。
    Handlebars.registerHelper('signed', function(n) {
        const v = Number(n) || 0;
        return v >= 0 ? `+${v}` : `${v}`;
    });

    // アイテム名の表示マーカー(2026-06-12 ユーザー確定ルール)。実体は decoratedItemName
    // (identification.mjs・フェーズ16-2 で関数化=辞典ブラウザ/ツールチップのカードと共用)
    Handlebars.registerHelper('tnxDecoratedName', decoratedItemName);

    // 武器射程の表記(min/max が同じなら単一表記、異なるなら「近～超遠」形式)
    Handlebars.registerHelper('tnxRangeLabel', formatWeaponRangeLabel);
    // 効果一覧の「効果時間」列(15-1)。Foundry 標準の duration.label は本システムでは常に空
    // (実時間を使わないため)なので、効果に載せた TNX の持続を表示する
    Handlebars.registerHelper('tnxDurationLabel', durationLabelOf);

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;
    // 名前装飾(フェーズ12)のためネイティブ AE 適用の一点(Actor への `name`)だけ抑止する
    CONFIG.ActiveEffect.documentClass = TokyoNovaActiveEffect;

    // ActiveEffect の転送モードを新方式にする(フェーズ9-3)。
    // レガシー(true)では「アイテムに乗せた効果がアイテム自身に適用されない」(モードA 不成立)、
    // かつ v13 のトークンアクターで transfer:true が転送されないバグがある。
    // false にすると、transfer:false の効果はアイテム自身へ、transfer:true の効果は
    // アイテム上から親アクターへ仮想適用される(着地点 effectMod に正しく流れ込む)。
    CONFIG.ActiveEffect.legacyTransferral = false;

    // カット進行(戦闘システム・フェーズ13)の Combat/Combatant 派生クラスを登録。
    // 13-2 は「器」＝クラス新設・登録・カット開始シードのロジック集約まで。
    // プロセス状態機械・CS/AR 自動記帳・トラッカー UI は 13-3 以降。
    CONFIG.Combat.documentClass = TnxCombat;
    CONFIG.Combatant.documentClass = TnxCombatant;
    // カット進行のサイドバートラッカー(13-4)。既定のコンバットトラッカーを上書きする。
    CONFIG.ui.combat = TnxCombatTracker;

    // Actor DataModel の登録(全 Actor type)
    CONFIG.Actor.dataModels = {
      cast:   CastDataModel,
      guest:  GuestDataModel,
      troop:  TroopDataModel,
      extra:  ExtraDataModel,
    };

    // Item DataModel の登録(B-7b: styleSkill 追加、全 17 type 登録完了)
    CONFIG.Item.dataModels = {
      housingArea:  HousingAreaDataModel,
      organization: OrganizationDataModel,
      lifePath:     LifePathDataModel,
      armor:        ArmorDataModel,
      cyborg:       CyborgDataModel,
      combiner:     CombinerDataModel,
      general:      GeneralDataModel,
      ianus:        IanusDataModel,
      tron:         TronDataModel,
      vehicle:      VehicleDataModel,
      weapon:       WeaponDataModel,
      tap:          TapDataModel,
      residence:    ResidenceDataModel,
      miracle:      MiracleDataModel,
      generalSkill: GeneralSkillDataModel,
      style:        StyleDataModel,
      styleSkill:   StyleSkillDataModel,
    };

    // Card DataModel の登録(B-8: 全 3 type 登録完了)
    CONFIG.Card.dataModels = {
      playingCards: PlayingCardsDataModel,
      neuroCards:   NeuroCardsDataModel,
      other:        OtherDataModel,
    };

    // システム用のCONFIG名前空間を準備
    CONFIG.TNX = {};

    // フェイズのキーと、対応する翻訳キー（または直接の日本語名）を定義
    CONFIG.TNX.phaseLabels = {
        opening: "オープニング",
        research: "リサーチ",
        climax: "クライマックス",
        ending: "エンディング"
    };

    // トーキョーN◎VA の状態(BS・戦闘不能・負傷)を CONDITION_KINDS から生成する(フェーズ9-4)。
    // id = conditionKind。flags に conditionKind を持たせ、貼付時に condition として認識させる。
    // 順は CONDITION_KINDS の統合順(BS→戦闘不能→肉体→精神→社会)。効果値はインスタンス毎に詳細タブで設定。
    // hideFromList: トークン右クリック「ステータス効果の設定」からの付与でも、ダメージ適用と同様に
    // バッジのみ追加しシートのアクティブエフェクト一覧には行を出さない(2026-07-11 ユーザー確定)
    CONFIG.statusEffects = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
        id,
        name: conditionDisplayName(id),
        img:  def.img ?? "icons/svg/aura.svg",
        flags: { [SYSTEM_ID]: { conditionKind: id, hideFromList: true } },
    }));

    // トークンリソースバーの割当候補(フェーズ11-4)。トループの heads=人数/エニグマポイントが
    // HP のように機能する(Troops.md)。他 type はチャート式ダメージのためバー非対応。
    CONFIG.Actor.trackableAttributes = {
        troop: { bar: ["heads"], value: [] },
    };
}
