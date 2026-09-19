import { vehicleOutfit, requestVehicleOperation, toggleCrewTarget, selectedCrew, crewTarget, dronePilot } from "../session/vehicle-state.mjs";
import { buildOutfitSummaryRows } from "../ui/outfit-view.mjs";
import { isDrone } from "../rules/vehicle.mjs";
import { isOutfitDestroyed, isOutfitMalfunctioning, isOutfitUnusable } from "../data/item/helpers.mjs";
import { promptVehicleBoarding } from "../session/vehicle-boarding.mjs";
import { SYSTEM_ID } from "../constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** 車両の実体と乗員のシート。性能編集は正本アウトフィットへ遷移する。 */
export class TokyoNovaVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    _isEditMode = false;
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "vehicle"],
        position: { width: 720, height: 740 },
        window: { resizable: true },
        form: { submitOnChange: true },
        actions: {
            toggleEditMode: function () {
                if (!this.isEditable) return;
                this._isEditMode = !this._isEditMode;
                this.render(false);
            },
            boardCrew: async function () { await this._promptBoard(); },
            openOutfit: function () { vehicleOutfit(this.actor)?.sheet.render(true); },
            openCrew: function (_event, target) { fromUuidSync(target.dataset.uuid)?.sheet.render(true); },
            targetCrew: function (_event, target) {
                const member = this.actor.system.crew.find(c => c.actorUuid === target.dataset.uuid);
                if (member) toggleCrewTarget(this.actor, member);
            },
            leaveCrew: async function (_event, target) { await this._changeCrew("leave", target); },
            driveCrew: async function (_event, target) { await this._changeCrew("board", target); },
            combatCrew: async function (_event, target) { await this._changeCrew("combat", target); },
            openPilot: function () {
                const driver = this.actor.system.crew.find(c => c.role === "driver");
                if (driver) return fromUuidSync(driver.actorUuid)?.sheet.render(true);
                const pilot = dronePilot(this.actor);
                if (pilot) return pilot.sheet.render(true);
                ui.notifications.info("操縦者がいません。");
            },
            endDrone: async function () {
                const pilot = dronePilot(this.actor);
                if (!pilot) return;
                await requestVehicleOperation("endDrone", { actorUuid: pilot.uuid });
                this.render(false);
            },
        },
    };
    static PARTS = { main: { template: "systems/tokyo-nova-axleration/templates/actor/vehicle-sheet.hbs", scrollable: [""] } };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const item = vehicleOutfit(this.actor);
        const crew = this.actor.system.crew.filter(c => fromUuidSync(c.actorUuid)?.getFlag(SYSTEM_ID, "appearing") === true);
        const driver = crew.find(c => c.role === "driver");
        const pilot = dronePilot(this.actor);
        const pilotActor = driver ? fromUuidSync(driver.actorUuid) : pilot;
        return { ...context, actor: this.actor, system: this.actor.system, editable: this.isEditable,
            isEditMode: this.isEditable && this._isEditMode,
            canBoard: this.isEditable && !!item && !isOutfitUnusable(item.system) && item.system.passenger?.mode === "value" && item.system.passenger?.value > 0,
            outfit: item, missing: !item, drone: isDrone(item),
            statusLabel: !item ? "未連携" : isOutfitDestroyed(item.system) ? "破壊" : isOutfitMalfunctioning(item.system) ? "故障" : item.system.isPrepared ? "準備中" : "未準備",
            statusWarning: !item || isOutfitDestroyed(item.system) || isOutfitMalfunctioning(item.system),
            crewCount: crew.length,
            pilotActor: pilotActor,
            summary: item ? buildOutfitSummaryRows(item.system, item.type) : [],
            crew: crew.map(c => {
                const actor = fromUuidSync(c.actorUuid);
                const hidden = !game.user.isGM && actor?.getFlag(SYSTEM_ID, "appearingHidden");
                return { ...c, name: hidden ? "？？？" : actor?.name ?? "参照切れ",
                    img: hidden ? "icons/svg/mystery-man.svg" : actor?.img ?? "icons/svg/mystery-man.svg",
                    available: !!actor,
                    canTarget: !!actor && !!crewTarget(this.actor, c),
                    roleLabel: c.operationMode === "remote" ? "遠隔操縦者" : c.role === "driver" ? "操縦者" : "同乗者",
                    canEdit: this.isEditable && !!actor?.isOwner,
                    canAct: !!actor?.isOwner,
                    canDrive: this.isEditable && !!actor?.isOwner && actor.uuid === item?.actor?.uuid && c.role !== "driver",
                    selected: selectedCrew.has(`${this.actor.uuid}:${c.actorUuid}`),
                };
            }),
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this.element.classList.toggle("edit-mode", context.isEditMode);
        this.element.classList.toggle("view-mode", !context.isEditMode);
        const header = this.element.querySelector(".window-header");
        header?.querySelector(".edit-mode-toggle")?.remove();
        if (header && this.isEditable) {
            const toggle = document.createElement("a");
            toggle.className = "edit-mode-toggle";
            toggle.dataset.action = "toggleEditMode";
            toggle.title = "編集モード切替";
            toggle.setAttribute("aria-label", context.isEditMode ? "閲覧モードへ" : "編集モードへ");
            toggle.setAttribute("aria-pressed", String(context.isEditMode));
            toggle.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
            header.prepend(toggle);
        }
        this._dropController?.abort();
        this._dropController = new AbortController();
        // アイコン操作もマウスに限定せず、キーボードから実行できるようにする。
        for (const control of this.element.querySelectorAll("a[data-action], img[data-action]")) {
            control.tabIndex = 0;
            control.setAttribute("role", "button");
            control.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                control.click();
            }, { signal: this._dropController.signal });
        }
        this.element.addEventListener("dragover", event => event.preventDefault(), { signal: this._dropController.signal });
        this.element.addEventListener("drop", event => this._drop(event), { signal: this._dropController.signal });
    }
    async _drop(event) {
        event.preventDefault();
        if (!this.isEditable) return;
        try {
            const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
            const doc = data.uuid ? await fromUuid(data.uuid) : null;
            if (doc?.documentName === "Item") {
                if (!this._isEditMode) return ui.notifications.info("本体の紐づけを変更するには編集モードに切り替えてください。");
                await requestVehicleOperation("link", { vehicleUuid: this.actor.uuid, itemUuid: doc.uuid });
            } else {
                const actor = doc?.documentName === "Token" ? doc.actor : doc;
                if (actor?.documentName !== "Actor") return;
                await this._promptBoard(actor);
            }
            this.render(false);
        } catch (error) { ui.notifications.warn(error.message); }
    }
    /** 一覧への追加は搭乗そのもの。所属だけの登録は作らない。 */
    async _promptBoard(droppedActor = null) {
        if (!this.isEditable) return;
        await promptVehicleBoarding(this.actor, droppedActor);
    }
    async _changeCrew(action, target) {
        try {
            await requestVehicleOperation(action, { vehicleUuid: this.actor.uuid, actorUuid: target.dataset.uuid, role: "driver" });
            this.render(false);
        } catch (error) { ui.notifications.warn(error.message); }
    }
}
