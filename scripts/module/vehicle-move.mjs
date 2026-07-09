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

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { getComboSuits } from "./tnx-check-engine.mjs";
import { movementStagesFromAchievement } from "./vehicle-move-logic.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * ヴィークルの対応操縦キー(operateSkillKey)から、アクターの操縦技能を解決する。
 * @param {Actor} actor
 * @param {Item} vehicle
 * @returns {Item|null}
 */
export function resolveOperateSkill(actor, vehicle) {
  const key = vehicle?.system?.operateSkillKey || "";
  if (!key) return null;
  return actor?.items?.find(
    i => i.type === "generalSkill" && i.system.identificationKey === key
  ) ?? null;
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
  const validSuits = getComboSuits([skill.system].filter(Boolean));
  if (!validSuits.length) {
    ui.notifications.warn(`「${skill.name}」で使用できるスートがありません。`);
    return;
  }
  const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);

  await TnxCheckFlow.open({
    type:            "skillCheck",
    actorId:         actor.id,
    skillIds:        [skill.id],
    skillLabel:      skill.name,
    validSuits,
    targetValue:     null,
    bountyAvailable: skill.system.usesBounty === true ? actorBounty : 0,
    consumeUses:     [],
    requestMessageId: null,
    movement: { actorId: actor.id, vehicleName: vehicle.name, skillName: skill.name },
  });
}

/**
 * 移動結果カードを投稿する(判定完了時・TnxCheckFlow._execute から。通常の結果カードの代わり)。
 * 達成値÷10(切り捨て)を移動段階として表示する。段階移動の適用は移動・位置の機構へ後付け。
 */
export async function postMovementCard({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch }) {
  const actor = payload.actorId ? game.actors.get(payload.actorId) : null;
  const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
  const isFumble = result.fumble === true;
  const failed = isFumble || suitMismatch;
  const achievement = failed ? 0 : (result.achievement ?? 0);
  const stages = failed ? 0 : movementStagesFromAchievement(achievement);

  const content = await foundry.applications.handlebars.renderTemplate(
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
    }
  );

  await ChatMessage.create({
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    flags: { [SCOPE]: { checkResult: { actorId: actor?.id ?? "", result } } },
  });
}
