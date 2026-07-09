/**
 * @fileoverview 武器の残弾・リロード(フェーズ12・正本 Outfits.md / Damage_Rules.md)。
 *
 * 残弾(ammo)は射撃武器・搭載兵器に付く。mode = none(概念なし)/value(装弾数=数字。FA以外用)/
 * arbitrary(有無だけ=任意。FA武器用)。current = 現在の残弾(実行時。null=満タン(数字)/あり(任意)・
 * 0=空)。**数字は通常(非FA)射撃で1減り、任意は FA 射撃で空になる**(2026-07-10 ユーザー確定)。
 * 空(0)の武器はリロード(マイナーアクション)で満タンに戻る。
 * ※自動給弾の FA 武器は「ammo.mode=none(-)」で表現する(残弾を追跡しなければ FA しても空にならない
 * =consumeFaAmmo が no-op。専用フラグは持たない・2026-07-10 ユーザー確定)。
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
 * 現在の残弾数を返す。null(未射撃・満タン)は value(数字)/1(任意)として扱う。純ロジック。
 * 残弾を追跡しない武器は Infinity(常に残弾あり)。
 * @param {{mode?:string, value?:number, current?:number|null}} ammo
 * @returns {number}
 */
export function ammoRemaining(ammo) {
  if (!hasAmmoTracking(ammo)) return Infinity;
  const full = ammo.mode === "value" ? (Number(ammo.value) || 0) : 1;
  return ammo.current ?? full;
}

/**
 * 現在「残弾が空(0)」か。リロード導線の表示条件。純ロジック。
 * @param {{mode?:string, value?:number, current?:number|null}} ammo
 * @returns {boolean}
 */
export function isAmmoEmpty(ammo) {
  return hasAmmoTracking(ammo) && ammoRemaining(ammo) <= 0;
}

/**
 * 武器をリロードする(残弾を満タンに戻す = current を null に)。
 * @param {Item} weapon
 */
export async function reloadWeapon(weapon) {
  if (!weapon || !hasAmmoTracking(weapon.system.ammo)) return;
  await weapon.update({ "system.ammo.current": null });
}

/**
 * FA 射撃による残弾消費(空にする = current を 0 に)。任意(FA武器)を空にする。
 * 残弾を追跡しない武器(mode=none=自動給弾)は何もしない。
 * @param {Item} weapon
 */
export async function consumeFaAmmo(weapon) {
  if (!weapon || !hasAmmoTracking(weapon.system.ammo)) return;
  await weapon.update({ "system.ammo.current": 0 });
}

/**
 * 通常(非FA)射撃による残弾消費。**数字モードのみ 1 減らす**(0 未満にしない)。
 * 任意(FA武器)・none(追跡なし)は減らない(2026-07-10 ユーザー確定)。
 * @param {Item} weapon
 */
export async function consumeNormalAmmo(weapon) {
  if (!weapon) return;
  const ammo = weapon.system.ammo;
  if (!hasAmmoTracking(ammo) || ammo.mode !== "value") return;
  const cur = ammo.current ?? (Number(ammo.value) || 0);
  await weapon.update({ "system.ammo.current": Math.max(0, cur - 1) });
}
