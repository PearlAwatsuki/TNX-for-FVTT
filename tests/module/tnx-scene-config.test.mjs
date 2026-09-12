import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

const template = readFileSync(new URL("../../templates/app/area-combat-config.hbs", import.meta.url), "utf8");
foundry.applications.sheets ??= {};
foundry.applications.sheets.SceneConfig = class {
    constructor(document) { this.document = document; }
    async _renderHTML() { return this.parts; }
    _processFormData(_event, _form, data) { return structuredClone(data.object); }
    async close() { return "closed"; }
};
const { TnxSceneConfig } = await import("../../scripts/app/tnx-scene-config.mjs");
let app, board;
beforeEach(() => {
    board = { enabled: true, origin: { x: 0, y: 0 }, cell: { width: 600, height: 400 },
        rows: 3, columns: 5, style: { color: "#88ccee", alpha: 0.65 } };
    globalThis.game = { user: { isGM: true } };
    globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
    globalThis.Hooks = { callAll: vi.fn() };
    foundry.applications.handlebars = { renderTemplate: vi.fn(async () => template) };
    app = new TnxSceneConfig({ id: "scene", getFlag: () => ({ ...board, revision: 2 }), update: vi.fn(),
        dimensions: { sceneRect: { x: 0, y: 0, width: 3000, height: 1200 } } });
    app.parts = { tabs: { insertAdjacentHTML: vi.fn() }, grid: { insertAdjacentHTML: vi.fn() }, footer: { insertAdjacentHTML: vi.fn() } };
});

describe("Sceneのグリッド設定へ統合", () => {
    it("グリッド本文のfieldsetに追加し、タブ・フッター・保存ボタンを増やさない", async () => {
        await app._renderHTML({}, {});
        expect(app.parts.grid.insertAdjacentHTML).toHaveBeenCalledWith("beforeend", template);
        expect(app.parts.tabs.insertAdjacentHTML).not.toHaveBeenCalled();
        expect(app.parts.footer.insertAdjacentHTML).not.toHaveBeenCalled();
        expect(template).toContain("<legend>エリア戦闘</legend>");
        expect(template).not.toMatch(/<(form|button|footer)\b/);
        expect(template.match(/<fieldset\b/g)).toHaveLength(1);
        expect(template.match(/<\/fieldset>/g)).toHaveLength(1);
    });
    it("部分再描画でgridがない場合とPLでは追加しない", async () => {
        delete app.parts.grid;
        await app._renderHTML({}, {});
        expect(foundry.applications.handlebars.renderTemplate).not.toHaveBeenCalled();
        game.user.isGM = false;
        app.parts.grid = { insertAdjacentHTML: vi.fn() };
        await app._renderHTML({}, {});
        expect(app.parts.grid.insertAdjacentHTML).not.toHaveBeenCalled();
    });
    it("標準項目とエリア設定を同じsubmitDataへ含める", () => {
        const data = app._processFormData(null, null, { object: { name: "変更したシーン", width: 4000,
            grid: { type: 1, size: 100 }, flags: { [SYSTEM_ID]: { areaCombat: board }, other: { keep: true } } } });
        expect(data).toMatchObject({ name: "変更したシーン", width: 4000, grid: { type: 0, size: 100 },
            flags: { [SYSTEM_ID]: { areaCombat: { enabled: true, schemaVersion: 1, revision: 3 } }, other: { keep: true } } });
        expect(app.document.update).not.toHaveBeenCalled();
    });
    it("無効化では標準グリッドの選択を尊重する", () => {
        board.enabled = false;
        expect(app._processFormData(null, null, { object: { grid: { type: 1 }, flags: { [SYSTEM_ID]: { areaCombat: board } } } }).grid.type).toBe(1);
    });
    it("不正値はScene保存前に拒否する", () => {
        board.rows = 0;
        expect(() => app._processFormData(null, null, { object: { flags: { [SYSTEM_ID]: { areaCombat: board } } } })).toThrow();
        expect(app.document.update).not.toHaveBeenCalled();
    });
    it("エリア欄がないフォームは既存処理のまま", () => {
        expect(app._processFormData(null, null, { object: { grid: { type: 1 } } })).toEqual({ grid: { type: 1 } });
    });
    it("閉じる操作はプレビューを破棄しデータを保存しない", async () => {
        await app.close();
        expect(Hooks.callAll).toHaveBeenCalledWith("tnxAreaBoardPreview", "scene", null);
        expect(app.document.update).not.toHaveBeenCalled();
    });
});
