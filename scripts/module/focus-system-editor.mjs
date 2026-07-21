/**
 * @fileoverview FS判定エディタの配線(2026-07-21)。
 *
 * FS判定シートと起動フォームで同じ挙動にするため、DOM の配線もここ1箇所に置く。
 * すべての変更(値・構造)を1つの経路にまとめ、変更のたびに現在のフォーム内容へ
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
        if (event.target.classList.contains("fs-skill-add")) return;
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
