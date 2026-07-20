/**
 * @fileoverview FS判定エディタの配線(2026-07-21)。
 *
 * FS判定シートと起動フォームで同じ挙動にするため、DOM の配線もここ1箇所に置く。
 * 構造が変わる操作(行や技能の増減・並び替え・参照元の変更)は、現在のフォーム内容に
 * 変更を適用した設定を `onChange` へ渡す——描画のし直しは呼び出し側が行う
 * (シートは flags へ保存して再描画、起動フォームは手元の状態を差し替えて再描画)。
 */

import { readFocusSystemForm } from "./focus-system-form.mjs";
import { newProgressRow } from "./focus-system-data.mjs";

/** 敗北条件の種別に応じて、カット数／自由文のどちらを出すか。 */
function syncDefeat(root) {
    const isCut = (root.querySelector('[name="defeatType"]')?.value ?? "cut") === "cut";
    root.querySelector(".fs-defeat-cut")?.toggleAttribute("hidden", !isCut);
    root.querySelector(".fs-defeat-other")?.toggleAttribute("hidden", isCut);
}

/** 進行修正の参照元に応じて、パラメータ／式を出すか。 */
function syncModDetail(row) {
    const source = row.querySelector('[name="modSource"]')?.value ?? "none";
    row.querySelector(".fs-mod-detail")?.toggleAttribute("hidden", source === "none");
}

/**
 * エディタを配線する。
 * @param {HTMLElement} root エディタのルート(.fs-editor)
 * @param {{onChange: function(object): any}} opts 構造が変わったときに呼ばれる
 */
export function bindFocusSystemEditor(root, { onChange }) {
    if (!root) return;

    const emit = (mutate) => {
        const data = readFocusSystemForm(root);
        mutate?.(data);
        onChange?.(data);
    };

    // 数値の ±(この部品専用のアクション名にして、ホスト側の ± と衝突させない)
    for (const btn of root.querySelectorAll('[data-action="fsSpinUp"], [data-action="fsSpinDown"]')) {
        btn.addEventListener("click", () => {
            const input = btn.closest(".number-input-spinner")?.querySelector('input[type="number"]');
            if (!input) return;
            if (btn.dataset.action === "fsSpinUp") input.stepUp();
            else input.stepDown();
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    root.querySelector('[name="defeatType"]')?.addEventListener("change", () => syncDefeat(root));
    syncDefeat(root);

    // 参照元を変えるとパラメータの候補が変わるため、描画をやり直す
    for (const sel of root.querySelectorAll(".fs-mod-source")) {
        sel.addEventListener("change", () => {
            syncModDetail(sel.closest(".fs-row"));
            emit();
        });
    }

    // 支援判定の技能: 追加プルダウン／行の削除
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

    // 判定行: 追加／削除／並び替え
    root.querySelector('[data-action="fsRowAdd"]')?.addEventListener("click", () => {
        emit((data) => data.rows.push(newProgressRow()));
    });
    for (const row of root.querySelectorAll(".fs-row")) {
        const index = Number(row.dataset.index);
        row.querySelector('[data-action="fsRowDelete"]')?.addEventListener("click", () => {
            emit((data) => data.rows.splice(index, 1));
        });

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
}
