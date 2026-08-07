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
