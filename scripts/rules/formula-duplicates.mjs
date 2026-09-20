/** 式の直接参照だけを照合する。参照値の算出元は展開しない。 */
const docKey = (doc, fallback) => doc?.uuid ?? doc?.id ?? fallback;
const itemsOf = actor => Array.from(actor?.items ?? []);
const byKey = (actor, key) => itemsOf(actor).find(item => item.system?.identificationKey === key);

/** 新旧・相対参照を同じ参照先へ揃える。値が同じだけの別文書は混同しない。 */
export function canonicalFormulaReference(reference, { actor = null, bearer = null, target = null } = {}) {
    let key = reference.replace(/^@/, "");
    if (key.startsWith("target.")) return canonicalFormulaReference(key.slice(7), { actor: target });
    const actorKey = docKey(actor, "actor");
    const result = { diff: "margin", achievement: "achievement", card: "card" };
    if (result[key]) key = `check.${result[key]}`;
    if (key.startsWith("check.")) return `check:${key.slice(6)}`;
    key = key.replace(/^system\./, "");
    const ability = key.match(/^(reason|passion|life|mundane)\.(total|totalControl|value|control)$/);
    if (ability) {
        const path = { total: "value", totalControl: "control", value: "base", control: "baseControl" }[ability[2]];
        return `${actorKey}:abilities.${ability[1]}.${path}`;
    }
    if (key.startsWith("abilities.")) return `${actorKey}:${key}`;
    const skill = key.match(/^skill\.([^.]+)\.(.+)$/);
    if (skill) return `${actorKey}:skill.${skill[1]}.${skill[2] === "levelTotal" ? "level" : skill[2]}`;

    const parent = itemsOf(actor).find(i => i.id === bearer?.system?.parentItemId);
    let item, path;
    const legacy = key.match(/^item\.([^.]+)\.system\.(.+)$/);
    const outfit = key.match(/^outfit\.([^.]+)\.(.+)$/);
    if (legacy) {
        item = legacy[1] === "self" ? bearer : legacy[1] === "parent" ? parent : byKey(actor, legacy[1]);
        path = legacy[2];
        if (item && ["generalSkill", "styleSkill"].includes(item.type)) {
            const attr = path === "levelTotal" ? "level" : path === "level" ? "base" : path;
            return `${actorKey}:skill.${item.system.identificationKey}.${attr}`;
        }
        path = ({ "attack.total": "attack.value", "attack.value": "attack.base",
            "guardValue.total": "guard.value", "guardValue.value": "guard.base" })[path] ?? path;
    } else if (outfit) { item = byKey(actor, outfit[1]); path = outfit[2]; }
    else if (key.startsWith("item.")) { item = bearer; path = key.slice(5); }
    else if (key.startsWith("parent.")) { item = parent; path = key.slice(7); }
    if (item) {
        path = ({ "attack.total": "attack.value", "guard.total": "guard.value" })[path] ?? path;
        return `${docKey(item, `${actorKey}:outfit.${item.system?.identificationKey}`)}:${path}`;
    }
    return `${actorKey}:${key}`;
}

export function formulaReferenceKeys(formula, context = {}) {
    return [...String(formula ?? "").matchAll(/@([a-zA-Z0-9_.-]+)/g)]
        .map(match => canonicalFormulaReference(match[1], context));
}

/**
 * 競合は修正値が有利な入力欄から採用し、競合欄は全体を不採用にする。
 * baselineは暗黙の基礎能力値・カード等。重複可欄は他の欄の選択を妨げない。
 * noteを持つ無効行は既存の理由を保持し、使用済み参照を予約しない。
 */
export function selectFormulaContributions(rows, { baseline = [], pick = "max" } = {}) {
    const used = new Set(baseline);
    const results = rows.flatMap(row => row.formulaRows ?? [row]).map(row => {
        const next = { ...row };
        if (Number.isFinite(next.excludedValue)) {
            next.value = next.excludedValue;
            delete next.note;
            delete next.excludedValue;
        }
        return next;
    });
    const exclude = (row, note) => { row.excludedValue = row.value; row.value = 0; row.note = note; };
    const groups = new Map();
    for (const row of results) {
        if (row.stackable || row.note) continue;
        const keys = row.referenceKeys ?? [];
        if (keys.some(key => used.has(key))) {
            exclude(row, "同じ式キーの重複により式全体を不採用");
        }
        if (!row.effectIdentity) continue;
        const instances = groups.get(row.effectIdentity) ?? new Map();
        const instance = instances.get(row.effectInstance) ?? { value: 0, rows: [] };
        instance.value += row.value;
        instance.rows.push(row);
        instances.set(row.effectInstance, instance);
        groups.set(row.effectIdentity, instances);
    }
    for (const instances of groups.values()) {
        const sorted = [...instances.values()].sort((a, b) => pick === "min" ? a.value - b.value : b.value - a.value);
        for (const instance of sorted.slice(1)) for (const row of instance.rows) {
            if (!row.note) exclude(row, "同じAE IDの重複により不採用");
        }
    }
    const candidates = results.map((row, index) => ({ row, index }))
        .sort((a, b) => (pick === "min" ? a.row.value - b.row.value : b.row.value - a.row.value) || a.index - b.index);
    for (const { row } of candidates) {
        if (row.note || row.stackable === true) continue;
        const keys = row.referenceKeys ?? [];
        if (keys.some(key => used.has(key))) {
            exclude(row, "同じ式キーの重複により式全体を不採用");
            continue;
        }
        for (const key of keys) used.add(key);
    }
    return { total: results.reduce((sum, row) => sum + row.value, 0), sources: results };
}

/** 事後修正でも既存の入力欄と比較し、最終合計の差だけを既存台帳へ足す。 */
export function appendFormulaContribution(snapshot, row, { pick = "max" } = {}) {
    const previous = snapshot?.sources ?? [];
    const baseline = snapshot?.baseline ?? [];
    const result = selectFormulaContributions([...previous, row], { baseline, pick });
    return {
        delta: result.total - previous.reduce((sum, source) => sum + source.value, 0),
        snapshot: { baseline, sources: result.sources },
        contribution: result.sources.at(-1),
    };
}
