/**
 * @fileoverview 登場状態(フェーズ14-2・2026-08-07 ユーザー裁定)。
 *
 * 登場するのはプレイヤーでなく**キャラクター**なので、登場状態は **Actor のフラグ**が持つ
 * (`flags.tokyo-nova-axleration.appearing`)。キャスト・ゲスト・トループ・エキストラすべて同じ器。
 * RL 側キャラクターは登場判定なしで RL が直接切り替える。機能的意味は**対象化ゲート**
 * 「基本的に、登場しているキャラクターしか技能などの対象にできない」——ゲートの実装は 14-5
 * (target-resolution)で、本モジュールは状態 API のみ。
 *
 * フラグの直読み・直書きを散在させず、必ず本モジュールを経由すること(user-flag-schema と同じ規範)。
 */

const SCOPE = "tokyo-nova-axleration";

/** そのキャラクターが現在のシーンに登場しているか。 */
export function isAppearing(actor) {
    return actor?.getFlag?.(SCOPE, "appearing") === true;
}

/**
 * 登場状態を切り替える(所有者または GM。盤面のトークン反映は 14-3/14-4)。
 * @param {Actor} actor
 * @param {boolean} appearing
 */
export async function setAppearing(actor, appearing) {
    if (!actor) return;
    if (appearing) return actor.setFlag(SCOPE, "appearing", true);
    return actor.unsetFlag(SCOPE, "appearing");
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
        await actor.unsetFlag(SCOPE, "appearing");
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
