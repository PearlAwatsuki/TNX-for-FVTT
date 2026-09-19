/** ヴィークル本体とオプションを区別する。 */
export function isVehicleBody(item) {
    if (item?.type !== "vehicle" || item.system?.isOption) return false;
    const minors = getMinors(item);
    return !minors.includes("vehicleOption");
}

export function isDrone(item) {
    if (!isVehicleBody(item)) return false;
    return getMinors(item).includes("drone");
}

/** 分類がドローンのみ（純粋ドローン）。ゴースト登場を強制する。 */
export function isDroneOnly(item) {
    if (!isVehicleBody(item)) return false;
    const minors = getMinors(item).filter(m => m); // 空文字を除外
    return minors.length > 0 && minors.every(m => m === "drone");
}

// ヘルパー：アイテムが持つすべての小分類（minor）の配列を返す
function getMinors(item) {
    const minors = [];
    if (item?.system?.minorCategory) minors.push(item.system.minorCategory);
    const adds = item?.system?.additionalCategories;
    if (Array.isArray(adds)) {
        for (const add of adds) {
            if (add?.minor) minors.push(add.minor);
        }
    }
    return minors;
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
