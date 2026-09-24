/** 判定1回持続の対象を開始時に固定し、確定時に条件を照合する。 */
import { SYSTEM_ID } from "../constants.mjs";
import { checkChangeMatches, parseEffectTargetKey, evalEffectConditions } from "../data/item/helpers.mjs";

const flagsOf = effect => effect.flags?.[SYSTEM_ID] ?? {};
const sourceOf = effect => effect.toObject ? effect.toObject() : structuredClone(effect);
const fingerprint = effect => JSON.stringify(sourceOf(effect));

/** 自動適用のパッシブ・供給元・転送コピーは消費対象にしない。 */
export function isNextCheckInstance(effect, item = null) {
    const flags = flagsOf(effect);
    return flags.tnxDuration === "nextCheck" && effect.transfer !== true
        && !flags.transferredFrom && !effect.disabled && effect.active !== false
        && (!item || flags.grantedFrom !== undefined || !!flags.grantInstanceId);
}

export function captureNextCheckEffects(actor) {
    const entries = [];
    const collect = (owner, item = null) => {
        for (const effect of owner?.effects ?? []) {
            if (!isNextCheckInstance(effect, item)) continue;
            entries.push({ itemId: item?.id ?? null, effectId: effect.id,
                fingerprint: fingerprint(effect) });
        }
    };
    collect(actor);
    for (const item of actor?.items ?? []) collect(item, item);
    return entries;
}

export function checkCriteria(actor, ctx, ability) {
    // 用途タイプ・タイミング・特殊判定情報を criteria へ付加(2026-09-24 usageCheck/timingCheck/specialCheck 対応)。
    const usageExtra = {
        usageType:       ctx.usageType ?? null,
        usageKind:       ctx.usageKind ?? null,
        attackWeaponKind: ctx.attackWeaponKind ?? null,
        usageTiming:     ctx.usageTiming ?? null,
        // 特殊判定種別: "appearance"(登場判定) / "information"(情報収集判定) / null(通常判定)
        checkSubKind:    ctx.appearance ? "appearance" : ctx.infoGathering ? "information" : null,
        // 登場エリアキー: ctx.appearance が存在するとき ctx.appearance.area から供給
        // (appearance-check.mjs は scene.area を openExtra.appearance.area として渡す)
        appearanceArea:  ctx.appearance?.area ?? null,
    };
    if (ctx.type === "controlCheck") return { type: "control", ability, ...usageExtra };
    if (ctx.type === "abilityCheck" || !ctx.skillIds?.length) return { type: "ability", ability, ...usageExtra };
    return { type: "skill", ...usageExtra, skills: ctx.skillIds.map(id => actor.items.get(id)).filter(item => item?.system?.identificationKey)
        .map(({ system }) => ({ key: system.identificationKey, style: system.style ?? "",
            organization: system.special?.works?.organization ?? "",
            societyClass: system.societyClass || ctx.societyClassByKey?.[system.identificationKey] || "" })) };
}

export function resolveNextCheckEntry(actor, entry) {
    const owner = entry.itemId ? actor?.items?.get(entry.itemId) : actor;
    const effect = owner?.effects?.get(entry.effectId);
    if (!effect || !isNextCheckInstance(effect, entry.itemId ? owner : null)
        || fingerprint(effect) !== entry.fingerprint) return null;
    return { owner, effect };
}

/** 途中で新規付与・再付与・変更された効果は、この判定では消費しない。 */
export function matchNextCheckEffects(actor, entries, criteria) {
    return (entries ?? []).filter(entry => {
        const current = resolveNextCheckEntry(actor, entry);
        if (!current) return false;
        const changes = current.effect.system?.changes ?? current.effect.changes ?? [];
        const parsed = changes.map(change => ({ change, parsed: parseEffectTargetKey(change.key) }));
        const checkRows = parsed.filter(row => ["anyCheck", "abilityCheck", "controlCheck", "skillCheck", "usageCheck", "timingCheck", "specialCheck", "cardValue", "suitChange"].includes(row.parsed?.scope));
        const rows = checkRows.length ? checkRows : parsed;
        if (!rows.length) return true;
        return rows.some(({ change, parsed: target }) => target
            && evalEffectConditions(current.owner.system, target.conditions)
            && (!checkRows.length || (["cardValue", "suitChange"].includes(target.scope)
                ? criteria.type !== "control" : checkChangeMatches(change.key, criteria))));
    });
}
