import { getComboSuits } from "./tnx-check-engine.mjs";
import { hasReactionQualification, reactionQualifications } from "./action-qualifications.mjs";
import { resolveUsageSkills, alternativeComboNames } from "./skill-chain-resolution.mjs";
import { asteriskSkillKeys, confrontationSkillRows, confrontationReactionTypes, confrontationHasCannot } from "./confrontation.mjs";

const levelOk = item => Number(item.system.levelTotal ?? item.system.level) >= 1;
const normalize = item => ({ ...item.system, id: item.id, identificationKey: item.system.identificationKey || item.id });
const matchesKey = (item, key) => item.system.identificationKey === key
    || (item.system.isSubstitute && (item.system.substituteTarget ?? []).includes(key));

/** 操縦時の対決置換は不可マスクを残す。行動条件と用途固有のヴィークル条件は別。 */
export function reactionConfrontation(rows, operateSkillKey = "") {
    return operateSkillKey ? [...(confrontationHasCannot(rows) ? [{ value: "cannot", name: "" }] : []),
        { value: "skillNameAsterisk", name: operateSkillKey }] : rows;
}

/** 実際の参加技能だけを使う最終検証。候補の探索も必ずこの関数で検算する。 */
export function resolveReactionQualification({ base, participants = [], usage, mode, rows = [], hasVehicle = false }) {
    const fail = reason => ({ ok: false, reason });
    if (!base?.system.isAction) return fail("リアクションのベースにはアクション技能が必要です。");
    const skills = [...new Map([base, ...participants].map(s => [s.id, s])).values()];
    if (skills.some(s => !levelOk(s))) return fail("参加技能はレベル1以上である必要があります。");
    if (mode !== "other" && usage?.type !== "reaction") return fail("リアクション用途を選択してください。");
    if (confrontationHasCannot(rows) && !usage?.ignoresUnopposable) return fail("この判定は対決不可です。");
    const pool = skills.map(normalize);
    for (const skill of skills) {
        const root = normalize(skill);
        // 用途の指定技能無視は組み合わせ側だけに適用する。
        if (skill.id !== base.id && usage?.ignoreComboSkills?.length)
            root.comboSkill = (root.comboSkill ?? []).filter(row => !usage.ignoreComboSkills.includes(row.name));
        const chain = resolveUsageSkills(root, pool);
        if (chain.defect) return fail(`必要な組み合わせ技能「${chain.defect}」が不足しています。`);
        if (chain.alternativeItemIds.length && !chain.alternativeItemIds.some(id => skills.some(s => s.id === id)))
            return fail("指定された選択組み合わせ技能が必要です。");
        // 候補が一つも所持されていない選択指定も見落とさない。
        const choices = alternativeComboNames(root.comboSkill);
        if (choices.length && !choices.some(key => skills.some(s => matchesKey(s, key))))
            return fail("指定された選択組み合わせ技能が必要です。");
    }
    if (skills.length > 1 && skills.some(s => s.system.noCombo)) return fail("組み合わせ不可の技能が含まれています。");
    if (!Number.isFinite(usage?.fixedResult) && !getComboSuits(skills.map(s => s.system)).length)
        return fail("参加技能に共通スートがありません。");
    if (mode === "other") return { ok: true, reason: null };
    const required = asteriskSkillKeys(rows);
    if (required.some(key => !skills.some(s => matchesKey(s, key)))) return fail("対決欄の必須技能が不足しています。");
    if (!required.length && !["reaction", "open"].includes(mode) && rows.length
        && !confrontationReactionTypes(rows).includes(mode))
        return fail("対決欄で許可されていないリアクション手段です。");
    const named = (mode === "reaction" || mode === "open")
        && confrontationSkillRows(rows).some(r => !r.asterisk && skills.some(s => matchesKey(s, r.key)));
    const methods = mode === "open" ? confrontationReactionTypes(rows)
        : mode === "reaction" ? confrontationReactionTypes(rows).filter(t => !["dodge", "parry"].includes(t)) : [mode];
    // ※は従来どおり指定技能による入口。統合ボタンの無印技能も独立の対決条件。
    const qualifiedMethods = methods.filter(method => hasReactionQualification(base.system, method)
        || skills.some(s => s.type === "styleSkill" && !s.system.isAction && reactionQualifications(s.system).includes(method)));
    const qualified = required.length > 0 || named || qualifiedMethods.length > 0
        || hasReactionQualification(base.system, "reaction");
    if (!qualified) return fail("選択したリアクション手段に対応する技能の組み合わせが必要です。");
    // 統合入口では実行可能な手段が移動妨害だけの場合に適用する。
    const availableMethods = required.length || named ? methods : qualifiedMethods;
    if ((mode === "moveBlockReaction" || (availableMethods.length === 1 && availableMethods[0] === "moveBlockReaction")) && !hasVehicle)
        return fail("移動妨害へのリアクションには準備済みのヴィークルが必要です。");
    return { ok: true, reason: null };
}

/** 所持技能から合法な構成が存在するかを探索する。保存用途への補完・書込みは行わない。 */
export function findReactionCombination({ base, skills, usage, mode, rows = [], hasVehicle = false }) {
    const owned = skills.filter(levelOk);
    const pool = owned.map(normalize);
    const initial = [base.id, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean);
    const required = mode === "other" ? [] : asteriskSkillKeys(rows);
    const named = ["reaction", "open"].includes(mode) ? confrontationSkillRows(rows).map(r => r.key) : [];
    const providers = owned.filter(s => (s.type === "styleSkill" && !s.system.isAction && reactionQualifications(s.system).length)
        || named.some(key => matchesKey(s, key)));
    const queue = [initial, ...providers.map(s => [...initial, s.id])];
    const seen = new Set();
    while (queue.length) {
        const ids = new Set(queue.shift());
        let missingChoices = null;
        let invalid = false;
        for (const key of required) {
            if (![...ids].some(id => matchesKey(owned.find(s => s.id === id) ?? { system: {} }, key))) {
                missingChoices = owned.filter(s => matchesKey(s, key)).map(s => s.id);
                break;
            }
        }
        if (!missingChoices) for (const id of ids) {
            const skill = pool.find(s => s.id === id);
            if (!skill) { invalid = true; break; }
            const root = { ...skill };
            if (id !== base.id && usage.ignoreComboSkills?.length)
                root.comboSkill = (root.comboSkill ?? []).filter(r => !usage.ignoreComboSkills.includes(r.name));
            const chain = resolveUsageSkills(root, pool);
            if (chain.defect) { invalid = true; break; }
            for (const member of chain.mandatoryItemIds) ids.add(member);
            if (chain.alternativeItemIds.length && !chain.alternativeItemIds.some(i => ids.has(i))) {
                missingChoices = chain.alternativeItemIds; break;
            }
        }
        const key = [...ids].sort().join("|");
        if (invalid || seen.has(key)) continue;
        seen.add(key);
        if (missingChoices) { for (const id of missingChoices) queue.push([...ids, id]); continue; }
        const participants = [...ids].map(id => owned.find(s => s.id === id)).filter(Boolean);
        const result = resolveReactionQualification({ base, participants, usage, mode, rows, hasVehicle });
        if (result.ok) return participants.map(s => s.id);
    }
    return null;
}
