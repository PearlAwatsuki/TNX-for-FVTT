/**
 * @fileoverview 登場状態(フェーズ14-2・2026-08-07 ユーザー裁定)。
 *
 * 登場するのはプレイヤーでなく**キャラクター**なので、登場状態は **Actor のフラグ**が持つ
 * (`flags.tokyo-nova-axleration.appearing`)。キャスト・ゲスト・トループ・エキストラすべて同じ器。
 * RL は登場判定なしで誰でも登場させられる(14-8・シナリオコントロールパネルの操作と、台本の
 * 事前設定)。その際に**名前を伏せる**指定ができ、対の `appearingHidden` フラグが持つ——卓には
 * 「？？？」と表示され、退場で登場状態と一緒に落ちる。機能的意味は**対象化ゲート**
 * 「基本的に、登場しているキャラクターしか技能などの対象にできない」——ゲートの実装は 14-5
 * (target-resolution)で、本モジュールは状態 API のみ。
 *
 * フラグの直読み・直書きを散在させず、必ず本モジュールを経由すること(user-flag-schema と同じ規範)。
 */

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
 * 登場状態を切り替える(所有者または GM。盤面のトークン反映は 14-3/14-4)。
 * @param {Actor} actor
 * @param {boolean} appearing
 * @param {{hideName?: boolean}} [opts] hideName 省略時は現在の非公開指定を保つ
 *        (トークン表示切替からの再登場が RL の指定を落とさないため)
 */
export async function setAppearing(actor, appearing, { hideName } = {}) {
    if (!actor) return;
    if (!appearing) {
        await actor.unsetFlag(SCOPE, "appearing");
        return setNameHidden(actor, false);
    }
    await actor.setFlag(SCOPE, "appearing", true);
    if (hideName === undefined) return;
    return setNameHidden(actor, hideName);
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

// ─── 盤面反映(14-5): 登場状態 ⇄ アクティブ盤面のトークン表示(hidden)の双方向同期 ──────
// 権威は Actor フラグ・トークンはその反映。逆方向(トークン表示の切替→フラグ)は RL の
// 「直接切替」の導線=トークンの表示/非表示操作がそのままスイッチになる。hidden の更新は
// GM 専権のため、どちらの方向も activeGM クライアントが代行する。リンクトークンのみ対象
// (トループの分身コピー等の非リンクは per-token の状態を持たないため RL の手動管理)。
// ループは同値短絡で止まる(A→B→同値・B→A→同値)。Scene 跨ぎの自動生成はしない(確定方針)。

/** 双方向同期のフック登録(ready で1回・全クライアントで呼んでよい=activeGM だけが動く)。 */
export function registerAppearanceTokenSync() {
    Hooks.on("updateActor", (actor, changes) => {
        if (game.users.activeGM?.id !== game.user.id) return;
        const f = changes.flags?.[SCOPE];
        if (!f || !("appearing" in f || "-=appearing" in f)) return;
        syncTokensForActor(actor);
    });
    Hooks.on("updateToken", (tokenDoc, changes) => {
        if (game.users.activeGM?.id !== game.user.id) return;
        if (!("hidden" in changes)) return;
        if (tokenDoc.parent?.id !== game.scenes.active?.id) return;
        if (!tokenDoc.actorLink) return;
        const actor = tokenDoc.actor;
        if (!actor) return;
        const shouldAppear = tokenDoc.hidden !== true;
        if (isAppearing(actor) === shouldAppear) return;
        setAppearing(actor, shouldAppear);
    });
}

/** アクティブ盤面上の該当アクターのリンクトークンの表示を登場状態に合わせる。 */
async function syncTokensForActor(actor) {
    const scene = game.scenes.active;
    if (!scene) return;
    const appearing = isAppearing(actor);
    const updates = scene.tokens
        .filter(t => t.actorLink && t.actorId === actor.id && (t.hidden === true) === appearing)
        .map(t => ({ _id: t.id, hidden: !appearing }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}
