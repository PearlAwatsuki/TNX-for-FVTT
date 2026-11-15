import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { reactionEffectPatch } from "../../scripts/rules/reaction-effects.mjs";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";

const reaction = (extra = {}) => ({ established: true, achievement: 15, protectedTargetUuids: ["b"], failsAttack: true, ...extra });
const attack = (reactions = [reaction()]) => ({ achievement: 15, state: "active", targets: [
    { uuid: "a", state: "miss", resolution: "dodge", reactions },
    { uuid: "b", state: "pending", resolution: null, reactions: [] },
] });

describe("reaction effects follow the opposed check", () => {
    it("activates on a tie, and restores the other target when the attack wins", () => {
        const original = attack();
        const won = { ...original, ...reactionEffectPatch(original) };
        expect(won.state).toBe("failed");
        expect(won.targets[1].state).toBe("miss");
        const lost = reactionEffectPatch(won, { achievement: 16 });
        expect(lost.state).toBe("active");
        expect(lost.targets[1].state).toBe("pending");
        expect(lost.targets[1].reactionEffectBase).toBeUndefined();
    });
    it.each([false, true])("does not activate failed or losing reactions (established=%s)", established => {
        const result = reactionEffectPatch(attack([reaction({ established, achievement: 14 })]));
        expect(result.state).toBe("active");
        expect(result.targets[1].state).toBe("pending");
    });
    it("preserves protection provided by another winning reaction", () => {
        const result = reactionEffectPatch(attack([reaction({ achievement: 10 }), reaction({ failsAttack: false })]));
        expect(result.state).toBe("active");
        expect(result.targets[1].state).toBe("miss");
    });
    it("does not persist effects through an attack fumble", () => {
        const original = attack();
        const won = { ...original, ...reactionEffectPatch(original) };
        const result = reactionEffectPatch(won, { state: "fumble" });
        expect(result.state).toBe("fumble");
        expect(result.reactionEffectFailed).toBe(false);
    });
});

let Flow, completeReaction;
beforeAll(async () => {
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.utils.deepClone = structuredClone;
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
    ({ completeReactionFromCheck: completeReaction } = await import("../../scripts/flow/attack-flow.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Flow._context = null; });

it("records pre-roll selections without mutating a saved reroll snapshot", () => {
    const saved = { open: false, attackMessageId: "attack", protectedTargetUuids: [] };
    Flow._context = { reaction: saved };
    Flow.setReactionOptions({ protectedTargetUuids: ["b"], failsAttack: true });
    expect(saved.protectedTargetUuids).toEqual([]);
    expect(Flow._buildRecheckContext(Flow._context).reaction).toMatchObject({ protectedTargetUuids: ["b"], failsAttack: true });
});

it("re-evaluates the same reaction after its achievement is corrected", async () => {
    let flags = attack([]);
    flags.targets[0].state = "pending";
    const message = { id: "attack", getFlag: () => flags };
    vi.stubGlobal("game", { messages: new Map([["attack", message]]) });
    const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockImplementation(async (_m, data) => { flags = { ...flags, ...data }; });
    const payload = { attackMessageId: "attack", reactionMessageId: "r", reactorUuid: "reactor", targetIndex: 0, isSelf: true, mode: "dodge", protectedTargetUuids: ["b"], failsAttack: true };
    await completeReaction(payload, { achievement: 15 });
    expect(flags.state).toBe("failed");
    expect(flags.targets[1].state).toBe("miss");
    await completeReaction(payload, { achievement: 14 }, { allowResolved: true });
    expect(flags.state).toBe("active");
    expect(flags.targets[1].state).toBe("pending");
    expect(flags.targets[0].state).toBe("hit");
    expect(patch).toHaveBeenCalledTimes(2);
    await completeReaction(payload, { achievement: 18 }, { allowResolved: true });
    expect(flags.state).toBe("failed");
    await completeReaction(payload, { achievement: 18, fumble: true }, { allowResolved: true });
    expect(flags.state).toBe("active");
    expect(flags.targets[1].state).toBe("pending");
});

it("re-evaluates effects when the attack achievement is corrected", async () => {
    const original = attack();
    const flags = { ...original, ...reactionEffectPatch(original) };
    const message = { getFlag: (_scope, key) => key === "attackCheck" ? flags : null };
    const patch = { "flags.tokyo-nova-axleration.attackCheck.achievement": 16 };
    await Flow._resolveReactionEffects(message, patch);
    expect(patch["flags.tokyo-nova-axleration.attackCheck.state"]).toBe("active");
    expect(patch["flags.tokyo-nova-axleration.attackCheck.targets"][1].state).toBe("pending");
});
