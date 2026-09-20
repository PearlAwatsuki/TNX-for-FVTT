/** 式の参照トークンだけを変換する。説明文・識別キー・数値の文字列置換はしない。 */
import { OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";

const SKILLS = new Set(["generalSkill", "styleSkill"]);
const sameDocument = (a, b) => a === b || !!(a?.uuid && a.uuid === b?.uuid)
    || !!((a?._id ?? a?.id) && (a?._id ?? a?.id) === (b?._id ?? b?.id));

function outfitPath(path) {
    const known = { "attack.total": "attack.value", "attack.value": "attack.base",
        "guardValue.total": "guard.value", "guardValue.value": "guard.base" };
    if (known[path]) return known[path];
    const defence = path.match(/^defence\.([SPI])_total$/);
    if (defence) return `defence.${defence[1]}`;
    return path;
}

/** 不明な文脈が一つでもあれば、その式は丸ごと元のまま返す。 */
export function planFormulaKeyMigration(formula, { items = [], bearer = null, relocating = false } = {}) {
    if (typeof formula !== "string") return { original: formula, value: formula, changed: false, issues: [] };
    const issues = [];
    const candidates = [...items];
    if (bearer && !candidates.some(item => sameDocument(item, bearer))) candidates.push(bearer);
    const value = formula.replace(/@([a-zA-Z0-9_.-]+)/g, (token, reference) => {
        const result = { diff: "margin", achievement: "achievement", card: "card" };
        if (result[reference]) return `@check.${result[reference]}`;
        const ability = reference.match(/^(target\.)?(?:system\.)?(reason|passion|life|mundane)\.(total|totalControl|value)$/);
        if (ability) return `@${ability[1] ?? ""}abilities.${ability[2]}.${({ total: "value", totalControl: "control", value: "base" })[ability[3]]}`;
        const old = reference.match(/^item\.([^.]+)\.system\.(.+)$/);
        if (!old) {
            if (relocating && /^(item|parent)\./.test(reference)) issues.push({ key: token, reason: "移設時の相対参照は参照先の確認が必要" });
            return token;
        }
        let target;
        if (old[1] === "self") target = bearer;
        else if (old[1] === "parent") {
            if (bearer && OUTFIT_TYPES.has(bearer.type) && !relocating) return `@parent.${outfitPath(old[2])}`;
            target = candidates.find(item => (item.id ?? item._id) === bearer?.system?.parentItemId);
        } else {
            const matches = candidates.filter(item => item.system?.identificationKey === old[1]);
            if (matches.length === 1) target = matches[0];
            else {
                issues.push({ key: token, reason: matches.length ? "式の識別キーが重複" : "式の識別キーの参照先が不明" });
                return token;
            }
        }
        if (!target) { issues.push({ key: token, reason: "相対参照の保持元が不明" }); return token; }
        if (SKILLS.has(target.type)) {
            const key = target.system?.identificationKey;
            if (!key) { issues.push({ key: token, reason: "技能の識別キーが未設定" }); return token; }
            const attribute = old[2] === "levelTotal" ? "level" : old[2] === "level" ? "base" : old[2];
            return `@skill.${key}.${attribute}`;
        }
        if (OUTFIT_TYPES.has(target.type)) {
            let prefix = old[1] === "self" ? "item" : `outfit.${old[1]}`;
            if (relocating && ["self", "parent"].includes(old[1])) {
                const key = target.system?.identificationKey;
                if (!key || candidates.filter(item => item.system?.identificationKey === key).length !== 1) {
                    issues.push({ key: token, reason: "移設前の相対参照を一意の識別キーに固定できない" });
                    return token;
                }
                prefix = `outfit.${key}`;
            }
            return `@${prefix}.${outfitPath(old[2])}`;
        }
        issues.push({ key: token, reason: "技能・アウトフィット以外の旧Item参照" });
        return token;
    });
    return { original: formula, value: issues.length ? formula : value, changed: !issues.length && value !== formula, issues };
}

/** 用途と使用回数の式を移行。説明文等、式でない欄には触れない。 */
export function planItemFormulaMigration(source, context = {}) {
    const original = structuredClone(source);
    const data = structuredClone(source);
    const changes = [];
    const issues = [];
    const convert = (owner, key, path) => {
        if (!owner || typeof owner[key] !== "string") return;
        const plan = planFormulaKeyMigration(owner[key], { ...context, bearer: context.bearer ?? source });
        for (const issue of plan.issues) issues.push({ path, ...issue });
        if (plan.changed) { changes.push({ path, before: owner[key], after: plan.value }); owner[key] = plan.value; }
    };
    convert(data.system?.uses, "max", "system.uses.max");
    for (const [i, usage] of (data.system?.actions ?? []).entries()) {
        for (const key of ["checkBonusSelf", "damageBonusSelf", "targetValueOther"]) convert(usage, key, `system.actions.${i}.${key}`);
        for (const key of ["checkBonuses", "damageBonuses"]) {
            for (const [j, row] of (usage[key] ?? []).entries()) convert(row, "formula", `system.actions.${i}.${key}.${j}.formula`);
        }
    }
    return { original, data, changed: changes.length > 0, changes, issues };
}

/** 過去カードの再実行用の式だけを診断し、算出済み結果や本文は保持する。 */
export function planChatFormulaMigration(source, context = {}) {
    const plan = planItemFormulaMigration({ system: { actions: [source] } }, context);
    const localPath = entry => ({ ...entry, path: entry.path.replace(/^system\.actions\.0\./, "") });
    return { original: structuredClone(source), data: plan.data.system.actions[0], changed: plan.changed,
        changes: plan.changes.map(localPath), issues: plan.issues.map(localPath) };
}
