/** パリー用途の使用武器と受け値を解決する。実行時の正本は usage.weaponRefs だけ。 */
export function resolveParryWeapons(actor, usage, parentItem = null) {
    const refs = usage?.weaponRefs ?? [];
    // 既存の用途データ規約では空配列が「生身」を表す。通常アイテム参照として検索しない。
    if (!refs.length) return [{ id: "", item: null, unarmed: true }];

    const out = [];
    const seen = new Set();
    for (const ref of refs) {
        const id = ref?.itemId || "";
        if (!id || seen.has(id)) continue;
        const item = id === parentItem?.id ? parentItem : actor?.items?.get?.(id);
        out.push({ id, item: item ?? null, unarmed: false });
        seen.add(id);
    }
    return out;
}

/** 生身の実効受け値。攻撃側の生身と同じく Actor の基礎値+修正値を読む。 */
export function effectiveUnarmedGuardValue(actor) {
    const guard = actor?.system?.baseGuard ?? {};
    const value = Number(guard.value ?? 0);
    const mod = Number(guard.mod ?? 0);
    return (Number.isFinite(value) ? value : 0) + (Number.isFinite(mod) ? mod : 0);
}

export function effectiveGuardValue(item) {
    const guard = item?.system?.guardValue;
    // mode=none is the displayed "-" and cannot parry. mode=value with value 0 is valid.
    if (!guard || guard.mode !== "value") return null;
    const value = Number(guard.total ?? guard.value);
    return Number.isFinite(value) ? value : null;
}

export function isParryWeaponEligible(item) {
    return ["weapon", "cyborg"].includes(item?.type) && effectiveGuardValue(item) !== null;
}

export function buildParryGuardSnapshot(actor, usage, parentItem = null) {
    const refs = resolveParryWeapons(actor, usage, parentItem);
    const invalid = [];
    const weapons = refs.map(({ id, item, unarmed }) => {
        if (unarmed) {
            return { itemId: "", uuid: "", name: "生身", guardValue: effectiveUnarmedGuardValue(actor), unarmed: true };
        }
        if (!item) { invalid.push({ id, reason: "参照先が見つかりません" }); return null; }
        const guardValue = effectiveGuardValue(item);
        if (guardValue === null) { invalid.push({ id, name: item.name, reason: "受け値を持ちません" }); return null; }
        return { itemId: id, uuid: item.uuid ?? "", name: item.name ?? "?", guardValue, unarmed: false };
    }).filter(Boolean);
    return { weapons, invalid, base: weapons.reduce((sum, w) => sum + w.guardValue, 0) };
}
