/**
 * @fileoverview cast → User UUID 記録ロジック(フェーズ2-1)
 *
 * cast の ownership 変更を検知して cast.system.ownerUserId(User UUID)を記録する処理。
 * 純粋関数(Foundry 不要)と Foundry 依存処理を分離して実装する。
 *
 * 純粋関数: pickFirstOwnerUserId / resolveOwnerUserIdAction
 * Foundry 依存: recordCastOwnerUser
 */

// CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER = 2
// Foundry 環境外のテスト用に直値で定義する。値は Foundry の安定した定数。
const OBSERVER_LEVEL = 2;

/**
 * ownership オブジェクトから GM を除く最初の所有者 userId を選出する(純粋関数)。
 *
 * @param {object} ownership  Actor.ownership の形式 { userId: level, default: level }
 * @param {Iterable<string>} gmUserIds  GM 扱いする userId の集合
 * @returns {string|null}  見つかった userId。GM のみ / 空の場合は null
 */
export function pickFirstOwnerUserId(ownership, gmUserIds) {
  const gmSet = new Set(gmUserIds);
  for (const [userId, level] of Object.entries(ownership ?? {})) {
    if (userId === "default") continue;
    if (level < OBSERVER_LEVEL) continue;
    if (gmSet.has(userId)) continue;
    return userId;
  }
  return null;
}

/**
 * ownerUserId の記録操作を決定する(純粋関数)。
 *
 * @param {string|null} newUserUuid  新しい候補 User の UUID(User.uuid)
 * @param {string}      currentOwnerUuid  cast.system.ownerUserId の現在値
 * @returns {{ action: "set"|"confirm-overwrite"|"none", newUserUuid: string|null }}
 *   action:
 *     "set"              - ownerUserId を newUserUuid に上書き
 *     "confirm-overwrite"- 既に別 User が記録済みのため GM に上書き確認が必要
 *     "none"             - 変更不要
 */
export function resolveOwnerUserIdAction(newUserUuid, currentOwnerUuid) {
  if (!newUserUuid) return { action: "none", newUserUuid: null };
  if (!currentOwnerUuid) return { action: "set", newUserUuid };
  if (currentOwnerUuid === newUserUuid) return { action: "none", newUserUuid: null };
  return { action: "confirm-overwrite", newUserUuid };
}

/**
 * cast の ownership 変更に応じて ownerUserId を記録する(Foundry 依存)。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor} castActor  cast タイプの Actor(更新後の最新インスタンス)
 */
export async function recordCastOwnerUser(castActor) {
  const gmUserIds = game.users.filter(u => u.isGM).map(u => u.id);
  const pickedUserId = pickFirstOwnerUserId(castActor.ownership ?? {}, gmUserIds);
  const pickedUserUuid = pickedUserId ? (game.users.get(pickedUserId)?.uuid ?? null) : null;
  const currentOwnerUuid = castActor.system.ownerUserId ?? "";

  const resolution = resolveOwnerUserIdAction(pickedUserUuid, currentOwnerUuid);

  if (resolution.action === "none") return;

  if (resolution.action === "set") {
    await castActor.update(
      { "system.ownerUserId": resolution.newUserUuid },
      { calcExp: false },
    );
    return;
  }

  // confirm-overwrite: 既に別 User が記録済み。GM に上書き確認ダイアログを出す。
  const newUser = pickedUserId ? game.users.get(pickedUserId) : null;
  const currentUser = game.users.find(u => u.uuid === currentOwnerUuid);
  const confirmed = await Dialog.confirm({
    title: "キャスト主体 User の変更確認",
    content: `<p><strong>${castActor.name}</strong> の主体 User を</p>` +
             `<p><strong>${currentUser?.name ?? "不明"}</strong> → <strong>${newUser?.name ?? "不明"}</strong></p>` +
             `<p>に変更しますか？</p>`,
    defaultYes: false,
  });

  if (confirmed) {
    await castActor.update(
      { "system.ownerUserId": resolution.newUserUuid },
      { calcExp: false },
    );
  }
}
