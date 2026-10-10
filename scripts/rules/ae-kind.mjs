/** 通常AEとアウトフィット付与AEの共通判定。 */
import { SYSTEM_ID } from "../constants.mjs";
import { OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";

export const ENCHANTMENT_STATUS_FLAGS = Object.freeze(["conditions", "conditionKind", "receivedScene", "woundSource", "woundCategory"]);

export function isEnchantment(effect) {
    return effect?.type === "enchantment";
}

/** 付与先へ実体化済みの効果は、定義側の自動適用設定と切り離す。 */
export function enchantmentAppliesToSelf(effect, bearer) {
    if (!isEnchantment(effect)) return true;
    if (bearer?.documentName !== "Item" || !OUTFIT_TYPES.has(bearer.type)) return false;
    const f = effect.flags?.[SYSTEM_ID] ?? {};
    if (f.transferredFrom !== undefined || f.grantedFrom !== undefined || f.grantInstanceId) return true;
    // 自身適用は自動適用オフの使用時付与定義だけで意味を持つ。
    return effect.transfer === false && f.applyToSelf === true;
}

/** 保存する付与先設定を検証。元データは変更しない。 */
export function normalizeEffectKindData(source) {
    const data = structuredClone(source);
    const flags = data.flags?.[SYSTEM_ID] ?? {};
    if (!isEnchantment(data)) return data;
    const auto = data.transfer !== false;
    const parent = flags.applyToParent === true;
    const target = flags.applyToTarget === true;
    const self = !auto && flags.applyToSelf === true;
    const selected = [parent, target, self].filter(Boolean).length;
    if (auto && parent === target) throw new Error("自動適用する付与AEは「準備先に適用」「対象を選択して適用」のどちらか一方を選択してください。");
    if (!auto && selected > 1) throw new Error("付与先は一つだけ選択してください。");
    if (target && !String(flags.targetItemId ?? "").trim()) throw new Error("対象を選択して適用する場合は、対象アウトフィットを選択してください。");
    data.statuses = [];
    data.flags ??= {};
    const nextFlags = data.flags[SYSTEM_ID] = { ...flags, applyToParent: parent, applyToTarget: target, applyToSelf: self, targetItemId: target ? String(flags.targetItemId ?? "").trim() : "" };
    for (const key of ENCHANTMENT_STATUS_FLAGS) delete nextFlags[key];
    return data;
}

/** 指定対象が、同じアクターが所有する別のアウトフィットか検証する。 */
export function validateEffectTargetOutfit(data, bearer) {
    if (!isEnchantment(data)) return;
    const flags = data.flags?.[SYSTEM_ID] ?? {};
    if (flags.applyToTarget !== true) return;
    const targetId = String(flags.targetItemId ?? "").trim();
    const actor = bearer?.actor;
    const target = actor?.items?.get?.(targetId) ?? [...(actor?.items ?? [])].find(item => item.id === targetId);
    if (!target || !OUTFIT_TYPES.has(target.type) || target.id === bearer?.id) throw new Error("対象には、同じアクターが所有する別のアウトフィットを選択してください。");
}
