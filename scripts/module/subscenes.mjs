/**
 * @fileoverview サブシーン(フェーズ14-4・正本 Phase_14_Tasks_Detail.md)。
 *
 * ココフォリアのシーンのように**名前付きの盤面状態(名前＋背景画像)を保存して切り替える**独立機能
 * (2026-08-08 ユーザー裁定)。**Scene には属さないワールド独立のリスト**(2026-08-08 ユーザー裁定)
 * ——中身に Scene 依存の情報はなく、適用先は「その時アクティブな盤面 Scene」。正本はワールド設定
 * `subScenes` 一箇所(sessionState と同方式・GM のみ書き込み)。
 *
 * - 適用＝アクティブ Scene の背景(`background.src`)差し替え。トークンは常駐のまま(確定方針)。
 * - 「現在どのサブシーンか」は状態を持たず導出する(アクティブ Scene の背景と保存値の一致)。
 * - 台本(アクトシートのシーン行)の舞台参照 `subScene:<id>` はこのリストを指し、TNX シーン切替と
 *   同時に適用される(applyStageRef)。`scene:<id>` は通常 Scene のアクティブ化。
 */

import { parseStageRef } from "./session-logic.mjs";
import { moveItemBy, moveItemTo } from "./list-order.mjs";

const SCOPE = "tokyo-nova-axleration";
const SETTING = "subScenes";

/** ワールド設定の登録(init で呼ぶ)。 */
export function registerSubSceneSetting() {
    game.settings.register(SCOPE, SETTING, {
        scope:   "world",
        config:  false,
        type:    Array,
        default: [],
        // 変更したら開いているサブシーンパネルを全クライアントで再描画する
        onChange: () => {
            foundry.applications.instances.get("tnx-subscene-panel")?.render(false);
        },
    });
}

/** サブシーンを列挙する(全員が読める)。 */
export function listSubScenes() {
    return game.settings.get(SCOPE, SETTING) ?? [];
}

/** サブシーンを1件取得する。 */
export function getSubScene(id) {
    return listSubScenes().find(s => s.id === id) ?? null;
}

/** そのサブシーンが現在適用中か(アクティブ Scene の背景との一致で導出・状態は持たない)。 */
export function isCurrentSubScene(sub) {
    const src = game.scenes.active?.background?.src ?? "";
    return !!sub?.background && sub.background === src;
}

function assertGM() {
    if (!game.user.isGM) {
        ui.notifications.warn("サブシーンを操作できるのは RL のみです。");
        return false;
    }
    return true;
}

async function setSubScenes(list) {
    await game.settings.set(SCOPE, SETTING, list);
}

/**
 * サブシーンを追加する。
 * @param {{name?: string, background?: string}} [data] 省略時は「現在の背景から保存」
 * @returns {Promise<?object>} 追加したサブシーン
 */
export async function createSubScene({ name = "", background = "" } = {}) {
    if (!assertGM()) return null;
    const list = listSubScenes();
    const sub = {
        id: foundry.utils.randomID(),
        name: name || `サブシーン ${list.length + 1}`,
        background: background || (game.scenes.active?.background?.src ?? ""),
    };
    await setSubScenes([...list, sub]);
    return sub;
}

/** サブシーンを更新する(名前・背景)。 */
export async function updateSubScene(id, patch) {
    if (!assertGM()) return;
    await setSubScenes(listSubScenes().map(s => (s.id === id ? { ...s, ...patch } : s)));
}

/** サブシーンを削除する。 */
export async function deleteSubScene(id) {
    if (!assertGM()) return;
    await setSubScenes(listSubScenes().filter(s => s.id !== id));
}

/** 上下ボタンの並び替え(delta: 負=上・正=下)。 */
export async function moveSubSceneBy(id, delta) {
    if (!assertGM()) return;
    await setSubScenes(moveItemBy(listSubScenes(), id, delta));
}

/** グリップ DnD の並び替え(toIndex へ挿入)。 */
export async function moveSubSceneTo(id, toIndex) {
    if (!assertGM()) return;
    await setSubScenes(moveItemTo(listSubScenes(), id, toIndex));
}

/**
 * サブシーンを適用する＝アクティブな盤面 Scene の背景を差し替える。
 * @param {string} id
 */
export async function applySubScene(id) {
    if (!assertGM()) return;
    const sub = getSubScene(id);
    if (!sub) return;
    if (!sub.background) return void ui.notifications.warn("このサブシーンに背景画像が設定されていません。");
    const scene = game.scenes.active;
    if (!scene) return void ui.notifications.warn("アクティブなシーン(盤面)がありません。");
    await scene.update({ "background.src": sub.background });
}

/**
 * 台本の舞台参照を適用する(TNX シーン切替と同時に舞台が切り替わる・設計判断8)。
 * - `scene:<id>` → その Scene をアクティブ化(全員の表示が切り替わる)
 * - `subScene:<id>` → アクティブな盤面 Scene の背景を差し替え
 * - 参照なし・解決不能 → 何もしない(現状の盤面のまま)
 * @param {string} stageRef シーン行の `stage` 複合値
 */
export async function applyStageRef(stageRef) {
    const ref = parseStageRef(stageRef);
    if (!ref) return;
    if (ref.type === "scene") {
        const scene = game.scenes.get(ref.id);
        if (!scene) return void ui.notifications.warn("舞台に指定された通常シーンが見つかりません。");
        if (!scene.active) await scene.activate();
        return;
    }
    await applySubScene(ref.id);
}
