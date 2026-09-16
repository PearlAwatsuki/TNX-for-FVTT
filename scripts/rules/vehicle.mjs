/** ヴィークル本体とオプションを区別する。Foundry非依存。 */
export function isVehicleBody(item) {
    return item?.type === "vehicle" && !item.system?.isOption
        && !(item.system?.classifications ?? []).some(c => c.minor === "vehicleOption");
}

export function isDrone(item) {
    return isVehicleBody(item) && (item.system?.classifications ?? []).some(c => c.minor === "drone");
}

/** 乗員編集の検証。人数なしは上限を推測しない。 */
export function validateCrew(crew, capacity) {
    const ids = crew.map(c => c.actorUuid);
    if (new Set(ids).size !== ids.length) return "同じキャラクターを重複して搭乗させることはできません。";
    if (crew.filter(c => c.role === "driver").length > 1) return "操縦者は一人だけ指定できます。";
    if (crew.some(c => c.operationMode === "remote" && c.role !== "driver")) return "遠隔操縦は操縦者だけに指定できます。";
    const onboard = crew.filter(c => c.operationMode !== "remote").length;
    const limit = capacity?.total ?? capacity?.value;
    if (capacity?.mode === "value" && onboard > limit) return "ヴィークルの乗員数を超えています。";
    return null;
}

/** ドローン経由だけ適用系統を変更する。攻撃の元系統は変更しない。 */
export function vehicleDamageCategory(target, category, override = null) {
    return target?.vehicleRoute?.mode === "remote" ? "mental" : override || category;
}
