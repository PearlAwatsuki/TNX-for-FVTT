import { runSerial } from "../core/serial-queue.mjs";
import { getEffectiveConditions, hasBountyBlock } from "../rules/conditions.mjs";
import { comboUsesBounty } from "../rules/tnx-check-engine.mjs";

export function checkAllowsBounty(actor, ctx) {
    return ctx.type === "skillCheck" && (!!ctx.infoGathering ||
        comboUsesBounty((ctx.skillIds ?? []).map(id => actor.items.get(id)?.system).filter(Boolean)));
}

export function availableBounty(actor) {
    if (hasBountyBlock(getEffectiveConditions(actor).filter(c => !c.effectIgnored))) return 0;
    return Math.max(0, (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0));
}

/** 入力後に資格・残高を確認し、実際に記帳した点数だけを呼び出し元へ返す。 */
export async function spendBounty(actor, requested, eligible = () => true) {
    if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
    return runSerial(`bounty:${actor.uuid ?? actor.id}`, async () => {
        const amount = eligible() ? Math.min(requested, availableBounty(actor)) : 0;
        if (amount > 0) await actor.update({ "system.bounty": (actor.system.bounty ?? 0) - amount });
        if (amount < requested) ui.notifications.warn(`使用可能な報酬点が変わったため、使用量は${amount}点です。`);
        return amount;
    });
}
