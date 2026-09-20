/**
 * AE移行の事前計画。Documentを更新せず、キー変換・配置変更・未解決事項を列挙する。
 * 型と付与経路の移行が完了するまで、起動時の自動移行には登録しない。
 */
import { SYSTEM_ID } from "../constants.mjs";
import { OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";
import { toPublicEffectKey } from "../rules/ae-public-keys.mjs";
import { planFormulaKeyMigration } from "./formula-key-migration.mjs";
import { parseEffectTargetKey } from "../data/item/helpers.mjs";

const SKILLS = new Set(["generalSkill", "styleSkill"]);

/** 文脈が必要な旧アイテム指定を解決する。同名や先頭一致による推測はしない。 */
function resolveIdentifier(key, items) {
    return [...items].filter(item => item.system?.identificationKey === key);
}

/** 旧AE単体の移行計画。issuesがあれば、そのAEを部分更新しない。 */
export function planEffectKeyMigration(source, { items = [], bearer = null } = {}) {
    const original = structuredClone(source);
    const next = structuredClone(source);
    const flags = next.flags?.[SYSTEM_ID] ?? {};
    const path = Array.isArray(next.system?.changes) ? "system" : "legacy";
    const changes = path === "system" ? next.system.changes : next.changes ?? [];
    const issues = [];
    const destinations = new Set();
    let remoteCount = 0;
    let selfCount = 0;
    for (const change of changes) {
        const condition = change.key?.match(/\[[^\]]*\]/)?.[0] ?? "";
        const bareKey = condition ? change.key.replace(condition, "") : change.key;
        const remote = bareKey?.match(/^item\.([^.]+)\.system\.(.+)$/);
        if (!remote) {
            if (change.key?.startsWith("item.")) issues.push({ key: change.key, reason: "未対応の旧アイテム指定" });
            else change.key = toPublicEffectKey(change.key);
            const parsed = parseEffectTargetKey(change.key);
            if (parsed?.scope === "self" && SKILLS.has(bearer?.type)) {
                if (!bearer.system?.identificationKey) issues.push({ key: change.key, reason: "保持元技能の識別キーが未設定" });
                else change.key = `system.skill.${bearer.system.identificationKey}.${parsed.path}${condition}`;
            } else if (["self", "partAdd", "itemName"].includes(parsed?.scope) && OUTFIT_TYPES.has(bearer?.type)) selfCount++;
            continue;
        }
        const matches = resolveIdentifier(remote[1], items);
        if (matches.length !== 1) {
            issues.push({ key: change.key, reason: matches.length ? "識別キーが重複" : "識別キーの参照先が不明" });
            continue;
        }
        const target = matches[0];
        if (SKILLS.has(target.type)) {
            const attr = remote[2] === "levelTotal" ? "level" : remote[2];
            change.key = `system.skill.${remote[1]}.${attr}${condition}`;
        } else if (OUTFIT_TYPES.has(target.type)) {
            remoteCount++;
            const destination = target.uuid ?? target.id ?? target._id;
            if (!destination) issues.push({ key: change.key, reason: "付与先の文書IDが不明" });
            else destinations.add(destination);
            change.key = toPublicEffectKey(`system.${remote[2]}${condition}`);
        } else issues.push({ key: change.key, reason: "付与対象外のアイテム型" });
    }
    if (destinations.size > 1 || (remoteCount && remoteCount !== changes.length)) {
        issues.push({ reason: "単一の付与先へ移せない効果。自動分割しない" });
    }
    if (selfCount && selfCount !== changes.length) issues.push({ reason: "通常AEと付与AEの変更が混在。自動分割しない" });
    for (const change of changes) {
        const formula = planFormulaKeyMigration(change.value, { items, bearer, relocating: remoteCount > 0 });
        change.value = formula.value;
        issues.push(...formula.issues);
    }
    if (flags.applyToParent === true || remoteCount || selfCount) {
        const wasEnchantment = next.type === "enchantment";
        next.type = "enchantment";
        next.flags ??= {};
        next.flags[SYSTEM_ID] = {
            ...flags,
            effectId: flags.effectId || source._id,
            applyToParent: flags.applyToParent === true && !remoteCount,
            applyToSelf: !!remoteCount || (flags.applyToParent !== true && (wasEnchantment
                ? (flags.applyToSelf ?? next.transfer !== false) : selfCount > 0)),
        };
        // ステータスを含む異常データを黙って破棄しない。
        if (next.statuses?.some(status => status !== "tnx-applied") || Object.keys(flags.conditions ?? {}).length) {
            issues.push({ reason: "付与AE候補にステータス情報が存在" });
        }
        if (next.statuses?.includes("tnx-applied")) next.statuses = next.statuses.filter(status => status !== "tnx-applied");
    }
    return {
        original,
        data: issues.length ? original : next,
        destination: issues.length ? null : [...destinations][0] ?? null,
        issues,
        changed: !issues.length && JSON.stringify(original) !== JSON.stringify(next),
    };
}
