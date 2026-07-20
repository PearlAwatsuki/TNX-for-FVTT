/**
 * @fileoverview 対象選択リスト(2026-07-21 ユーザー指示)。
 *
 * 判定要求・報酬点の配布・RL 任意ダメージ付与・RL 任意の状態/効果付与の4つで**同じ形式**の
 * 対象選択を使う。テンプレート `parts/target-picker.hbs` を差し込み、`bindTargetPicker` で
 * 配線する(ダイアログごとに実装を書かない=横断機構は1つの部品に集約する)。
 *
 * 収集の4通り:
 * - 選択したアクター  … 盤面で選択中(コントロール中)のトークン
 * - ターゲットしたアクター … レティクルを付けた対象
 * - キャストをすべて  … ワールドのキャスト
 * - プレイヤーキャラクターをすべて … **ユーザー設定で割り当てられたアクター**(2026-07-21 確認)
 */

import { addTargets, removeTarget, moveTarget } from "./target-picker-logic.mjs";
import { currentTargetActors } from "./target-resolution.mjs";

/** 盤面で選択中のトークンのアクター。 */
export function collectSelectedActors() {
    return (canvas?.tokens?.controlled ?? []).map(t => t?.actor).filter(Boolean);
}

/** レティクルを付けた対象のアクター。 */
export function collectTargetedActors() {
    return currentTargetActors();
}

/** ワールドのキャスト。 */
export function collectAllCasts() {
    return game.actors.filter(a => a.type === "cast");
}

/** プレイヤーキャラクター＝ユーザー設定で割り当てられたアクター(GM を除く)。 */
export function collectPlayerCharacters() {
    const out = [];
    const seen = new Set();
    for (const user of game.users) {
        if (user.isGM) continue;
        const actor = user.character;
        if (!actor || seen.has(actor.uuid)) continue;
        seen.add(actor.uuid);
        out.push(actor);
    }
    return out;
}

const COLLECTORS = Object.freeze({
    selected: collectSelectedActors,
    targeted: collectTargetedActors,
    casts:    collectAllCasts,
    pcs:      collectPlayerCharacters,
});

const EMPTY_NOTICE = Object.freeze({
    selected: "選択中のトークンがありません。",
    targeted: "ターゲット中の対象がありません。",
    casts:    "キャストのアクターがいません。",
    pcs:      "プレイヤーキャラクターが設定されていません。",
});

/**
 * 対象リストの行を描画する(状態→DOM の一方向)。
 * @param {HTMLElement} root ピッカーのルート(.tnx-target-picker)
 * @param {Array<{uuid:string,name:string,img:string}>} targets
 */
function renderRows(root, targets) {
    const list = root.querySelector(".tnx-tp-list");
    if (!list) return;
    const esc = foundry.utils.escapeHTML;
    if (!targets.length) {
        list.innerHTML = '<p class="tnx-tp-empty">対象がありません</p>';
        return;
    }
    list.innerHTML = targets.map((t, i) => `
        <div class="tnx-tp-row" data-index="${i}" data-uuid="${esc(t.uuid)}">
            <i class="fas fa-grip-vertical tnx-tp-grip" draggable="true" title="ドラッグで並び替え"></i>
            <img class="tnx-tp-img" src="${esc(t.img ?? "")}" alt="">
            <span class="tnx-tp-name">${esc(t.name ?? "")}</span>
            <a class="tnx-tp-remove" title="この対象を外す"><i class="fas fa-trash"></i></a>
        </div>`).join("");
}

/**
 * 対象選択リストを配線する。状態はクロージャで保持し、`getTargets()` で取り出す。
 *
 * @param {HTMLElement} root ピッカーのルート要素(.tnx-target-picker)
 * @param {{initial?:Array, onChange?:Function}} [opts]
 * @returns {{getTargets: function(): Array}}
 */
export function bindTargetPicker(root, { initial = [], onChange = null } = {}) {
    let targets = addTargets([], initial);

    const refresh = () => {
        renderRows(root, targets);
        wireRows();
        onChange?.(targets);
    };

    // 行の操作(除去・グリップの並び替え)。再描画のたびに張り直す
    const wireRows = () => {
        for (const row of root.querySelectorAll(".tnx-tp-row")) {
            row.querySelector(".tnx-tp-remove")?.addEventListener("click", () => {
                targets = removeTarget(targets, row.dataset.uuid);
                refresh();
            });
            // 専用グリップのみ draggable(行全体にすると名前の選択を奪う=部位プリセットと同方式)
            const grip = row.querySelector(".tnx-tp-grip");
            grip?.addEventListener("dragstart", (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.dataset.index ?? "");
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
                const to   = Number(row.dataset.index);
                targets = moveTarget(targets, from, to);
                refresh();
            });
        }
    };

    root.querySelector('[data-action="clearAll"]')?.addEventListener("click", () => {
        if (!targets.length) return;
        targets = [];
        refresh();
    });

    for (const btn of root.querySelectorAll("[data-collect]")) {
        btn.addEventListener("click", () => {
            const kind = btn.dataset.collect;
            const found = COLLECTORS[kind]?.() ?? [];
            if (!found.length) {
                ui.notifications.info(EMPTY_NOTICE[kind] ?? "追加できる対象がありません。");
                return;
            }
            const before = targets.length;
            targets = addTargets(targets, found);
            if (targets.length === before) ui.notifications.info("すべて追加済みです。");
            refresh();
        });
    }

    refresh();
    return { getTargets: () => targets };
}
