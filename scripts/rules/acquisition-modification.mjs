/** 親・ベース・組み合わせの技能本体を、その都度参照する。 */
export function acquisitionModificationSources(parent, usage) {
    const ids = [...new Set([parent.id, usage.baseSkillRef?.itemId,
        ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean))];
    return ids.map(id => id === parent.id ? parent : parent.actor?.items?.get(id)).filter(Boolean)
        .map(item => ({ item, formula: item.system.acquisitionModification
            ?? (item.id === parent.id && usage.acquireModified ? "@item.self.system.levelTotal" : "") }))
        .filter(row => String(row.formula).trim());
}
