import { SYSTEM_ID } from "../constants.mjs";
import { reconcileTemporarySuits } from "../rules/skill-level-edit.mjs";
import { setForcedDeletion } from "./forced-deletion.mjs";

const SKILL_TYPES = new Set(["generalSkill", "styleSkill"]);
const FLAG_KEY = "temporaryLevelSuits";
let pending = new Set();
let scheduled = false;

/** AEの親から対象アクターを得る。 */
export function actorForEffect(effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Actor") return parent;
  return parent?.actor ?? (parent?.parent?.documentName === "Actor" ? parent.parent : null);
}

/** アクター内の一時スートを現在の実効レベルへ収める。 */
export async function reconcileActorTemporarySkillSuits(actor) {
  if (!actor?.items) return;
  // ActiveEffect の変更後フック時点で派生値は通常再計算済み。明示的に再準備できる場合は最新化する。
  actor.prepareData?.();
  for (const item of actor.items) {
    if (!SKILL_TYPES.has(item.type)) continue;
    const state = item.getFlag?.(SYSTEM_ID, FLAG_KEY) ?? item.flags?.[SYSTEM_ID]?.[FLAG_KEY];
    if (!state?.addedSuits?.length) continue;
    const result = reconcileTemporarySuits({
      state,
      suits: item.system?.suits,
      baseLevel: item.system?.level,
      effectiveLevel: item.system?.levelTotal,
    });
    if (!result.remove.length && result.nextState) continue;

    const update = {};
    for (const suit of result.remove) update[`system.suits.${suit}`] = false;
    if (result.nextState) update[`flags.${SYSTEM_ID}.${FLAG_KEY}`] = result.nextState;
    else setForcedDeletion(update, `flags.${SYSTEM_ID}.${FLAG_KEY}`);
    await item.update(update, { tnxTemporarySuitReconcile: true });
  }
}

/** 同一更新連鎖での多重実行をまとめ、active GMだけが永続データを更新する。 */
export function queueTemporarySkillSuitReconcile(actor) {
  if (!actor) return;
  const activeGM = game.users?.activeGM;
  if (activeGM && game.user?.id !== activeGM.id) return;
  if (!activeGM && !actor.isOwner) return;
  pending.add(actor);
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    const actors = [...pending];
    pending = new Set();
    scheduled = false;
    for (const target of actors) await reconcileActorTemporarySkillSuits(target);
  }, 0);
}
