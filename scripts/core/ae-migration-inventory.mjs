/** 保存場所を横断した読取専用のAE／式移行診断。 */
import { SYSTEM_ID } from "../constants.mjs";
import { planEffectKeyMigration } from "./ae-key-migration.mjs";
import { planItemFormulaMigration, planChatFormulaMigration } from "./formula-key-migration.mjs";

export async function buildAEMigrationInventory(world, { includePacks = false } = {}) {
    const plans = [];
    const seen = new Set();
    const actors = new Map();
    const inspect = (document, items = [], readOnly = false) => {
        if (!document || seen.has(document.uuid ?? document)) return;
        seen.add(document.uuid ?? document);
        const bearer = document.documentName === "Item" ? document : null;
        for (const effect of document.effects ?? []) {
            plans.push({ kind: "effect", uuid: effect.uuid, ownerUuid: document.uuid, readOnly,
                ...planEffectKeyMigration(effect.toObject(), { items, bearer }) });
        }
        if (bearer) plans.push({ kind: "item-formulas", uuid: document.uuid, readOnly,
            ...planItemFormulaMigration(document.toObject(), { items, bearer }) });
    };
    const inspectActor = (actor, readOnly = false) => {
        if (!actor) return;
        actors.set(actor.uuid, actor);
        inspect(actor, actor.items, readOnly);
        for (const item of actor.items ?? []) inspect(item, actor.items, readOnly);
    };
    for (const actor of world.actors ?? []) inspectActor(actor);
    for (const item of world.items ?? []) inspect(item);
    for (const scene of world.scenes ?? []) {
        for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) inspectActor(token.actor);
    }
    const inspectPresets = (journal, readOnly = false) => {
        const presets = journal.flags?.[SYSTEM_ID]?.effectGrants ?? [];
        for (const [index, preset] of presets.entries()) {
            if (!preset.effect) continue;
            plans.push({ kind: "preset", uuid: journal.uuid, path: `flags.${SYSTEM_ID}.effectGrants.${index}.effect`, readOnly,
                ...planEffectKeyMigration(preset.effect) });
        }
    };
    for (const journal of world.journal ?? []) inspectPresets(journal);
    for (const message of world.messages ?? []) {
        const flags = message.flags?.[SYSTEM_ID] ?? {};
        const resolveActor = snapshot => {
            const uuid = snapshot.sourceActorUuid ?? snapshot.attackerUuid;
            if (uuid) return actors.get(uuid);
            // 同じIDを持つ非リンクTokenを、別のActorへ推測で結び付けない。
            const matches = [...actors.values()].filter(actor => snapshot.actorId && (actor.id ?? actor._id) === snapshot.actorId);
            return matches.length === 1 ? matches[0] : undefined;
        };
        const inspectPayload = (payload, path) => {
            if (!payload) return;
            const actor = resolveActor(payload);
            for (const [index, entry] of (payload.effects ?? []).entries()) {
                if (!entry.data) continue;
                const bearer = Array.from(actor?.items ?? []).find(item => item.uuid === entry.enchantment?.sourceItemUuid);
                const plan = planEffectKeyMigration(entry.data, { items: actor?.items ?? [], bearer });
                plans.push({ kind: "chat-payload", uuid: message.uuid, path: `${path}.effects.${index}.data`,
                    readOnly: true, ...plan });
            }
        };
        inspectPayload(flags.usageEffects, `flags.${SYSTEM_ID}.usageEffects`);
        for (const [key, snapshot] of [["checkRecheck", flags.checkRecheck], ["attackCheck", flags.attackCheck],
            ["checkRecheck.attack", flags.checkRecheck?.attack]]) {
            if (!snapshot) continue;
            const path = `flags.${SYSTEM_ID}.${key}`;
            const actor = resolveActor(snapshot);
            const bearer = Array.from(actor?.items ?? []).find(item => (item.id ?? item._id) === snapshot.sourceItemId);
            plans.push({ kind: "chat-formulas", uuid: message.uuid, path, readOnly: true,
                ...planChatFormulaMigration(snapshot, { items: actor?.items ?? [], bearer }) });
            inspectPayload(snapshot.usageEffects, `${path}.usageEffects`);
        }
        // 過去カードは直接書換えず、再利用の互換読込対象として報告する。
    }
    if (includePacks) {
        for (const pack of world.packs ?? []) {
            if (!["Actor", "Item", "JournalEntry"].includes(pack.documentName)) continue;
            // 読取専用パックを勝手にアンロックしない。個別getDocumentで既存シートの文書を差し替えない。
            const readOnly = pack.locked !== false || pack.metadata?.packageType !== "world";
            try {
                const index = await pack.getIndex();
                for (const entry of index) {
                    const document = await pack.getDocument(entry._id);
                    if (pack.documentName === "Actor") inspectActor(document, readOnly);
                    else if (pack.documentName === "Item") inspect(document, [], readOnly);
                    else if (document) inspectPresets(document, readOnly);
                }
            } catch (error) {
                plans.push({ kind: "pack-error", uuid: pack.collection, readOnly, changed: false,
                    issues: [{ reason: `パックを調査できません: ${error.message}` }] });
            }
        }
    }
    return {
        version: 1,
        includesPacks: includePacks,
        plans,
        summary: { inspected: plans.length, changed: plans.filter(p => p.changed).length,
            unresolved: plans.filter(p => p.issues.length).length, readOnly: plans.filter(p => p.readOnly).length },
    };
}
