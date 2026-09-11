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

import { SYSTEM_ID } from "../constants.mjs";
import { pickTokenDropPosition, tokenDeletionImpliesExit } from "../rules/appearance.mjs";
import { teamLinkedExitTargets } from "../rules/session.mjs";
import { TNX_HOOKS } from "../rules/combat-events.mjs";


/** 名前を伏せて登場しているキャラクターの、卓に見せる表示名(2026-08-09 ユーザー指示)。 */
export const HIDDEN_ACTOR_NAME = "？？？";

/** そのキャラクターが現在のシーンに登場しているか。 */
export function isAppearing(actor) {
    return actor?.getFlag?.(SYSTEM_ID, "appearing") === true;
}

/** 名前を伏せて登場しているか(14-8。登場状態と対で、退場時に一緒に落ちる)。 */
export function isNameHidden(actor) {
    return actor?.getFlag?.(SYSTEM_ID, "appearingHidden") === true;
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
        const wasAppearing = isAppearing(actor);
        await actor.unsetFlag(SYSTEM_ID, "appearing");
        await setNameHidden(actor, false);
        // ゴーストも名前非公開と同様、登場と対のシーン単位の状態(2026-08-22 ユーザー指示
        // 「名前の表示非表示と同様に」)＝退場で落とす
        await setGhost(actor, false);
        // 退場＝そのキャラクターにとってのシーンの終わり(15-1)。時間管理が購読して
        // 「シーン中」の効果・使用回数を畳む。登場していなかった場合は発火しない
        if (wasAppearing) Hooks.callAll(TNX_HOOKS.actorExit, actor);
        return;
    }
    await actor.setFlag(SYSTEM_ID, "appearing", true);
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
    if (hidden) return actor.setFlag(SYSTEM_ID, "appearingHidden", true);
    if (isNameHidden(actor)) return actor.unsetFlag(SYSTEM_ID, "appearingHidden");
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
// **ゴースト登場=トークンが半透明**・退場=トークン削除。旧「未登場=hidden」の表示同期を置換。
// - 権威は Actor フラグ・トークンはその反映。登場フラグ→トークン作成/全削除・isGhost→半透明表示
//   は activeGM クライアントが代行する
// - 逆方向=RL の直接切替導線: トークンのドラッグ配置→登場・トークン削除→退場。削除は権限を
//   持つ所有者(PL)でも退場になる
// - **退場確認ダイアログはチーム退場時のみ**(2026-08-23 ユーザー裁定=ダイアログはチームの
//   巻き込みを想定した提案だったため)。チームの退場連動(ゲーム設定 teamLinkedExit・既定オフ)
//   が**自分以外の登場中メンバーに及ぶときだけ**確認し、単独の退場は×・トークン削除とも
//   確認なしで即適用する。連動の適用は GM=直接・PL=teamExit ソケットで activeGM に委譲
// - 半透明表示→isGhost の逆同期はしない(isGhost は CS 修正という機構的意味を持つため、盤面の
//   表示操作から黙って変えない。ゴーストの切替は専用トグル=setGhost)
// - 同一アクターの複数トークン(トループの分身コピー等)は、残りがある限り削除しても退場でない
//   (tokenDeletionImpliesExit)。最後の1体の削除は deleteToken 後段(activeGM)が退場に落とす
//   ——確認を経ない削除(一括削除含む)が連動退場を起こすことはない(連動は確認とセット)
// ループは同値短絡で止まる。Scene 跨ぎの自動生成はしない(確定方針・対象はアクティブ盤面のみ)。

/** 同期・確認済み削除が渡す操作オプション(退場フックのバイパス)。 */
const SYNC_OPTION = "tnxAppearanceSync";

/** 確認ダイアログを出している最中のトークン(uuid)。連打での多重ダイアログを防ぐ。 */
const pendingExitConfirms = new Set();

/** 双方向同期のフック登録(ready で1回・全クライアントで呼んでよい)。 */
export function registerAppearanceTokenSync() {
    // 不透明度の設定値を保存し直さず、描画時だけ半分にする。全クライアントで適用する。
    Hooks.on("refreshToken", (token, flags) => {
        if (!token.mesh || !(flags.refreshMesh || flags.refreshState)) return;
        if (token.actor?.system?.isGhost) token.mesh.alpha *= 0.5;
    });
    // 旧実装のゴースト不可視を、盤面を開いた際にも解除する。
    const revealGhostTokens = async (canvas) => {
        if (!canvas?.scene || game.users.activeGM?.id !== game.user.id) return;
        const updates = canvas.scene.tokens
            .filter(t => t.hidden && t.actor?.system?.isGhost)
            .map(t => ({ _id: t.id, hidden: false }));
        if (updates.length) await canvas.scene.updateEmbeddedDocuments("Token", updates);
    };
    Hooks.on("canvasReady", revealGhostTokens);
    revealGhostTokens(globalThis.canvas);
    // 登場フラグ→トークンの有無・isGhost→トークンの表示(activeGM が代行)
    Hooks.on("updateActor", (actor, changes) => {
        if (changes.system?.isGhost !== undefined) {
            for (const token of actor.getActiveTokens()) token.renderFlags.set({ refreshMesh: true });
        }
        if (game.users.activeGM?.id !== game.user.id) return;
        const f = changes.flags?.[SYSTEM_ID];
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
    // トークン削除=退場。チームの退場連動が他メンバーに及ぶときだけ削除を止めて確認を挟む
    // (pre フックは発行元でのみ走る=ダイアログは操作した本人にだけ出る)。それ以外は素通し=
    // 削除後の deleteToken 後段が退場に落とす
    Hooks.on("preDeleteToken", (tokenDoc, options) => {
        if (options?.[SYNC_OPTION]) return;
        if (tokenDoc.parent?.id !== game.scenes.active?.id) return;
        const actor = game.actors.get(tokenDoc.actorId);
        if (!actor) return;
        const count = tokenDoc.parent.tokens.filter(t => t.actorId === actor.id).length;
        if (!tokenDeletionImpliesExit({ appearing: isAppearing(actor), sameActorTokenCount: count })) return;
        const targets = manualExitTargets(actor.id);
        if (!targets.others.length) return;
        confirmTokenTeamExit(actor, tokenDoc, targets);
        return false;
    });
    // 最後の1体が消えたら退場に落とす(activeGM)。単独退場の本経路であり、一括削除の帳尻でも
    // ある。トークンは既に無いので確認は出さず、連動退場もここからは起こさない(連動は確認と
    // セット=確認を経ない削除が他メンバーを巻き込むことはない)
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
 * 手動退場の対象を解決する(チームの退場連動・2026-08-23 ユーザー裁定)。
 * sessionState の直読みはここだけ——session-state は本モジュールを import しているため、
 * 逆向きの import は循環になる(チーム操作の API は従来どおり session-state が正)。
 * @param {string} actorId
 * @returns {{targetIds: Array<string>, others: Array<string>, teamName: string}}
 */
export function manualExitTargets(actorId) {
    const teams = game.settings.get(SYSTEM_ID, "sessionState")?.teams ?? [];
    return teamLinkedExitTargets(teams, actorId, {
        linked: game.settings.get(SYSTEM_ID, "teamLinkedExit") === true,
        isAppearing: id => isAppearing(game.actors.get(id)),
    });
}

/**
 * 手動退場を適用する(パネルの×・トークン削除確認後の共通の着地・2026-08-23)。
 * GM は直接適用し、PL は activeGM へ委譲する(チームメイトのアクターを更新できないため。
 * 対象の再解決も GM 側で行う=クライアントの主張を信用しない)。
 * @param {string} actorId 退場操作の対象(連動対象は GM 側で再解決)
 */
export async function applyManualExit(actorId) {
    if (!game.user.isGM) {
        const { TnxSocketHandler } = await import("../core/tnx-socket-handler.mjs");
        return void TnxSocketHandler.emitTeamExit({ actorId });
    }
    for (const id of manualExitTargets(actorId).targetIds) {
        const actor = game.actors.get(id);
        if (actor) await setAppearing(actor, false);
    }
}

/**
 * チーム退場の確認ダイアログ(2026-08-23 ユーザー裁定=確認はチーム退場時のみ)。
 * 巻き込まれるメンバーを名前で明示する(名前非公開は displayActorName で伏せたまま)。
 * @param {Actor} actor 退場操作の対象
 * @param {{others: Array<string>, teamName: string, tokenDeletion?: boolean}} args
 * @returns {Promise<boolean>}
 */
export async function confirmTeamExitDialog(actor, { others, teamName, tokenDeletion = false }) {
    const esc = foundry.utils.escapeHTML;
    const name = esc(displayActorName(actor));
    const team = esc(teamName);
    const names = others
        .map(id => esc(displayActorName(game.actors.get(id))))
        .filter(n => n)
        .join("、");
    const lead = tokenDeletion
        ? `トークンを削除すると ${name} は退場し、`
        : `${name} を退場させると、`;
    return await foundry.applications.api.DialogV2.confirm({
        window: { title: "チーム退場の確認" },
        content: `<p>${lead}チーム「${team}」の ${names} も一緒に退場します。</p><p>退場させますか？</p>`,
    }) === true;
}

/** トークン削除起点のチーム退場確認(preDeleteToken から。確認後に連動退場を適用する)。 */
async function confirmTokenTeamExit(actor, tokenDoc, targets) {
    if (pendingExitConfirms.has(tokenDoc.uuid)) return;
    pendingExitConfirms.add(tokenDoc.uuid);
    try {
        if (!await confirmTeamExitDialog(actor, { ...targets, tokenDeletion: true })) return;
        // トークンの削除は退場同期に任せる(全メンバーの退場→各自のトークンが消える)
        await applyManualExit(actor.id);
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
    // 登場するコマは所有者も操作できるよう表示する。ゴーストの半透明化は描画フックで適用。
    data.hidden = false;
    await scene.createEmbeddedDocuments("Token", [data]);
}

/** アクティブ盤面のトークンの不可視を解除する(半透明化は各クライアントの描画で適用)。 */
async function syncGhostVisibility(actor) {
    const scene = game.scenes.active;
    if (!scene) return;
    const updates = scene.tokens
        .filter(t => t.actorId === actor.id && t.hidden)
        .map(t => ({ _id: t.id, hidden: false }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}
