/**
 * @fileoverview サブシーンパネル(フェーズ14-4)。
 *
 * シーンコントロールバーの RL 専用ボタンから開く、サブシーン(subscenes.mjs・ワールド独立の
 * 名前付き盤面状態)の保存・切替の道具。シナリオコントロールパネルとは別(手動操作の道具で
 * あり「手動設定なし」原則の外側・2026-08-08 ユーザー確定)。
 *
 * 並び替え＝グリップ DnD(FS判定エディタと同パターン・行全体は draggable にしない)＋上下ボタン。
 * 順序はワールド設定の配列順で永続化。
 */

import {
    listSubScenes, isCurrentSubScene, createSubScene, updateSubScene,
    deleteSubScene, moveSubSceneBy, moveSubSceneTo, applySubScene, clearSubSceneOverride,
} from "../module/subscenes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class TnxSubScenePanel extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-subscene-panel",
        classes: ["tokyo-nova", "tnx-subscene-panel-app"],
        window: { title: "サブシーン", resizable: true },
        position: { width: 380, height: "auto" },
        actions: {
            addFromCurrent: TnxSubScenePanel._onAddFromCurrent,
            applySubScene:  TnxSubScenePanel._onApplySubScene,
            clearOverride:  TnxSubScenePanel._onClearOverride,
            pickBackground: TnxSubScenePanel._onPickBackground,
            deleteSubScene: TnxSubScenePanel._onDeleteSubScene,
            moveUp:         TnxSubScenePanel._onMoveUp,
            moveDown:       TnxSubScenePanel._onMoveDown,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/subscene-panel.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.subScenes = listSubScenes().map(sub => ({
            ...sub,
            isCurrent: isCurrentSubScene(sub),
        }));
        return context;
    }

    _onRender(_context, _options) {
        // 名前のインライン編集(変更で保存)
        for (const input of this.element.querySelectorAll('.ssp-row input[name="name"]')) {
            input.addEventListener("change", (event) => {
                const id = event.currentTarget.closest(".ssp-row")?.dataset.id;
                if (id) updateSubScene(id, { name: event.currentTarget.value });
            });
        }
        // 並び替え＝専用グリップのみ draggable(行全体にすると名前入力の選択を奪う・FS エディタ踏襲)
        for (const row of this.element.querySelectorAll(".ssp-row")) {
            const grip = row.querySelector(".ssp-grip");
            grip?.addEventListener("dragstart", (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", row.dataset.id ?? "");
                row.classList.add("dragging");
            });
            grip?.addEventListener("dragend", () => row.classList.remove("dragging"));
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            });
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData("text/plain");
                const toIndex = Number(row.dataset.index);
                if (!draggedId || draggedId === row.dataset.id || !Number.isInteger(toIndex)) return;
                moveSubSceneTo(draggedId, toIndex);
            });
        }
    }

    static async _onAddFromCurrent(_event, _target) {
        await createSubScene();
    }

    static async _onApplySubScene(_event, target) {
        await applySubScene(target.dataset.id);
        this.render(false);
    }

    static async _onClearOverride(_event, _target) {
        await clearSubSceneOverride();
        this.render(false);
    }

    static async _onPickBackground(_event, target) {
        const id = target.dataset.id;
        const sub = listSubScenes().find(s => s.id === id);
        if (!sub) return;
        const picker = new (foundry.applications.apps.FilePicker.implementation)({
            type: "image",
            current: sub.background || "",
            callback: (path) => updateSubScene(id, { background: path }),
        });
        picker.render(true);
    }

    static async _onDeleteSubScene(_event, target) {
        const confirmed = await DialogV2.confirm({
            window: { title: "サブシーンの削除" },
            content: "<p>このサブシーンを削除しますか？</p>",
        });
        if (!confirmed) return;
        await deleteSubScene(target.dataset.id);
    }

    static async _onMoveUp(_event, target) {
        await moveSubSceneBy(target.dataset.id, -1);
    }

    static async _onMoveDown(_event, target) {
        await moveSubSceneBy(target.dataset.id, 1);
    }
}

/** パネルを開く(開いていれば前面へ)。シーンコントロールバーの RL ボタンから呼ぶ。 */
export function openSubScenePanel() {
    const existing = foundry.applications.instances.get("tnx-subscene-panel");
    if (existing) return existing.render({ force: true });
    return new TnxSubScenePanel().render(true);
}
