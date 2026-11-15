import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

vi.mock("../../scripts/app/tnx-usage-sheet.mjs", () => ({ TnxUsageSheet: class {}, USAGE_TYPES: {} }));
vi.mock("../../scripts/flow/item-activation.mjs", () => ({ activateItemCheck: vi.fn() }));

let Sheet;
const baseSubmit = vi.fn();
beforeAll(async () => {
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.applications.sheets = { ItemSheetV2: class {
        _processSubmitData(...args) { return baseSubmit(...args); }
    } };
    ({ TokyoNovaStyleSkillSheet: Sheet } = await import("../../scripts/item/tnx-style-skill-sheet.mjs"));
});
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("game", {}); });
afterEach(() => vi.unstubAllGlobals());

function fixture({ cached = false, replaced = true } = {}) {
    const document = { id: "skill", pack: "tnx.skills", updateSource: vi.fn() };
    const current = replaced ? { id: document.id, toObject: () => ({ _id: "skill", system: { checkMode: "modify" } }) } : document;
    current.update = vi.fn(async () => current);
    const pack = new Map(cached ? [[document.id, current]] : []);
    pack.getDocument = vi.fn(async () => { pack.set(document.id, current); return current; });
    game.packs = new Map([[document.pack, pack]]);
    const sheet = Object.assign(Object.create(Sheet.prototype), { document, render: vi.fn() });
    return { sheet, document, current, pack };
}

describe("スタイル技能シートのフォーム保存", () => {
    it.each([false, true])("辞典キャッシュ有無=%sでも既存アイテムを更新する", async cached => {
        const { sheet, current, document, pack } = fixture({ cached });
        const data = { system: { checkMode: "modify", dealsDamage: true } };
        const options = { render: true };
        expect(await sheet._processSubmitData(null, null, data, options)).toEqual({ updated: current });
        expect(pack.getDocument).toHaveBeenCalledWith("skill");
        expect(current.update).toHaveBeenCalledWith(data, options);
        expect(baseSubmit).not.toHaveBeenCalled();
        expect(document.updateSource).toHaveBeenCalledWith(current.toObject());
        expect(sheet.render).toHaveBeenCalled();
    });
    it("同じインスタンスなら通常の文書更新による描画に任せる", async () => {
        const { sheet, document } = fixture({ cached: true, replaced: false });
        await sheet._processSubmitData(null, null, { system: { dealsDamage: false } });
        expect(document.updateSource).not.toHaveBeenCalled();
        expect(sheet.render).not.toHaveBeenCalled();
    });
    it("削除された辞典アイテムを再作成しない", async () => {
        const { sheet, current, pack } = fixture();
        pack.getDocument.mockResolvedValue(undefined);
        await expect(sheet._processSubmitData(null, null, {})).rejects.toThrow("見つかりません");
        expect(current.update).not.toHaveBeenCalled();
        expect(baseSubmit).not.toHaveBeenCalled();
    });
    it("更新失敗時に表示を保存済みのように変更しない", async () => {
        const { sheet, current, document } = fixture();
        current.update.mockRejectedValue(new Error("locked"));
        await expect(sheet._processSubmitData(null, null, {})).rejects.toThrow("locked");
        expect(document.updateSource).not.toHaveBeenCalled();
        expect(sheet.render).not.toHaveBeenCalled();
    });
    it("ワールド・所持アイテムはFoundry標準の保存経路を維持する", async () => {
        const { sheet, document } = fixture();
        document.pack = null;
        await sheet._processSubmitData(null, null, { name: "changed" });
        expect(baseSubmit).toHaveBeenCalledWith(null, null, { name: "changed" }, {});
    });
});

// 任意の実インストールに対する統合検証。Foundry本体はリポジトリへコピーしない。
describe.skipIf(!process.env.FOUNDRY_APP_PATH)("Foundry実装のフォーム抽出と保存分岐", () => {
    it("ラジオ・チェック・式入力のchangeを実FormDataExtended経由で保存する", async () => {
        const root = process.env.FOUNDRY_APP_PATH;
        const source = readFileSync(join(root, "client/applications/ux/form-data-extended.mjs"), "utf8");
        const H = createRequire(import.meta.url)(join(root, "node_modules/handlebars")).create();
        H.registerHelper("eq", (a, b) => a === b);
        H.registerHelper("checked", value => value ? "checked" : "");
        H.registerHelper("selectOptions", () => "");
        const template = readFileSync(new URL("../../templates/item/style-skill-sheet.hbs", import.meta.url), "utf8");
        const sectionStart = template.lastIndexOf("<fieldset", template.indexOf("<legend>判定</legend>"));
        const sectionEnd = template.indexOf("{{!-- ワークス技能:");
        const settings = H.compile(template.slice(sectionStart, sectionEnd))({
            system: { dealsDamage: true, checkMode: "normal", uses: { max: "", spent: 0 } },
            isPhysicalDamage: true, options: {},
        });
        const traits = H.compile(readFileSync(new URL("../../templates/item/parts/skill-traits.hbs", import.meta.url), "utf8"))({
            traitFlags: [{ name: "system.dealsDamage", checked: true }],
        });
        const dom = new JSDOM(`<form>${traits}${settings}</form>`);
        const w = dom.window;
        vi.stubGlobal("window", w);
        const FormDataExtended = new Function("FormData", "FormDataEvent", "RadioNodeList", "foundry",
            source.replace("export default class", "return class"))(
            w.FormData, w.Event, w.RadioNodeList,
            { utils: { isElementInstanceOf: (obj, cls) => obj instanceof cls } });
        const { sheet, current, pack, document } = fixture();

        // インストール済みFoundryの更新/作成分岐そのものを使い、変更前の例外を再現する。
        const core = readFileSync(join(root, "client/applications/api/document-sheet.mjs"), "utf8");
        const start = core.indexOf("  async _processSubmitData(");
        const end = core.indexOf("\n  }", start) + 4;
        const coreSubmit = new Function(`return class { ${core.slice(start, end).replaceAll("this.#document", "this.document")} }`)();
        document.collection = pack;
        const oldSheet = Object.assign(new coreSubmit(), { document, options: { canCreate: false } });
        await expect(oldSheet._processSubmitData(null, null, {})).rejects.toThrow("Document creation");

        const form = w.document.querySelector("form");
        const changes = [
            [form.querySelector('[value="modify"]'), "checked", true, "system.checkMode", "modify"],
            [form.querySelector('[name="system.dealsDamage"]'), "checked", true, "system.dealsDamage", true],
            [form.querySelector('[name="system.dealsDamage"]'), "checked", false, "system.dealsDamage", false],
            [form.querySelector('[name="system.damageBonusSelf"]'), "value", "@item.self.system.levelTotal + 2", "system.damageBonusSelf", "@item.self.system.levelTotal + 2"],
            [form.querySelector('[name="system.uses.max"]'), "value", "3", "system.uses.max", "3"],
            [form.querySelector('[name="system.uses.spent"]'), "value", "1", "system.uses.spent", 1],
        ];
        let pending;
        form.addEventListener("change", event => {
            const values = new FormDataExtended(form).object;
            pending = sheet._processSubmitData(event, form, values);
        });
        for (const [input, property, value, key, expected] of changes) {
            pack.clear();
            input[property] = value;
            input.dispatchEvent(new w.Event("change", { bubbles: true }));
            await pending;
            expect(current.update.mock.lastCall[0][key]).toBe(expected);
        }
        dom.window.close();
    });
});
