/**
 * @fileoverview サブシーン(フェーズ14-4・正本 Phase_14_Tasks_Detail.md)。
 *
 * ココフォリアのシーンのように**名前付きの盤面状態(名前＋背景画像)を保存して切り替える**独立機能
 * (2026-08-08 ユーザー裁定)。**Scene には属さないワールド独立のリスト**(2026-08-08 ユーザー裁定)
 * ——中身に Scene 依存の情報はなく、適用先は「その時アクティブな盤面 Scene」。正本はワールド設定
 * `subScenes` 一箇所(sessionState と同方式・GM のみ書き込み)。
 *
 * - **適用＝Scene ドキュメントの背景は書き換えない**(2026-08-08 ユーザー指摘で是正:
 *   `background.src` の update はキャンバス再描画=シーン読み込みを誘発し、サブシーンの意味を失う)。
 *   適用中サブシーンはアクティブ Scene のフラグ `subSceneOverride` に記録し(フラグ更新は再描画を
 *   誘発しない)、各クライアントが**背景メッシュのテクスチャだけを直接差し替える**
 *   (refreshSubSceneBackground・canvasReady/updateScene で再適用)。トークンは常駐のまま(確定方針)。
 * - 「現在どのサブシーンか」＝アクティブ Scene の `subSceneOverride` フラグ。
 * - 台本(アクトシートのシーン行)の舞台参照 `subScene:<id>` はこのリストを指し、TNX シーン切替と
 *   同時に適用される(applyStageRef)。`scene:<id>` は通常 Scene のアクティブ化。
 * - 運用上の前提: 盤面 Scene には初期背景を1枚設定しておく(背景なしだと背景メッシュ自体が
 *   生成されず差し替え先が無い)。サイズの異なる画像はシーンの背景矩形に合わせて伸縮される。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { parseStageRef } from "../rules/session.mjs";
import { moveItemBy, moveItemTo } from "../core/list-order.mjs";

const SETTING = "subScenes";

/** ワールド設定の登録(init で呼ぶ)。 */
export function registerSubSceneSetting() {
    game.settings.register(SYSTEM_ID, SETTING, {
        scope:   "world",
        config:  false,
        type:    Array,
        default: [],
        // 変更したら開いているサブシーンパネルを再描画し、適用中サブシーンの画像編集にも
        // 表示を追随させる(全クライアント)
        onChange: () => {
            foundry.applications.instances.get("tnx-subscene-panel")?.render(false);
            refreshSubSceneBackground();
        },
    });
}

/** サブシーンを列挙する(全員が読める)。 */
export function listSubScenes() {
    return game.settings.get(SYSTEM_ID, SETTING) ?? [];
}

/** サブシーンを1件取得する。 */
export function getSubScene(id) {
    return listSubScenes().find(s => s.id === id) ?? null;
}

/** そのサブシーンが現在適用中か(アクティブ Scene の `subSceneOverride` フラグ)。 */
export function isCurrentSubScene(sub) {
    return !!sub?.id && game.scenes.active?.getFlag(SYSTEM_ID, "subSceneOverride") === sub.id;
}

function assertGM() {
    if (!game.user.isGM) {
        ui.notifications.warn("サブシーンを操作できるのは RL のみです。");
        return false;
    }
    return true;
}

async function setSubScenes(list) {
    await game.settings.set(SYSTEM_ID, SETTING, list);
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
 * サブシーンを適用する。アクティブな盤面 Scene のフラグに適用中 id を記録するだけ——
 * 実際の表示は各クライアントの refreshSubSceneBackground が updateScene/canvasReady で
 * テクスチャを差し替える(Scene 再描画=読み込みを走らせない)。
 * @param {string} id
 */
export async function applySubScene(id) {
    if (!assertGM()) return;
    const sub = getSubScene(id);
    if (!sub) return;
    if (!sub.background) return void ui.notifications.warn("このサブシーンに背景画像が設定されていません。");
    const scene = game.scenes.active;
    if (!scene) return void ui.notifications.warn("アクティブなシーン(盤面)がありません。");
    await scene.setFlag(SYSTEM_ID, "subSceneOverride", id);
}

/** サブシーンの適用を解除し、アクティブ Scene 本来の背景に戻す。 */
export async function clearSubSceneOverride() {
    if (!assertGM()) return;
    const scene = game.scenes.active;
    if (!scene) return;
    await scene.unsetFlag(SYSTEM_ID, "subSceneOverride");
}

/**
 * 表示中 Scene の背景テクスチャを適用中サブシーンに合わせて差し替える(全クライアントで実行)。
 * Scene ドキュメントは書き換えない。適用解除・オーバーライド無しのときは Scene 本来の背景へ戻す。
 * 動画背景の差し替えは対象外(静止画を想定)。
 */
export async function refreshSubSceneBackground() {
    if (!canvas?.ready || !canvas.scene) return;
    const overrideId = canvas.scene.getFlag(SYSTEM_ID, "subSceneOverride") ?? "";
    const sub = overrideId ? getSubScene(overrideId) : null;
    const src = sub?.background || canvas.scene.background?.src || "";
    const mesh = canvas.primary?.background;
    if (!mesh) {
        // 背景未設定の Scene は背景メッシュ自体が無く差し替え先が無い(運用: 初期背景を設定する)
        if (sub && game.user.isGM) {
            ui.notifications.warn("盤面の Scene に背景が設定されていないため、サブシーンを表示できません。Scene 設定で初期背景を1枚設定してください。");
        }
        return;
    }
    if (!src) return;
    const tex = await foundry.canvas.loadTexture(src);
    if (tex) mesh.texture = tex;
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
