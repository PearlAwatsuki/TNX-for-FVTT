/**
 * @fileoverview ヴィークル操縦移動の結果カード(フェーズ12・正本 Outfits.md / Combat_Flow.md)。
 *
 * 操縦中はメジャーアクションでも移動できる。対応する〈操縦〉で判定し、達成値÷10(切り捨て)段階の
 * 移動が可能。**段階移動そのものの適用は移動・位置の機構に依存する**(判定は今／適用は担当機構が
 * 入ってから)。
 *
 * 2026-07-17 用途タイプ再編: 起動は〈操縦〉技能の**移動タイプ用途**(使用ヴィークル=単一参照・
 * 準備済みが無ければ判定不可)に一本化され、旧・戦闘タブの合成アクション(startVehicleMove)は
 * 廃止。**対決欄に有効行がある移動は対決判定カード**(attack-flow・移動行の条件表示)に乗り、
 * ここに残るのは**非対決の移動**の結果カードのみ。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { movementStagesFromAchievement } from "../rules/vehicle-move.mjs";
import { buildCheckCardContext } from "./check-card-context.mjs";


/**
 * 移動結果カードを投稿する(判定完了時・TnxCheckFlow._execute から。通常の結果カードの代わり)。
 * 達成値÷10(切り捨て)を移動段階として表示する。段階移動の適用は移動・位置の機構へ後付け。
 */
/** 移動結果カードの本文を構築する(新規投稿と再判定の再描画で共用・2026-07-15)。
 *  判定結果カードの基底(buildCheckCardContext)に移動情報(段階数)を足す形式(2026-07-19 基底化)。 */
export async function buildMovementCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, checkSources = [], isRecheck = false }) {
  const failed = result.fumble === true || suitMismatch;
  const stages = failed ? 0 : movementStagesFromAchievement(result.achievement ?? 0);
  return foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/vehicle-move-card.hbs",
    {
      ...buildCheckCardContext({
        skillLabel: payload.skillName,
        typeLabel:  "移動",
        card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources, isRecheck,
      }),
      // 移動固有の追加情報(ヴィークル名は種別タグでなく小行で示す=長い名前でタグが崩れないように)
      vehicleName: payload.vehicleName ?? "",
      stages,
    }
  );
}

export async function postMovementCard({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, checkSources = [], recheckCtx = null }) {
  const actor = payload.actorId ? game.actors.get(payload.actorId) : null;
  const content = await buildMovementCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, checkSources });
  await ChatMessage.create({
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    // 再判定スナップショット(あれば)=移動カードにも再判定/修正の導線(達成値÷10 段階を表示のみ更新)。
    // 操縦技能の適用効果(あれば)も移動カードに載せる(統一起動で用意されるため・renderUsageEffectButton 発火)
    flags: { [SYSTEM_ID]: {
      checkResult: { actorId: actor?.id ?? "", result },
      ...(recheckCtx ? { checkRecheck: recheckCtx } : {}),
      ...(recheckCtx?.usageEffects ? { usageEffects: recheckCtx.usageEffects } : {}),
    } },
  });
}
