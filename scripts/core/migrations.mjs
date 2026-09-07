/**
 * @fileoverview ワールドデータの一回限り移行を、版番号ひとつで管理する仕組み(2026-09-07)。
 *
 * 経緯: 一回限りの処理が 4 つあり、**それぞれ別のゲート**を持っていた——真偽の設定が 2 つ、
 * 「スキーム番号 >= n」が 2 つ。実行順は ready フックに並んだ呼び出しの順、つまり行の並びが
 * 暗黙の依存関係になっており、増えるたびに設定を 1 つ足し、ゲートの書き方をその場で選ぶ、
 * という形になっていた。移行は**間違えると卓のデータが壊れて戻せない**種類の処理なので、
 * 追加のたびに作法が揺れるのは危うい。
 *
 * ここでは版番号(dataVersion)を 1 つだけ持ち、表に並べた移行を昇順に適用する。
 *
 * ## 移行を足すとき
 * 1. MIGRATIONS の末尾に `{ version: 次の番号, name, run }` を足す(**途中に挿し込まない**)。
 * 2. run は GM クライアントでだけ呼ばれる。冪等に書く(失敗して再実行されうる)。
 * 3. 版番号は移行が成功した直後に 1 つずつ進む。途中で例外が出たらそこで止まり、版番号は
 *    進まない——次のロードで**失敗した移行から**再開する(飛ばさない)。
 *
 * ## 既存ワールドの取り込み
 * 版番号が未設定(0)のワールドは、旧ゲート(legacy)を見て「どこまで済んでいるか」を推定する。
 * 推定は**先頭から連続して済んでいる分まで**——v1 済み・v2 未・v3 済み なら 1 とみなし、
 * v2 と v3 を実行する(v3 の run は冪等なので二重実行は害にならない)。逆に、済んでいるものを
 * 未実行と誤って判定すると、ユーザーが手で直したデータを移行が上書きしうる。安全側は
 * 「済んでいるものを飛ばす」なので、legacy の判定は取りこぼしのない形で書く。
 */

import { SYSTEM_ID } from "../constants.mjs";

/** 版番号を保存するワールド設定のキー。 */
export const DATA_VERSION_SETTING = "dataVersion";

/**
 * 移行の表。**version は連番・追加は末尾のみ**。
 * legacy は「この移行が統一機構より前に別ゲートで実行済みだったか」を返す述語で、
 * 版番号が無いワールドの取り込みにだけ使う(新しい移行には不要)。
 * @type {ReadonlyArray<{version: number, name: string, legacy?: () => boolean, run: () => Promise<void>}>}
 */
export const MIGRATIONS = Object.freeze([
    {
        version: 1,
        name: "部位スロットプリセットの初期化",
        legacy: () => getSetting("partSlotPresetInitialized") === true,
        run: async () => {
            const { initializeDefaultPartSlotPreset } = await import("../app/part-slot-preset-app.mjs");
            await initializeDefaultPartSlotPreset();
        },
    },
    {
        version: 2,
        name: "部位キーの付与",
        legacy: () => (Number(getSetting("partSlotKeyScheme")) || 0) >= 1,
        run: async () => {
            const { migratePartSlotKeys } = await import("../app/part-slot-preset-app.mjs");
            await migratePartSlotKeys();
        },
    },
    {
        version: 3,
        name: "正準名ブリッジ(既定一般技能の用途を行動種別タイプへ)",
        legacy: () => getSetting("usageTypeCanonicalMigrated") === true,
        run: async () => {
            const { canonicalizeSkillActions } = await import("./usage-type-migration.mjs");
            const migrateSkill = async (item) => {
                if (item.type !== "generalSkill") return;
                const src = item.toObject().system ?? {};
                const next = canonicalizeSkillActions(
                    { name: item.name, identificationKey: src.identificationKey ?? "", actions: src.actions ?? [] },
                    () => foundry.utils.randomID());
                if (next) await item.update({ "system.actions": next });
            };
            for (const it of game.items.contents) await migrateSkill(it);
            for (const actor of game.actors.contents) {
                for (const it of actor.items.contents) await migrateSkill(it);
            }
        },
    },
    {
        version: 4,
        name: "技能・神業の上に残った転送コピーの掃除",
        legacy: () => (Number(getSetting("capabilityTransferCleanupScheme")) || 0) >= 1,
        run: async () => {
            const { cleanupCapabilityTransferCopies } = await import("./item-transfer.mjs");
            await cleanupCapabilityTransferCopies();
        },
    },
]);

/** 未登録の設定を読んでも落ちないようにする(旧ゲートは将来削除されうる)。 */
function getSetting(key) {
    try { return game.settings.get(SYSTEM_ID, key); }
    catch { return undefined; }
}

/**
 * 旧ゲートから「どこまで済んでいるか」を推定する。**先頭から連続して済んでいる分まで**。
 * 表を純粋な入力として受け取るのでテストできる。
 * @param {ReadonlyArray<{version:number, legacy?: () => boolean}>} migrations
 * @returns {number} 済みとみなす版番号(0=何も済んでいない)
 */
export function inferAppliedVersion(migrations) {
    let applied = 0;
    for (const m of migrations) {
        if (!m.legacy?.()) break;
        applied = m.version;
    }
    return applied;
}

/**
 * 版番号より新しい移行を昇順に適用する。GM クライアントでのみ呼ぶこと。
 * 版番号の読み書きと実行を分けてあるので、実行順と停止条件は runMigrationList でテストできる。
 */
export async function applyPendingMigrations() {
    if (!game.user.isGM) return;
    let applied = Number(game.settings.get(SYSTEM_ID, DATA_VERSION_SETTING)) || 0;
    if (applied === 0) {
        applied = inferAppliedVersion(MIGRATIONS);
        if (applied > 0) {
            await game.settings.set(SYSTEM_ID, DATA_VERSION_SETTING, applied);
            console.log(`TNX | 既存ワールドの移行状態を取り込みました(データ版 ${applied})`);
        }
    }
    await runMigrationList(MIGRATIONS, applied,
        (v) => game.settings.set(SYSTEM_ID, DATA_VERSION_SETTING, v));
}

/**
 * 移行の適用本体(Foundry 非依存)。適用のたびに record で版番号を進める。
 * 例外はそこで止める——版番号を進めないので、次のロードで同じ移行から再開する。
 * @param {ReadonlyArray<{version:number, name:string, run: () => Promise<void>}>} migrations
 * @param {number} applied 済みの版番号
 * @param {(version:number) => Promise<void>} record 版番号の保存
 * @returns {Promise<number>} 適用後の版番号
 */
export async function runMigrationList(migrations, applied, record) {
    for (const m of migrations) {
        if (m.version <= applied) continue;
        try {
            await m.run();
        } catch (err) {
            console.error(`TNX | データ移行「${m.name}」(版 ${m.version})に失敗しました。`
                + "次回の読み込みでこの移行から再開します。", err);
            return applied;
        }
        await record(m.version);
        applied = m.version;
        console.log(`TNX | データ移行「${m.name}」を適用しました(データ版 ${m.version})`);
    }
    return applied;
}
