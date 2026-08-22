/**
 * @fileoverview 登場状態(フェーズ14-2・2026-08-07 ユーザー裁定)。
 *
 * 登場するのはプレイヤーでなく**キャラクター**なので、登場状態は **Actor のフラグ**が持つ
 * (`flags.tokyo-nova-axleration.appearing`)。キャスト・ゲスト・トループ・エキストラすべて同じ器。
 * RL は登場判定なしで誰でも登場させられる(14-8・シナリオコントロールパネルの操作と、台本の
 * 事前設定)。その際に**名前を伏せる**指定ができ、対の `appearingHidden` フラグが持つ——卓には
 * 「？？？」と表示され、退場で登場状態と一緒に落ちる。登場状態は表示・参照のための状態
 * (対象化ゲートは 2026-08-08 裁定で作らない——「登場中しか対象にできない」はルールの説明で
 * あって実装指示ではなく、システムは可否を制限しない)。
 *
 * フラグの直読み・直書きを散在させず、必ず本モジュールを経由すること(user-flag-schema と同じ規範)。
 */

import { pickTokenDropPosition, tokenDeletionImpliesExit } from "./appearance-logic.mjs";

const SCOPE = "tokyo-nova-axleration";

/** 名前を伏せて登場しているキャラクターの、卓に見せる表示名(2026-08-09 ユーザー指示)。 */
export const HIDDEN_ACTOR_NAME = "？？？";

/** そのキャラクターが現在のシーンに登場しているか。 */
export function isAppearing(actor) {
    return actor?.getFlag?.(SCOPE, "appearing") === true;
}

/** 名前を伏せて登場しているか(14-8。登場状態と対で、退場時に一緒に落ちる)。 */
export function isNameHidden(actor) {
    return actor?.getFlag?.(SCOPE, "appearingHidden") === true;
}

/**
 * 卓に見せるキャラクター名。名前を伏せて登場している間は「？？？」を返す。
 * RL には実名を返す——伏せているかどうかは UI 側が印(目のアイコン)で示す。
 * @param {Actor} actor
 * @returns {string}
 */
export function displayActorName(actor) {
    if (!actor) return "";
    if (game.user.isGM) return actor.name;
    return isNameHidden(actor) ? HIDDEN_ACTOR_NAME : actor.name;
}

/**
 * 登場状態を切り替える(所有者または GM。盤面のトークン反映=存在同期は下記)。
 * @param {Actor} actor
 * @param {boolean} appearing
 * @param {{hideName?: boolean}} [opts] hideName 省略時は現在の非公開指定を保つ
 *        (トークン配置からの再登場が RL の指定を落とさないため)
 */
export async function setAppearing(actor, appearing, { hideName } = {}) {
    if (!actor) return;
    if (!appearing) {
        await actor.unsetFlag(SCOPE, "appearing");
        await setNameHidden(actor, false);
        // ゴーストも名前非公開と同様、登場と対のシーン単位の状態(2026-08-22 ユーザー指示
        // 「名前の表示非表示と同様に」)＝退場で落とす
        return setGhost(actor, false);
    }
    await actor.setFlag(SCOPE, "appearing", true);
    if (hideName === undefined) return;
    return setNameHidden(actor, hideName);
}

/**
 * ゴースト登場の状態を切り替える(RL 操作・登場判定のゴースト宣言も同じ着地)。
 * isGhost フィールドを持たない種別(トループ等)は何もしない。
 * @param {Actor} actor
 * @param {boolean} ghost
 */
export async function setGhost(actor, ghost) {
    if (!actor || actor.system?.isGhost === undefined) return;
    if (actor.system.isGhost === (ghost === true)) return;
    await actor.update({ "system.isGhost": ghost === true });
}

/**
 * 登場中のキャラクターの名前を伏せる/戻す(RL 操作)。
 * @param {Actor} actor
 * @param {boolean} hidden
 */
export async function setNameHidden(actor, hidden) {
    if (!actor) return;
    if (hidden) return actor.setFlag(SCOPE, "appearingHidden", true);
    if (isNameHidden(actor)) return actor.unsetFlag(SCOPE, "appearingHidden");
}

/** 登場中のキャラクターを列挙する(全キャラクター種)。 */
export function listAppearingActors() {
    return game.actors.filter(a => isAppearing(a));
}

/**
 * 全員を退場させる(シーン終了処理・GM 操作から呼ぶ)。
 */
export async function clearAllAppearing() {
    for (const actor of listAppearingActors()) {
        await setAppearing(actor, false);
    }
}

// ─── 盤面反映(14-8 改修・2026-08-23): 登場状態 ⇄ アクティブ盤面のトークン**存在**の双方向同期 ──
// 「トークンを盤面に出す＝登場」(2026-08-23 ユーザー指示。ココフォリア式の「登場エリアへ駒を
// 移動」は FVTT では分かりづらいという裁定)。未登場=トークンが無い・登場=トークンが有る・
// **ゴースト登場=トークンが不可視**・退場=トークン削除。旧「未登場=hidden」の表示同期を置換。
// - 権威は Actor フラグ・トークンはその反映。登場フラグ→トークン作成/全削除・isGhost→hidden
//   は activeGM クライアントが代行する
// - 逆方向=RL の直接切替導線: トークンのドラッグ配置→登場・トークン削除→退場。削除は権限を
//   持つ所有者(PL)でも退場になるため、**確認ダイアログ**を挟む(2026-08-23 ユーザー指示。
//   同期・確認済みの削除は操作オプション SYNC_OPTION でバイパスする)
// - hidden→isGhost の逆同期はしない(isGhost は CS 修正という機構的意味を持つため、盤面の
//   表示操作から黙って変えない。ゴーストの切替は専用トグル=setGhost)
// - 同一アクターの複数トークン(トループの分身コピー等)は、残りがある限り削除しても退場でない
//   (tokenDeletionImpliesExit)。一括削除などで確認を経ずに最後の1体が消えた場合は
//   deleteToken 後段で退場に落とす(帳尻)
// ループは同値短絡で止まる。Scene 跨ぎの自動生成はしない(確定方針・対象はアクティブ盤面のみ)。

/** 同期・確認済み削除が渡す操作オプション(退場確認ダイアログのバイパス)。 */
const SYNC_OPTION = "tnxAppearanceSync";

/** 確認ダイアログを出している最中のトークン(uuid)。連打での多重ダイアログを防ぐ。 */
const pendingExitConfirms = new Set();

/** 双方向同期のフック登録(ready で1回・全クライアントで呼んでよい)。 */
export function registerAppearanceTokenSync() {
    // 登場フラグ→トークンの有無・isGhost→トークンの表示(activeGM が代行)
    Hooks.on("updateActor", (actor, changes) => {
        if (game.users.activeGM?.id !== game.user.id) return;
        const f = changes.flags?.[SCOPE];
        if (f && ("appearing" in f || "-=appearing" in f)) syncTokensForActor(actor);
        if (changes.system?.isGhost !== undefined) syncGhostVisibility(actor);
    });
    // トークンのドラッグ配置=登場(RL の直接切替導線)。分身コピーの追加は登場済みの短絡で素通り
    Hooks.on("createToken", (tokenDoc) => {
        if (game.users.activeGM?.id !== game.user.id) return;
        if (tokenDoc.parent?.id !== game.scenes.active?.id) return;
        const actor = game.actors.get(tokenDoc.actorId);
        if (!actor || isAppearing(actor)) return;
        setAppearing(actor, true);
    });
    // トークン削除=退場(削除を発行したクライアントで確認を挟む。pre フックは発行元でのみ走る)
    Hooks.on("preDeleteToken", (tokenDoc, options) => {
        if (options?.[SYNC_OPTION]) return;
        if (tokenDoc.parent?.id !== game.scenes.active?.id) return;
        const actor = game.actors.get(tokenDoc.actorId);
        if (!actor) return;
        const count = tokenDoc.parent.tokens.filter(t => t.actorId === actor.id).length;
        if (!tokenDeletionImpliesExit({ appearing: isAppearing(actor), sameActorTokenCount: count })) return;
        confirmTokenExit(actor, tokenDoc);
        return false;
    });
    // 一括削除など確認を経ずに最後の1体が消えた場合の帳尻(activeGM)。トークンは既に無いので
    // ダイアログは出さず、登場状態だけを盤面に合わせる
    Hooks.on("deleteToken", (tokenDoc, options) => {
        if (options?.[SYNC_OPTION]) return;
        if (game.users.activeGM?.id !== game.user.id) return;
        if (tokenDoc.parent?.id !== game.scenes.active?.id) return;
        const actor = game.actors.get(tokenDoc.actorId);
        if (!actor || !isAppearing(actor)) return;
        if (tokenDoc.parent.tokens.some(t => t.actorId === actor.id)) return;
        setAppearing(actor, false);
    });
}

/**
 * 退場の確認ダイアログ(2026-08-23 ユーザー指示)。退場=トークン削除になったため、パネルの
 * ×ボタン・盤面のトークン削除のどちらの経路でも、本当に退場するかを確認してから適用する。
 * @param {Actor} actor
 * @param {{tokenDeletion?: boolean}} [opts] トークン削除起点の文言にする
 * @returns {Promise<boolean>}
 */
export async function confirmExitDialog(actor, { tokenDeletion = false } = {}) {
    const name = foundry.utils.escapeHTML(displayActorName(actor));
    const content = tokenDeletion
        ? `<p>トークンを削除すると ${name} はシーンから退場します。</p><p>退場させますか？</p>`
        : `<p>${name} をシーンから退場させますか？</p><p>盤面のトークンは削除されます。</p>`;
    return await foundry.applications.api.DialogV2.confirm({
        window: { title: "退場の確認" },
        content,
    }) === true;
}

/** トークン削除起点の退場確認(preDeleteToken から。確認後に削除と退場を適用する)。 */
async function confirmTokenExit(actor, tokenDoc) {
    if (pendingExitConfirms.has(tokenDoc.uuid)) return;
    pendingExitConfirms.add(tokenDoc.uuid);
    try {
        if (!await confirmExitDialog(actor, { tokenDeletion: true })) return;
        // 削除は発行元の権限のまま自前で行う(activeGM 不在でもトークンが残らない)。
        // 登場フラグは所有者権限で落とせる(削除できた=トークンの所有者=アクターの所有者)
        await tokenDoc.delete({ [SYNC_OPTION]: true });
        await setAppearing(actor, false);
    } finally {
        pendingExitConfirms.delete(tokenDoc.uuid);
    }
}

/** アクティブ盤面のトークンの有無を登場状態に合わせる(登場=作成・退場=全削除)。 */
async function syncTokensForActor(actor) {
    const scene = game.scenes.active;
    if (!scene) return;
    const tokens = scene.tokens.filter(t => t.actorId === actor.id);
    if (!isAppearing(actor)) {
        if (tokens.length) {
            await scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id), { [SYNC_OPTION]: true });
        }
        return;
    }
    if (tokens.length) return;
    const proto = await actor.getTokenDocument();
    const rect = scene.dimensions?.sceneRect
        ?? { x: 0, y: 0, width: scene.width ?? 0, height: scene.height ?? 0 };
    const gridSize = scene.grid?.size ?? 100;
    const { x, y } = pickTokenDropPosition({
        center:   { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        size:     { width: (proto.width ?? 1) * gridSize, height: (proto.height ?? 1) * gridSize },
        gridSize,
        occupied: scene.tokens.map(t => ({ x: t.x, y: t.y })),
    });
    const data = proto.toObject();
    data.x = x;
    data.y = y;
    // ゴースト登場=不可視(2026-08-23)。登場の適用側がゴーストを先に立てるので最初から反映される
    data.hidden = actor.system?.isGhost === true;
    await scene.createEmbeddedDocuments("Token", [data]);
}

/** アクティブ盤面のトークンの表示をゴースト状態に合わせる(ゴースト登場=不可視)。 */
async function syncGhostVisibility(actor) {
    const scene = game.scenes.active;
    if (!scene) return;
    const hidden = actor.system?.isGhost === true;
    const updates = scene.tokens
        .filter(t => t.actorId === actor.id && t.hidden !== hidden)
        .map(t => ({ _id: t.id, hidden }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}
