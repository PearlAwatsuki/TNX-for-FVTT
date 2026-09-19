import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("../../scripts/ui/outfit-view.mjs", () => ({ buildOutfitSummaryRows: () => [] }));
vi.mock("../../scripts/ui/tnx-dialog.mjs", () => ({ TargetSelectionDialog: { prompt: vi.fn() } }));
vi.mock("../../scripts/session/vehicle-state.mjs", () => ({
    vehicleOutfit: vi.fn(), requestVehicleOperation: vi.fn(), toggleCrewTarget: vi.fn(),
    selectedCrew: new Map(), crewTarget: () => null, crewVehicle: () => null,
    dronePilot: () => null,
}));
foundry.applications.api.HandlebarsApplicationMixin = base => base;
foundry.applications.sheets = { ActorSheetV2: class {
    async _prepareContext() { return {}; }
    _onRender() {}
    render() {}
} };
const { TokyoNovaVehicleSheet } = await import("../../scripts/actor/tnx-vehicle-sheet.mjs");
const { vehicleOutfit, requestVehicleOperation } = await import("../../scripts/session/vehicle-state.mjs");
const { TargetSelectionDialog } = await import("../../scripts/ui/tnx-dialog.mjs");

describe("車両シートの編集と搭乗操作", () => {
    let sheet, actor, item;
    beforeEach(() => {
        vi.clearAllMocks();
        actor = { uuid: "Actor.driver", type: "cast", name: "操縦者", isOwner: true, system: {}, getFlag: (_scope, key) => key === "appearing" };
        item = { id: "car", type: "vehicle", actor, system: { isPrepared: true } };
        actor.items = [];
        vehicleOutfit.mockReturnValue(item);
        vi.stubGlobal("game", { actors: [actor], user: { isGM: true } });
        vi.stubGlobal("ui", { notifications: { warn: vi.fn(), info: vi.fn() } });
        sheet = new TokyoNovaVehicleSheet();
        sheet.actor = { uuid: "Actor.car", isOwner: true, system: { crew: [] } };
        sheet.isEditable = true;
    });
    afterEach(() => vi.unstubAllGlobals());
    it("初期状態は閲覧で、所有権があるときだけ編集へ切り替える", async () => {
        expect((await sheet._prepareContext({})).isEditMode).toBe(false);
        TokyoNovaVehicleSheet.DEFAULT_OPTIONS.actions.toggleEditMode.call(sheet);
        expect((await sheet._prepareContext({})).isEditMode).toBe(true);
        sheet.isEditable = false;
        expect((await sheet._prepareContext({})).isEditMode).toBe(false);
    });
    it("キャラクターを選んだだけでは搭乗せず、役割選択の中止も変更を残さない", async () => {
        TargetSelectionDialog.prompt.mockResolvedValueOnce(actor.uuid).mockResolvedValueOnce(false);
        await sheet._promptBoard();
        expect(requestVehicleOperation).not.toHaveBeenCalled();
    });
    it("未登場者は搭乗候補に含めず、ドロップでも搭乗させない", async () => {
        actor.getFlag = () => false;
        await sheet._promptBoard();
        await sheet._promptBoard(actor);
        expect(TargetSelectionDialog.prompt).not.toHaveBeenCalled();
        expect(requestVehicleOperation).not.toHaveBeenCalled();
    });
    it("最初の搭乗者でも明示的に選んだ同乗者の役割を使う", async () => {
        TargetSelectionDialog.prompt.mockResolvedValueOnce(actor.uuid).mockResolvedValueOnce("passenger");
        await sheet._promptBoard();
        expect(requestVehicleOperation).toHaveBeenCalledWith("board", { vehicleUuid: "Actor.car", actorUuid: actor.uuid, role: "passenger" });
    });
    it("ドロップも役割の確認を通し、ドローンにも物理搭乗は操縦者として提示する", async () => {
        item.system.classifications = [{ minor: "drone" }];
        actor.system.isGhost = false;
        TargetSelectionDialog.prompt.mockResolvedValueOnce("driver");
        await sheet._promptBoard(actor);
        expect(TargetSelectionDialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ options: [{ value: "driver", label: "操縦者" }, { value: "passenger", label: "同乗者" }] }));
        expect(requestVehicleOperation).toHaveBeenCalledOnce();
    });
    it("既存方式の切替をヘッダーに一つだけ配置する", () => {
        const dom = new JSDOM('<form><header class="window-header"></header></form>');
        vi.stubGlobal("document", dom.window.document);
        vi.stubGlobal("AbortController", dom.window.AbortController);
        sheet.element = document.querySelector("form");
        sheet._onRender({ isEditMode: false }, {});
        sheet._onRender({ isEditMode: true }, {});
        expect(sheet.element.querySelectorAll(".window-header .edit-mode-toggle")).toHaveLength(1);
        expect(sheet.element.classList.contains("edit-mode")).toBe(true);
        expect(sheet.element.querySelector(".edit-mode-toggle").getAttribute("aria-pressed")).toBe("true");
        dom.window.close();
    });
});
