/**
 * @fileoverview ヴィークル操縦移動フロー(フェーズ12・正本 Outfits.md / Combat_Flow.md)。
 *
 * 操縦中はメジャーアクションでも移動できる。対応する〈操縦〉で判定し、達成値÷10(切り捨て)段階の
 * 移動が可能。**段階移動そのものの適用は移動・位置の機構に依存する**ため、本モジュールは「移動の
 * 判定」を起動し結果(段階数)を提示するところまでを担う(判定は今／適用は担当機構が入ってから)。
 *
 * 設計(2026-07-09 ユーザー確定):
 * - **用途にはしない**。用途は戦闘タブでアイテム単位の timing に振り分けられるため、ヴィークル全体を
 *   メジャーに固定することになり筋が悪い。移動は戦闘タブのタイミング節に**合成アクション**として出す。
 * - **対応する操縦**はヴィークルの `operateSkillKey`(辞典 operate_ 技能の識別キー)から、アクターの
 *   操縦技能インスタンスを解決する。同フィールドは搭乗時のドッジ上書き判断にも流用できる。
 */

import { movementStagesFromAchievement } from "./vehicle-move-logic.mjs";
import { findItemByIdentificationKey } from "./identification.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * ヴィークルの対応操縦キー(operateSkillKey)から、アクターの操縦技能を解決する。
 * @param {Actor} actor
 * @param {Item} vehicle
 * @returns {Item|null}
 */
export function resolveOperateSkill(actor, vehicle) {
  return findItemByIdentificationKey(actor, vehicle?.system?.operateSkillKey || "", { type: "generalSkill" });
}

/**
 * ヴィークル操縦移動(メジャーアクション)を起動する。対応する操縦で判定→達成値÷10 段階。
 * @param {Actor} actor 操縦者
 * @param {Item} vehicle 準備済みヴィークル
 */
export async function startVehicleMove(actor, vehicle) {
  if (!actor || !vehicle) return;
  if (!vehicle.system.operateSkillKey) {
    ui.notifications.warn(`「${vehicle.name}」に対応する操縦が設定されていません（ヴィークルのシートで設定してください）。`);
    return;
  }
  const skill = resolveOperateSkill(actor, vehicle);
  if (!skill) {
    ui.notifications.warn(`「${vehicle.name}」に対応する操縦技能を所持していません。`);
    return;
  }
  // 起動は唯一の起動関数へ集約(2026-07-15 ユーザー確定)。操縦技能の用途・コンボ・消費・判定ボーナス・
  // 適用効果もシートの技能クリックと全く同じ処理で解決し、ここでは移動文脈だけを注入する
  // (組み合わせの可否はユーザー/RL が決めるものでシステムは制限しない)。
  const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
  await TnxCharacterSheetBase._activateItemCheck(actor, skill, {
    movement: { actorId: actor.id, vehicleName: vehicle.name, skillName: skill.name },
  });
}

/**
 * 移動結果カードを投稿する(判定完了時・TnxCheckFlow._execute から。通常の結果カードの代わり)。
 * 達成値÷10(切り捨て)を移動段階として表示する。段階移動の適用は移動・位置の機構へ後付け。
 */
/** 移動結果カードの本文を構築する(新規投稿と再判定の再描画で共用・2026-07-15)。 */
export async function buildMovementCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, isRecheck = false }) {
  const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
  const isFumble = result.fumble === true;
  const failed = isFumble || suitMismatch;
  const achievement = failed ? 0 : (result.achievement ?? 0);
  const stages = failed ? 0 : movementStagesFromAchievement(achievement);
  return foundry.applications.handlebars.renderTemplate(
    "systems/tokyo-nova-axleration/templates/chat/vehicle-move-card.hbs",
    {
      vehicleName: payload.vehicleName,
      skillName:   payload.skillName,
      suit,
      suitSymbol:  SUIT_SYMBOL[suit] ?? "",
      cardName:    card?.name ?? "",
      fromDeck, trumpUsed,
      isFumble, suitMismatch,
      achievement, stages,
      isRecheck,
    }
  );
}

export async function postMovementCard({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, recheckCtx = null }) {
  const actor = payload.actorId ? game.actors.get(payload.actorId) : null;
  const content = await buildMovementCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch });
  await ChatMessage.create({
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    // 再判定スナップショット(あれば)=移動カードにも再判定/修正の導線(達成値÷10 段階を表示のみ更新)。
    // 操縦技能の適用効果(あれば)も移動カードに載せる(統一起動で用意されるため・renderUsageEffectButton 発火)
    flags: { [SCOPE]: {
      checkResult: { actorId: actor?.id ?? "", result },
      ...(recheckCtx ? { checkRecheck: recheckCtx } : {}),
      ...(recheckCtx?.usageEffects ? { usageEffects: recheckCtx.usageEffects } : {}),
    } },
  });
}
