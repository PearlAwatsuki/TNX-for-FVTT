/** 技能の行動資格と対決手段。用途の種類から独立した正本。 */
export const ACTION_QUALIFICATION_LABELS = Object.freeze({
    dodge: "ドッジ", parry: "パリー",
    mentalReaction: "精神攻撃へのリアクション", socialReaction: "社会攻撃へのリアクション",
    moveBlockReaction: "移動妨害へのリアクション", escapeBlockReaction: "離脱妨害へのリアクション",
});
export const REACTION_METHOD_LABELS = Object.freeze({ ...ACTION_QUALIFICATION_LABELS, reaction: "リアクション" });

/** タイプのみ変換し、用途エントリやバックアップの内容は変更しない。資格未設定時だけ抽出する。 */
export function migrateReactionUsages(source) {
    const usages = Array.isArray(source.actions) ? source.actions : [];
    const old = usages.filter(u => Object.hasOwn(REACTION_METHOD_LABELS, u.type));
    if (source.actionQualifications === undefined && old.length) {
        source.actionQualifications = old.some(u => u.type === "reaction") ? [] : [...new Set(old.map(u => u.type))];
    }
    for (const usage of old) usage.type = "reaction";
    return source;
}

/** 未移行の辞典索引にも同じ規則を適用する。元のデータは変更しない。 */
export function reactionQualifications(system) {
    if (system.actionQualifications !== undefined) return system.actionQualifications;
    const types = (system.actions ?? []).map(u => u.type).filter(t => Object.hasOwn(REACTION_METHOD_LABELS, t));
    return types.includes("reaction") ? [] : [...new Set(types)];
}

export function hasReactionUsage(system) {
    return (system.actions ?? []).some(u => Object.hasOwn(REACTION_METHOD_LABELS, u.type));
}

/** 空のチェックは、リアクション用途を持つアクション技能だけで汎用資格となる。 */
export function hasReactionQualification(system, method) {
    if (!system.isAction || !hasReactionUsage(system)) return false;
    const qualifications = reactionQualifications(system);
    return qualifications.length === 0 || qualifications.includes(method);
}

export function reactionQualificationSummary(system) {
    const labels = reactionQualifications(system).map(q => ACTION_QUALIFICATION_LABELS[q]).filter(Boolean);
    return labels.length ? labels.join("・") : system.isAction && hasReactionUsage(system)
        ? "汎用リアクション" : "設定なし";
}

/** UIの入口や用途タイプと独立した判定分類。能動側の行動と選択済み手段を併せて照合する。 */
export function reactionCheckTypes(reaction) {
    if (!reaction) return [];
    const byAction = { mentalAttack: "mentalReaction", socialAttack: "socialReaction",
        move: "moveBlockReaction", escape: "escapeBlockReaction" };
    const activeType = reaction.activeUsageType || (reaction.activeAttackCategory ? `${reaction.activeAttackCategory}Attack` : "");
    return [...new Set(["reaction", byAction[activeType],
        Object.hasOwn(ACTION_QUALIFICATION_LABELS, reaction.mode) ? reaction.mode : null].filter(Boolean))];
}
