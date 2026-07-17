/**
 * @fileoverview 武器の残弾(フェーズ12・正本 Outfits.md / Damage_Rules.md・2026-07-18 再設計)。
 *
 * 残弾(ammo)は射撃武器・搭載兵器に付く。mode = none(概念なし=自動給弾)/value(装弾数=数字)。
 * 「任意」は廃止——具体的な残弾数が無い武器(FA武器等)は**残弾1**(value=1)として扱う。
 * current = 現在の残弾(実行時。null=満タン・0=空)。
 *
 * **残弾の消費・回復は自動では行わない**(2026-07-18 ユーザー確定): 通常射撃・FA射撃を含め、
 * 残弾の増減はすべて**用途の消費設定**(consumeTargets の resource="ammo"・負値=回復=リロード)から
 * 発生する。この経路の適用は usage-consumption.mjs の applyConsumptionPlan が nextAmmoCurrent で行う。
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
 * 現在の残弾数を返す。null(未射撃・満タン)は value(装弾数・0 なら残弾1扱い)として扱う。純ロジック。
 * 残弾を追跡しない武器は Infinity(常に残弾あり)。
 * @param {{mode?:string, value?:number, current?:number|null}} ammo
 * @returns {number}
 */
export function ammoRemaining(ammo) {
  if (!hasAmmoTracking(ammo)) return Infinity;
  const full = Math.max(1, Number(ammo.value) || 0);
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
 * 残弾増減後の current 値を返す(用途の消費先「残弾」・純ロジック)。
 * amount>0=消費・amount<0=回復(リロード用途=マイナス消費の表現)。
 * current から増減し 0〜装弾数(最小1)でクランプ。満タンに達したら null(満タン)へ。
 * none(追跡なし)は undefined(変更なし)。
 * @param {{mode?:string, value?:number, current?:number|null}} ammo
 * @param {number} amount
 * @returns {number|null|undefined}
 */
export function nextAmmoCurrent(ammo, amount) {
  if (!hasAmmoTracking(ammo) || !Number.isFinite(amount) || amount === 0) return undefined;
  const full = Math.max(1, Number(ammo.value) || 0);
  const next = Math.max(0, Math.min(full, (ammo.current ?? full) - amount));
  return next >= full ? null : next;
}

/**
 * 武器の残弾を増減する(用途の消費先「残弾」の適用)。
 * @param {Item} weapon
 * @param {number} amount 正=消費・負=回復
 */
export async function adjustAmmo(weapon, amount) {
  const next = nextAmmoCurrent(weapon?.system?.ammo, amount);
  if (next === undefined) return;
  await weapon.update({ "system.ammo.current": next });
}
