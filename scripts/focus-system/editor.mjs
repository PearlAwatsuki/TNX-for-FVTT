/**
 * @fileoverview FS判定エディタ(2026-07-21 → 2026-09-07 統合)。
 *
 * 判定シートの編集 UI を担う。**表示用コンテキストの組み立て(buildFocusSystemEditorContext)**、
 * **フォームからの読み取り(readFocusSystemForm)**、**DOM の配線(bindFocusSystemEditor)**の 3 つは
 * 同じ UI の三面で、利用者(FS判定シート・FS開始アプリ)はどちらも 3 つを揃えて使うため 1 ファイルに
 * まとめた(従来は form / editor に分かれていた)。
 */

import { loadGroupedGeneralSkillChoices, loadSkillEntries, SKILL_PACKS } from "../dictionary/skill-dictionary.mjs";
import { formatSkillName } from "../core/identification.mjs";
import { PROGRESS_MOD_SOURCES, buildProgressModChoices } from "./progress-mod.mjs";
import { defeatConditionOptions } from "../rules/focus-system.mjs";
import { defaultFocusSystemData, newProgressRow } from "./data.mjs";

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
        skillKeys:   [...el.querySelectorAll(".tnx-tag")].map(c => c.dataset.key).filter(Boolean),
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

/** 敗北条件の種別に応じて、カット数／自由文のどちらを出すか。 */
function syncDefeat(root) {
    const isCut = (root.querySelector('[name="defeatType"]')?.value ?? "cut") === "cut";
    root.querySelector(".fs-defeat-cut")?.toggleAttribute("hidden", !isCut);
    root.querySelector(".fs-defeat-other")?.toggleAttribute("hidden", isCut);
}

/**
 * エディタを配線する。
 * @param {HTMLElement} root エディタのルート(.fs-editor)
 * @param {{onChange: function(object): any}} opts 変更があるたびに呼ばれる
 */
export function bindFocusSystemEditor(root, { onChange }) {
    if (!root) return;

    const emit = (mutate) => {
        const data = readFocusSystemForm(root);
        mutate?.(data);
        onChange?.(data);
    };

    // 数値の ±(この部品専用のアクション名にして、ホスト側の ± と衝突させない)。
    // change を発火させ、下の一括ハンドラで保存・再描画する
    for (const btn of root.querySelectorAll('[data-action="fsSpinUp"], [data-action="fsSpinDown"]')) {
        btn.addEventListener("click", () => {
            const input = btn.closest(".number-input-spinner")?.querySelector('input[type="number"]');
            if (!input) return;
            if (btn.dataset.action === "fsSpinUp") input.stepUp();
            else input.stepDown();
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    // 値の変更(テキスト・数値・プルダウン)は一括で拾う。技能の追加プルダウンだけは
    // 値でなく操作なので除く(専用ハンドラで処理する)
    root.addEventListener("change", (event) => {
        if (event.target.classList.contains("tnx-tag-add")) return;
        emit();
    });

    // 支援判定の技能: 追加プルダウン／チップの削除
    root.querySelector(".fs-support-add")?.addEventListener("change", (event) => {
        const key = event.target.value;
        event.target.value = "";
        if (!key) return;
        emit((data) => {
            if (!data.supportSkillKeys.includes(key)) data.supportSkillKeys.push(key);
        });
    });
    for (const btn of root.querySelectorAll('[data-action="fsSupportDelete"]')) {
        btn.addEventListener("click", () => {
            emit((data) => {
                data.supportSkillKeys = data.supportSkillKeys.filter(k => k !== btn.dataset.key);
            });
        });
    }

    // イベント・進行判定: 追加／削除／並び替え／行ごとの指定技能
    root.querySelector('[data-action="fsRowAdd"]')?.addEventListener("click", () => {
        emit((data) => data.rows.push(newProgressRow()));
    });
    for (const row of root.querySelectorAll(".fs-row")) {
        const index = Number(row.dataset.index);
        row.querySelector('[data-action="fsRowDelete"]')?.addEventListener("click", () => {
            emit((data) => data.rows.splice(index, 1));
        });

        // 行ごとの指定技能(複数): 追加プルダウン／チップの削除
        row.querySelector(".fs-row-skill-add")?.addEventListener("change", (event) => {
            const key = event.target.value;
            event.target.value = "";
            if (!key) return;
            emit((data) => {
                const r = data.rows[index];
                if (r && !r.skillKeys.includes(key)) r.skillKeys.push(key);
            });
        });
        for (const btn of row.querySelectorAll('[data-action="fsRowSkillDelete"]')) {
            btn.addEventListener("click", () => {
                emit((data) => {
                    const r = data.rows[index];
                    if (r) r.skillKeys = r.skillKeys.filter(k => k !== btn.dataset.key);
                });
            });
        }

        // 並び替えは専用グリップのみ(行全体を draggable にすると入力の選択を奪う)
        const grip = row.querySelector(".fs-row-grip");
        grip?.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            row.classList.add("dragging");
        });
        grip?.addEventListener("dragend", () => row.classList.remove("dragging"));
        row.addEventListener("dragover", (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer.getData("text/plain"));
            if (!Number.isInteger(from) || from === index) return;
            emit((data) => {
                const [moved] = data.rows.splice(from, 1);
                if (moved) data.rows.splice(index, 0, moved);
            });
        });
    }

    syncDefeat(root);
}
