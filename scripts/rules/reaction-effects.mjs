/** Restore the ordinary defense before re-evaluating reaction effects. */
export function restoreReactionDefense(target) {
    const out = { ...target };
    if (out.reactionEffectBase) Object.assign(out, out.reactionEffectBase);
    // Compatibility with the abandoned manual result override prototype.
    if (out.manualAvoid && out.beforeManualAvoid) Object.assign(out, out.beforeManualAvoid);
    delete out.reactionEffectBase;
    delete out.manualAvoid;
    delete out.beforeManualAvoid;
    return out;
}

/** Effects belong to a particular reaction, and only its own victory activates them. */
export function reactionEffectPatch(current, patch = {}) {
    const next = { ...current, ...patch };
    const baseState = patch.state ?? (current.reactionEffectFailed ? current.reactionEffectBaseState
        : current.manualFailure ? current.beforeManualFailure : current.state);
    const targets = (next.targets ?? []).map(restoreReactionDefense);
    let failed = false;
    const protectedUuids = new Set();
    for (const target of targets) {
        for (const reaction of target.reactions ?? []) {
            if (["fumble", "miss"].includes(baseState) || !reaction.established || !(reaction.achievement >= next.achievement)) continue;
            if (reaction.failsAttack) failed = true;
            for (const uuid of reaction.protectedTargetUuids ?? []) protectedUuids.add(uuid);
        }
    }
    for (const target of targets) {
        if (!protectedUuids.has(target.uuid)) continue;
        target.reactionEffectBase = Object.fromEntries(
            ["state", "resolution", "reactionAchievement", "diff", "parryGuard"].map(k => [k, target[k] ?? null]));
        Object.assign(target, { state: "miss", resolution: "areaCover", reactionAchievement: null, diff: null, parryGuard: 0 });
    }
    return { ...patch, targets, state: failed && !["fumble", "miss"].includes(baseState) ? "failed" : baseState,
        reactionEffectFailed: failed, reactionEffectBaseState: baseState,
        manualFailure: false };
}
