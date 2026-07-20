/**
 * @fileoverview 実行中 FS判定の正本(フェーズ12-5・2026-07-20 確定)。
 *
 * 進行状態(進行値・カット数)の**唯一の正本**はワールド設定 `activeFocusSystems`。
 * FS判定シート(ページ)は設定の置き場であって実行状態を持たない。チャットに出す開始カード・
 * 結果カードは通知であって状態を持たない(正本の二重化を避ける)。
 *
 * FS はカットをまたいで繰り返し参照・更新される長期状態であり、単発で閉じる判定要求カードとは
 * 機能が違う。ワールド設定に置くことで、いつでも同じ場所から参照でき、フェーズ13 でコンバット
 * トラッカーにカット進行が入っても**正本の引っ越しなしに**同じ値を読める。
 */

import { buildFocusSystemSnapshot } from "./focus-system-logic.mjs";

const SCOPE = "tokyo-nova-axleration";
const SETTING = "activeFocusSystems";

/** ワールド設定の登録(init で呼ぶ)。 */
export function registerFocusSystemSetting() {
    game.settings.register(SCOPE, SETTING, {
        scope:   "world",
        config:  false,
        type:    Array,
        default: [],
    });
}

/** 実行中の FS判定を列挙する(全員が読める)。 */
export function listActiveFocusSystems() {
    return game.settings.get(SCOPE, SETTING) ?? [];
}

/** 実行中の FS判定を1件取得する。 */
export function getActiveFocusSystem(id) {
    return listActiveFocusSystems().find(fs => fs.id === id) ?? null;
}

/** 書き込みは RL(GM)のみ(ワールド設定の更新権限に合わせる)。 */
function assertGM() {
    if (!game.user.isGM) {
        ui.notifications.warn("FS判定の進行を変更できるのは RL のみです。");
        return false;
    }
    return true;
}

/**
 * FS判定を開始する(ページの内容をスナップショットとして取り込む)。
 * @param {{name:string, system:object}} page FS判定ページ相当のデータ
 * @param {{sourceUuid?:?string}} [opts]
 * @returns {Promise<?object>} 追加した実行中 FS
 */
export async function startFocusSystem(source, { sourceUuid = null } = {}) {
    if (!assertGM()) return null;
    const fs = buildFocusSystemSnapshot(source, { id: foundry.utils.randomID(), sourceUuid });
    await game.settings.set(SCOPE, SETTING, [...listActiveFocusSystems(), fs]);
    return fs;
}

/**
 * 実行中 FS を更新する(進行値・カット数の手動増減)。
 * @param {string} id
 * @param {object} patch 上書きするフィールド
 */
export async function updateFocusSystem(id, patch) {
    if (!assertGM()) return;
    const next = listActiveFocusSystems().map(fs => (fs.id === id ? { ...fs, ...patch } : fs));
    await game.settings.set(SCOPE, SETTING, next);
}

/**
 * 実行中 FS を終了する(達成/敗北の確定)。
 * @param {string} id
 * @returns {Promise<?object>} 終了した FS(見つからなければ null)
 */
export async function endFocusSystem(id) {
    if (!assertGM()) return null;
    const all  = listActiveFocusSystems();
    const done = all.find(fs => fs.id === id) ?? null;
    if (!done) return null;
    await game.settings.set(SCOPE, SETTING, all.filter(fs => fs.id !== id));
    return done;
}
