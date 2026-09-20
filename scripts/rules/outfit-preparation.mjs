/** 実効属性の変更で、個別の準備条件を失ったアウトフィットを抽出する。 */
import { OUTFIT_TYPES, hasClassification } from "../data/item/outfit-categories.mjs";
import { matchesHostDescriptor, computePartOccupancy, OUTFIT_NAME_SLOT_KIND } from "../data/item/part-helpers.mjs";
import { readFlag } from "../data/item/helpers.mjs";

export function planInvalidOutfitPreparation(actor) {
    const items = Array.from(actor?.items ?? []).filter(item => OUTFIT_TYPES.has(item.type));
    const invalid = new Map();
    const partSlots = actor?.system?.partSlotsEffective ?? actor?.system?.partSlots ?? [];
    for (const item of items) {
        const sys = item.system;
        if ((item._source?.system?.isPrepared ?? sys.isPrepared) !== true) continue;
        if (hasClassification(sys, "background")) continue; // 常時準備・携帯の既存規約。
        if (sys.isPrepared === false) { invalid.set(item.id, "部位の変更により準備不可"); continue; }
        if (sys.isOption) {
            const host = items.find(candidate => candidate.id === sys.parentItemId && candidate.id !== item.id);
            if (!host || host.system.isOption || !host.system.isPrepared) {
                invalid.set(item.id, "準備先が未準備または存在しない"); continue;
            }
            const spec = (sys.part ?? []).find(row => (row.kind === "reference" ? row.refSubKind : row.kind) === "option") ?? {};
            const hostData = { ...host.system, isLaser: readFlag(host.system, "isLaser"), isMutantOrgan: readFlag(host.system, "isMutantOrgan") };
            if (!matchesHostDescriptor(hostData, spec)) {
                invalid.set(item.id, "準備先の分類・特徴が装備条件を満たさない"); continue;
            }
            const slots = (host.system.slots ?? []).filter(slot => slot.count?.mode === "value" && Number(slot.count.total ?? slot.count.value) > 0);
            const selected = slots.find(slot => slot.kind === sys.parentSlotKind);
            const capacity = selected ? Number(selected.count.total ?? selected.count.value)
                : !slots.length && sys.parentSlotKind === OUTFIT_NAME_SLOT_KIND ? 1 : null;
            if (capacity === null) { invalid.set(item.id, "選択した準備先スロットが存在しない"); continue; }
            const consumption = Number.isFinite(Number(spec.slots)) ? Math.max(0, Number(spec.slots)) : 1;
            if (!sys.partOptional && !hasClassification(sys, "housingAccessory") && consumption > capacity) {
                invalid.set(item.id, "単体で準備先の容量を超過する"); continue;
            }
        }
        const occupancy = computePartOccupancy(partSlots, [{ ...sys, isPrepared: true }]);
        if (occupancy.slots.some(slot => slot.over)) invalid.set(item.id, "単体で身体部位の容量を超過する");
    }
    // 解除されるホストに付いていたオプションも同じ更新で解除する。
    for (const item of items) {
        if (item.system.isPrepared && item.system.isOption && invalid.has(item.system.parentItemId)) invalid.set(item.id, "準備先の準備が解除される");
    }
    return [...invalid].map(([id, reason]) => ({ id, reason }));
}
