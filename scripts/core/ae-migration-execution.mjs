/** AE移行の適用と復元。更新前後を先に永続化し、各操作を再開可能にする。 */
import { SYSTEM_ID } from "../constants.mjs";
import { buildAEMigrationInventory } from "./ae-migration-inventory.mjs";
import { runSerial } from "./serial-queue.mjs";
import { migrateImportedItem } from "./ae-import-migration.mjs";

export const AE_MIGRATION_BACKUP_ID = "tnxAEMigrate0007";
const OPTIONS = { tnxAEMigration: true, keepId: true, render: false };
const clone = value => structuredClone(value);
const get = (data, path) => path.split(".").reduce((value, key) => value?.[key], data);
const set = (data, path, value) => {
    const keys = path.split(".");
    let target = data;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = clone(value);
};
const stable = value => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().filter(k => k !== "_stats").map(k => [k, v[k]])) : v);
const equal = (a, b) => stable(a) === stable(b);

/** 移行中に対象を通常編集して、保存済みの計画と競合させない。 */
export function registerAEMigrationHooks() {
    Hooks.on("preCreateItem", migrateImportedItem);
    const guard = (document, options) => {
        if (options?.tnxAEMigration) return;
        const state = game.journal?.get(AE_MIGRATION_BACKUP_ID)?.flags?.[SYSTEM_ID]?.aeMigration;
        if (!["prepared", "applying", "restoring"].includes(state?.status)) return;
        const ids = [document.uuid, document.parent?.uuid].filter(Boolean);
        if (!state.operations.some(op => ids.some(uuid => op.uuid === uuid || op.ownerUuid === uuid || op.uuid.startsWith(`${uuid}.`)))) return;
        ui.notifications.warn("この文書はAE移行／復元中です。処理完了後に編集してください。");
        return false;
    };
    for (const type of ["ActiveEffect", "Item", "Actor", "JournalEntry"]) {
        Hooks.on(`preUpdate${type}`, (document, _data, options) => guard(document, options));
        Hooks.on(`preDelete${type}`, (document, options) => guard(document, options));
        Hooks.on(`preCreate${type}`, (document, _data, options) => guard(document, options));
    }
}

/** 全更新を先に組み立てる。未解決・参照不整合があれば適用を開始しない。 */
export async function prepareAEMigration(world, { resolve = globalThis.fromUuid, includePacks = true } = {}) {
    const report = await buildAEMigrationInventory(world, { includePacks });
    const issues = report.plans.filter(p => !p.readOnly && p.issues.length)
        .flatMap(p => p.issues.map(issue => ({ uuid: p.uuid, ...issue })));
    const updates = new Map();
    const moves = new Map();
    const creations = [];
    const deletions = [];
    const update = async uuid => {
        if (updates.has(uuid)) return updates.get(uuid);
        const document = await resolve(uuid);
        if (!document) throw new Error(`移行対象が見つかりません: ${uuid}`);
        const before = document.toObject();
        const op = { kind: "update", uuid, before, after: clone(before) };
        updates.set(uuid, op);
        return op;
    };
    for (const plan of report.plans) {
        if (plan.readOnly || plan.issues.length || !plan.changed) continue;
        const live = await resolve(plan.uuid);
        const current = live?.toObject();
        if (!current || !equal(plan.kind === "preset" ? get(current, plan.path) : current, plan.original)) {
            issues.push({ uuid: plan.uuid, reason: "診断後に文書が変更されたため再診断が必要" });
            continue;
        }
        if (plan.kind === "effect") {
            if (plan.destination && plan.destination !== plan.ownerUuid) {
                const destination = await resolve(plan.destination);
                if (!destination || destination.effects?.get(plan.original._id)) {
                    issues.push({ uuid: plan.uuid, reason: "移設先が不明、または同じAE IDが既に存在" });
                    continue;
                }
                const uuid = `${destination.uuid}.ActiveEffect.${plan.original._id}`;
                moves.set(plan.uuid, { uuid, ownerUuid: destination.uuid, itemId: destination.id, effectId: plan.original._id });
                creations.push({ kind: "create", uuid, ownerUuid: destination.uuid, before: null, after: clone(plan.data) });
                deletions.push({ kind: "delete", uuid: plan.uuid, ownerUuid: plan.ownerUuid, before: clone(plan.original), after: null });
            } else (await update(plan.uuid)).after = clone(plan.data);
        } else if (plan.kind === "item-formulas") {
            const op = await update(plan.uuid);
            for (const change of plan.changes) set(op.after, change.path, change.after);
        } else if (plan.kind === "preset") set((await update(plan.uuid)).after, plan.path, plan.data);
    }
    for (const ref of report.references) {
        if (ref.required && ref.resolution === "unresolved" && !ref.readOnly) issues.push({ uuid: ref.ownerUuid, path: ref.path, reason: "必須のAE参照が未解決" });
        const move = moves.get(ref.targetUuid);
        if (!move || ref.kind === "identity") continue;
        if (ref.readOnly) {
            // 保存先を変更できない参照を残して供給元を消さない。
            issues.push({ uuid: ref.ownerUuid, path: ref.path, reason: "移設対象を読取専用データが参照。互換参照の解決が必要" });
            continue;
        }
        const value = ref.kind === "usage-effect" ? { ...ref.value, itemId: move.itemId, effectId: move.effectId } : move.uuid;
        const movedOwner = moves.get(ref.ownerUuid);
        if (movedOwner) set(creations.find(op => op.uuid === movedOwner.uuid).after, ref.path, value);
        else set((await update(ref.ownerUuid)).after, ref.path, value);
    }
    // 用途参照やflagsを保存するとき、文書の他フィールドを巻き戻さない。
    const updateOps = [...updates.values()].filter(op => !moves.has(op.uuid)).map(op => {
        op.fields = Object.keys(op.after).filter(key => !["_id", "_stats", "effects"].includes(key) && !equal(op.before[key], op.after[key]));
        return op;
    }).filter(op => op.fields.length);
    return { version: 7, worldId: world.world?.id, issues, report, operations: [...creations, ...updateOps, ...deletions] };
}

/** Foundry V14の型変更API。型だけのupdateや削除先行の置換は使わない。 */
function replacementPatch(op, data) {
    const Replacement = globalThis.foundry?.data?.operators?.ForcedReplacement;
    if (!Replacement) throw new Error("FoundryのForcedReplacement APIが利用できません。");
    const fields = new Set(op.fields);
    if (fields.has("type")) fields.add("system");
    return Object.fromEntries([...fields].map(key => [key, data[key] === undefined
        ? globalThis.foundry.data.operators.ForcedDeletion.create()
        : typeof data[key] === "object" && data[key] !== null ? Replacement.create(clone(data[key])) : data[key]]));
}

function matches(document, data, fields) {
    if (!document || !data) return !document && !data;
    const current = document.toObject();
    return fields ? fields.every(key => equal(current[key], data[key])) : equal(current, data);
}

/** 各操作はbefore/afterの一致で判定。中断後の再実行で二重作成しない。 */
export async function applyAEMigrationOperation(op, { resolve = globalThis.fromUuid, reverse = false } = {}) {
    const before = reverse ? op.after : op.before;
    const after = reverse ? op.before : op.after;
    const document = await resolve(op.uuid);
    if (matches(document, after, op.fields)) return;
    if (!matches(document, before, op.fields)) throw new Error(`移行計画後にデータが変更されています: ${op.uuid}`);
    if (!before) {
        const owner = await resolve(op.ownerUuid);
        if (!owner) throw new Error(`保持文書が見つかりません: ${op.ownerUuid}`);
        await owner.createEmbeddedDocuments("ActiveEffect", [clone(after)], OPTIONS);
    } else if (!after) await document.delete(OPTIONS);
    else await document.update(replacementPatch(op, after), OPTIONS);
    if (!matches(await resolve(op.uuid), after, op.fields)) throw new Error(`移行後のデータ照合に失敗しました: ${op.uuid}`);
}

function requireAuthority(world) {
    if (!world.user?.isGM || world.users?.activeGM?.id !== world.user.id) throw new Error("AE移行はactiveGMのみ実行できます。");
}

/** バックアップJournalは固定IDで作成し、複数クライアントの同時開始をDBのID制約で拒否する。 */
export async function executeAEMigration(world = game, options = {}) {
    requireAuthority(world);
    return runSerial("tnx-ae-migration-v7", async () => {
        let backup = world.journal.get(AE_MIGRATION_BACKUP_ID);
        let state = backup?.flags?.[SYSTEM_ID]?.aeMigration;
        if (backup && !state) throw new Error("バックアップ用IDが既存Journalと衝突しています。");
        if (state?.status === "complete") return state;
        if (state?.status === "restored" && options.restart === true) {
            const archived = backup.toObject();
            delete archived._id;
            archived.name = "AE移行バックアップ（復元済み・保管）";
            if (!await JournalEntry.create(archived)) throw new Error("旧バックアップを保管できませんでした。");
            await backup.delete();
            backup = null;
            state = null;
        }
        if (["restored", "restoring", "restore-failed"].includes(state?.status)) throw new Error("復元済み／復元中のバックアップです。復元完了後の再適用はapplyAEMigration({restart:true})で行います。");
        if (!state) {
            const plan = await prepareAEMigration(world, options);
            if (plan.issues.length) return { status: "needs-resolution", ...plan };
            if (!plan.operations.length) return { status: "complete", version: 7, noChanges: true };
            state = { version: 7, worldId: world.world?.id, status: "prepared", operations: plan.operations, completed: 0,
                previousDataVersion: world.settings.get(SYSTEM_ID, "dataVersion") };
            backup = await JournalEntry.create({ _id: AE_MIGRATION_BACKUP_ID, name: "AE移行前バックアップ（v7）",
                ownership: { default: 0 }, flags: { [SYSTEM_ID]: { aeMigration: state } } }, { keepId: true });
            if (!backup) throw new Error("移行前バックアップを保存できませんでした。");
        }
        if (state.worldId !== world.world?.id) throw new Error("バックアップのワールドが一致しません。");
        await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "applying" });
        try {
            for (let i = state.completed; i < state.operations.length; i++) {
                requireAuthority(world);
                await applyAEMigrationOperation(state.operations[i], options);
                await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.completed`]: i + 1 });
            }
        } catch (error) {
            await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "failed",
                [`flags.${SYSTEM_ID}.aeMigration.error`]: error.message }).catch(() => {});
            throw error;
        }
        await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "complete" });
        return { ...state, completed: state.operations.length, status: "complete", backupUuid: backup.uuid };
    });
}

/** 変更後のデータが一致するときだけ逆順復元する。以後のユーザー編集は上書きしない。 */
export async function restoreAEMigration(world = game, options = {}) {
    requireAuthority(world);
    return runSerial("tnx-ae-migration-v7", async () => {
        const backup = world.journal.get(AE_MIGRATION_BACKUP_ID);
        const state = backup?.flags?.[SYSTEM_ID]?.aeMigration;
        if (!state || state.worldId !== world.world?.id) throw new Error("このワールドのAEバックアップがありません。");
        if (world.settings.get(SYSTEM_ID, "dataVersion") > 7) throw new Error("後続のデータ移行が適用済みのため、AE移行だけを復元できません。");
        if (state.status === "restored") return state;
        await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "restoring" });
        // 最後の操作が成功して進捗保存だけ失敗した場合もbefore/after照合で復元する。
        try {
            for (const op of [...state.operations].reverse()) {
                requireAuthority(world);
                await applyAEMigrationOperation(op, { ...options, reverse: true });
            }
        } catch (error) {
            await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "restore-failed",
                [`flags.${SYSTEM_ID}.aeMigration.error`]: error.message }).catch(() => {});
            throw error;
        }
        await world.settings.set(SYSTEM_ID, "dataVersion", state.previousDataVersion);
        await backup.update({ [`flags.${SYSTEM_ID}.aeMigration.status`]: "restored" });
        return { ...state, status: "restored", backupUuid: backup.uuid };
    });
}
