/**
 * @fileoverview FS判定エディタのフォーム(2026-07-21)。
 *
 * **FS判定シートと起動フォームで同じ部品を使う**ための、文脈組み立てと読み出し。
 * 別々に作ったせいで「シートには判定行があるのに起動フォームには無い」という乖離が
 * 生まれたので、両者を1つのテンプレート(`parts/focus-system-editor.hbs`)と
 * この読み書きに寄せる。
 */

import { loadGroupedGeneralSkillChoices, loadSkillEntries, SKILL_PACKS } from "./skill-dictionary.mjs";
import { formatSkillName } from "./identification.mjs";
import { PROGRESS_MOD_SOURCES, buildProgressModChoices } from "./progress-mod.mjs";
import { defeatConditionOptions } from "./focus-system-logic.mjs";
import { defaultFocusSystemData, newProgressRow } from "./focus-system-data.mjs";

/** 選択済みの項目に selected を立てる(テンプレートに分岐を書かないため)。 */
function markSelected(groups, selectedKey, itemsKey, valueKey) {
    return (groups ?? []).map(g => ({
        ...g,
        [itemsKey]: (g[itemsKey] ?? []).map(o => ({ ...o, selected: o[valueKey] === selectedKey })),
    }));
}

/**
 * 技能の複数選択(チップの一覧＋追加候補)。支援判定と各判定行で同じ作法を使う
 * (既存の「無視する指定技能」と同型)。追加候補からは選択済みを除く。
 */
function skillChipList(skillGroups, nameOf, chosen) {
    const keys = chosen ?? [];
    return {
        rows: keys.map(key => ({ key, name: nameOf(key) })),
        choices: (skillGroups ?? []).map(g => ({
            ...g,
            skills: (g.skills ?? []).filter(o => !keys.includes(o.identificationKey)),
        })).filter(g => g.skills.length),
    };
}

/**
 * エディタの描画文脈を組み立てる。
 * @param {object} data FS判定の設定(`readFocusSystemData` の戻り)
 * @param {{editable?:boolean}} [opts]
 */
export async function buildFocusSystemEditorContext(data, { editable = true } = {}) {
    const fs = data ?? defaultFocusSystemData();
    const skillGroups = await loadGroupedGeneralSkillChoices();
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    const nameOf = (key) => {
        const hit = entries.find(s => s.identificationKey === key);
        return hit?.name ? formatSkillName(hit.name) : key;
    };

    const support = skillChipList(skillGroups, nameOf, fs.supportSkillKeys);
    return {
        editable,
        fs,
        isDefeatCut:  (fs.defeatCondition?.type ?? "cut") === "cut",
        defeatTypes:  defeatConditionOptions(fs.defeatCondition?.type ?? "cut"),
        sourceOptions: PROGRESS_MOD_SOURCES,
        // 支援判定の指定技能は複数(既存の「無視する指定技能」と同じ作法)
        supportRows:    support.rows,
        supportChoices: support.choices,
        rows: (fs.rows ?? []).map((r, index) => {
            const source = r.progressMod?.source ?? "none";
            // 進行判定の技能も複数(2026-07-21)
            const skills = skillChipList(skillGroups, nameOf, r.skillKeys);
            return {
                ...r,
                index,
                skillRows:    skills.rows,
                skillChoices: skills.choices,
                hasParam:    source !== "none",
                paramGroups: markSelected(buildProgressModChoices(source), r.progressMod?.param, "params", "value"),
                sources:     PROGRESS_MOD_SOURCES.map(o => ({ ...o, selected: o.value === source })),
                // 参照元＝なし は固定値(式欄に数値を入れる)、参照元があれば @param を使う式
                formulaPlaceholder: source === "none" ? "固定値（例: 3）" : "@param",
            };
        }),
    };
}

/** 要素の値(無ければ既定)。 */
function val(root, name, fallback = "") {
    return root?.querySelector(`[name="${name}"]`)?.value ?? fallback;
}

/**
 * エディタの入力内容を FS判定の設定として読み出す。
 *
 * 支援判定の指定技能はプルダウンではなく**行のリスト**なので、DOM から集める。
 *
 * @param {HTMLElement} root エディタのルート(.fs-editor)
 * @returns {object} FS判定の設定
 */
export function readFocusSystemForm(root) {
    const rows = [...(root?.querySelectorAll(".fs-row") ?? [])].map(el => ({
        id:          el.dataset.rowId || newProgressRow().id,
        threshold:   Number(el.querySelector('[name="threshold"]')?.value) || 0,
        // 技能はチップの並び(複数)。プルダウンではなく行から集める
        skillKeys:   [...el.querySelectorAll(".fs-skill-chip")].map(c => c.dataset.key).filter(Boolean),
        targetValue: Number(el.querySelector('[name="targetValue"]')?.value) || 0,
        progressMod: {
            source:  el.querySelector('[name="modSource"]')?.value ?? "none",
            param:   el.querySelector('[name="modParam"]')?.value ?? "",
            formula: el.querySelector('[name="modFormula"]')?.value ?? "",
        },
        note:        el.querySelector('[name="note"]')?.value ?? "",
    }));

    const supportSkillKeys = [...(root?.querySelectorAll(".fs-support-row") ?? [])]
        .map(el => el.dataset.key).filter(Boolean);

    return {
        restriction: val(root, "restriction").trim(),
        defeatCondition: {
            type:     val(root, "defeatType", "cut"),
            text:     val(root, "defeatText").trim(),
            cutLimit: Number(val(root, "cutLimit", 0)) || 0,
        },
        defeatEffect:   val(root, "defeatEffect").trim(),
        targetProgress: Number(val(root, "targetProgress", 0)) || 0,
        supportSkillKeys,
        rows,
        memo: val(root, "memo"),
    };
}
