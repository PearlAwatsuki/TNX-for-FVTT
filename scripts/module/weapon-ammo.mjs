/**
 * @fileoverview 武器の残弾・リロード(フェーズ12・正本 Outfits.md / Damage_Rules.md)。
 *
 * 残弾(ammo)は射撃武器・搭載兵器に付く。mode = none(概念なし)/value(装弾数を数字表示)/
 * arbitrary(有無だけ)。現在空か(empty)は実行時状態で、**FA 射撃で空になり、リロード
 * (マイナーアクション)で満タンに戻る。通常射撃では減らない**(2026-07-09 ユーザー確定)。
 * ※自動給弾の FA 武器は「ammo.mode=none(-)」で表現する(残弾を追跡しなければ FA しても空に
 * ならない=consumeFaAmmo が no-op。専用フラグは持たない・2026-07-10 ユーザー確定)。
 */

/**
 * 残弾を追跡する武器か(mode が none 以外)。純ロジック。
 * @param {{mode?:string}} ammo weapon.system.ammo
 * @returns {boolean}
 */
export function hasAmmoTracking(ammo) {
  return !!ammo && ammo.mode !== "none" && ammo.mode !== undefined;
}

/**
 * 現在「残弾が空(0/なし)」か。リロード導線の表示条件。純ロジック。
 * @param {{mode?:string, empty?:boolean}} ammo weapon.system.ammo
 * @returns {boolean}
 */
export function isAmmoEmpty(ammo) {
  return hasAmmoTracking(ammo) && ammo.empty === true;
}

/**
 * 武器をリロードする(残弾を満タンに戻す = empty を false に)。
 * @param {Item} weapon
 */
export async function reloadWeapon(weapon) {
  if (!weapon) return;
  if (!hasAmmoTracking(weapon.system.ammo)) return;
  await weapon.update({ "system.ammo.empty": false });
}

/**
 * FA 射撃による残弾消費(空にする)。残弾を追跡しない武器(mode=none=自動給弾)は何もしない。
 * @param {Item} weapon
 */
export async function consumeFaAmmo(weapon) {
  if (!weapon) return;
  if (!hasAmmoTracking(weapon.system.ammo)) return;
  await weapon.update({ "system.ammo.empty": true });
}
