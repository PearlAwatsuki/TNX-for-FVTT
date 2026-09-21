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
    // 型分離試行時の保存データにはapplyToSelfがないため、自身への適用を互換解決する。
    return effect.transfer !== false && f.applyToParent !== true && f.applyToSelf !== false;
}

/** 保存する付与先設定を検証。元データは変更しない。 */
export function normalizeEffectKindData(source) {
    const data = structuredClone(source);
    const flags = data.flags?.[SYSTEM_ID] ?? {};
    if (!isEnchantment(data)) return data;
    const parent = flags.applyToParent === true;
    const self = flags.applyToSelf === undefined ? !parent && data.transfer !== false : flags.applyToSelf === true;
    if (parent && self) throw new Error("付与先は「準備先」「このアイテム自身」のどちらか一方を選択してください。");
    if (data.transfer !== false && !parent && !self) throw new Error("自動適用する付与AEには適用先が必要です。");
    data.statuses = [];
    data.flags ??= {};
    const nextFlags = data.flags[SYSTEM_ID] = { ...flags, applyToParent: parent, applyToSelf: self };
    for (const key of ENCHANTMENT_STATUS_FLAGS) delete nextFlags[key];
    return data;
}
