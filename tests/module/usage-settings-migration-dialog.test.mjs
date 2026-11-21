import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { resolveUsageSettings } from "../../scripts/rules/usage-skill-sync.mjs";

// Only the Foundry dialog host is simulated. HTML, choices, callbacks, sheet actions,
// migration, serialized persistence and restoration all use production code.
const { DialogV2 } = foundry.applications.api;
const windows = [];
let Sheet;
beforeAll(async () => {
    foundry.utils.deepClone = structuredClone;
    foundry.utils.escapeHTML = text => String(text).replace(/[&<>"']/g,
        char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    DialogV2.confirm = async options => DialogV2.wait({ ...options,
        buttons: [{ action: "yes", callback: () => true }, { action: "no", callback: () => false }], close: () => false });
    ({ TnxUsageSheet: Sheet } = await import("../../scripts/app/tnx-usage-sheet.mjs"));
});
afterEach(() => {
    for (const window of windows.splice(0)) window.close();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function fixture() {
    const original = { _id: "u", settingsVersion: 0, type: "physicalAttack", name: "Original",
        skillRefs: [], checkBonusSelf: "5", damageBonusSelf: "6", damageType: "X",
        checkBonuses: [{ source: "s", formula: "11", stackable: true }, { source: "s", formula: "3" }],
        damageBonuses: [{ source: "s", formula: "7", targetCondition: { kind: "wet", mode: "only", key: "" } }],
        requiresVehicle: true, allowRecheck: true, unknownExtension: { keep: [1, 2] },
        skillSettingsSync: { sources: ["s"] } };
    const item = { id: "s", name: "Source", type: "styleSkill", isOwner: true,
        system: { actions: [structuredClone(original), { _id: "other", name: "Untouched" }],
            identificationKey: "s", checkBonusSelf: "3", dealsDamage: true, damageBonusSelf: "2", damageType: "P" },
        update: vi.fn(async function (patch) { this.system.actions = JSON.parse(JSON.stringify(patch["system.actions"])); }) };
    const sheet = Object.assign(Object.create(Sheet.prototype), { _item: item, _usageId: "u", render: vi.fn() });
    vi.stubGlobal("game", { packs: new Map() });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    return { original, item, sheet };
}

function interact(drive) {
    vi.spyOn(DialogV2, "wait").mockImplementationOnce(async options => {
        const dom = new JSDOM(`<form>${options.content}</form>`);
        windows.push(dom.window);
        const form = dom.window.document.querySelector("form");
        const dialog = { element: form };
        const outcome = new Promise((resolve, reject) => {
            for (const button of options.buttons) {
                const element = dom.window.document.createElement("button");
                element.type = "button";
                element.dataset.action = button.action;
                element.textContent = button.label ?? button.action;
                element.addEventListener("click", event => {
                    Promise.resolve().then(() => button.callback(event, element, dialog))
                        .then(value => resolve(value ?? button.action), reject);
                });
                form.append(element);
            }
            drive({
                form,
                select(label, value) {
                    const control = [...form.querySelectorAll("label")].find(el => el.textContent === label)
                        ?.parentElement.querySelector("select");
                    expect(control, label).toBeTruthy();
                    control.value = value;
                    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
                    expect(control.value).toBe(value);
                },
                keepAll() {
                    for (const select of form.querySelectorAll("select")) {
                        expect([...select.options].map(option => option.value)).toEqual(["", "keep", "skill"]);
                        select.value = "keep";
                        select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
                    }
                },
                click(action) { form.querySelector(`[data-action="${action}"]`).click(); },
                close() { resolve(options.close()); },
            });
        });
        return outcome;
    });
}

describe("migration dialog DOM interaction", () => {
    it("renders three valid choices and persists values explicitly kept as local", async () => {
        const { original, item, sheet } = fixture();
        interact(({ form, keepAll, click }) => {
            keepAll();
            for (const select of form.querySelectorAll("select"))
                expect([...select.options].map(option => option.textContent)).toEqual(["扱いを選択", "用途固有として保持", "技能から導出"]);
            click("migrate");
        });
        await Sheet._onMigrateSettings.call(sheet);
        expect(item.update).toHaveBeenCalledOnce();
        expect(sheet.usage).toMatchObject({ settingsVersion: 1, checkBonusSelf: "5", damageBonusSelf: "6",
            checkBonuses: original.checkBonuses, damageBonuses: original.damageBonuses, settingsBackup: original });
        const effective = resolveUsageSettings(sheet.usage, item).effective;
        expect(effective.checkBonusSelf).toBe("5");
        expect(effective.checkBonuses.map(row => row.formula)).toEqual(["11", "3", "3"]);
        expect(item.system.actions[1]).toEqual({ _id: "other", name: "Untouched" });
    });
    it("derives selected fields and rows from skills without removing same-source rows kept manually", async () => {
        const { original, item, sheet } = fixture();
        interact(({ keepAll, select, click }) => {
            keepAll();
            for (const label of ["用途自身の判定修正", "用途自身のダメージ修正", "判定修正行 2", "ダメージ修正行 1",
                "ヴィークル準備条件", "再判定の許可", "選択したダメージ種別"]) select(label, "skill");
            click("migrate");
        });
        await Sheet._onMigrateSettings.call(sheet);
        expect(sheet.usage).toMatchObject({ checkBonusSelf: "", damageBonusSelf: "", requiresVehicle: false,
            allowRecheck: false, damageType: "", checkBonuses: [original.checkBonuses[0]], damageBonuses: [], settingsBackup: original });
        item.system.checkBonusSelf = "9";
        item.system.requiresVehicle = true;
        item.system.allowRecheck = true;
        const effective = resolveUsageSettings(sheet.usage, item).effective;
        expect(effective.checkBonuses.map(row => row.formula)).toEqual(["11", "9"]);
        expect(effective.damageBonuses.map(row => row.formula)).toEqual(["2"]);
        expect(effective).toMatchObject({ damageType: "P", requiresVehicle: true, allowRecheck: true });
    });
    it.each(["cancel", "close"])("does not persist after %s even when selections were changed", async action => {
        const { original, item, sheet } = fixture();
        interact(({ keepAll, select, click, close }) => {
            keepAll(); select("用途自身の判定修正", "skill");
            if (action === "close") close(); else click("cancel");
        });
        await Sheet._onMigrateSettings.call(sheet);
        expect(item.update).not.toHaveBeenCalled();
        expect(sheet.usage).toEqual(original);
    });
    it("rejects a submission containing an unreviewed field", async () => {
        const { original, item, sheet } = fixture();
        interact(({ keepAll, select, click }) => { keepAll(); select("用途自身の判定修正", ""); click("migrate"); });
        await Sheet._onMigrateSettings.call(sheet);
        expect(item.update).not.toHaveBeenCalled();
        expect(sheet.usage).toEqual(original);
        expect(ui.notifications.warn).toHaveBeenCalledOnce();
    });
    it.each(["yes", "no", "close"])("handles restoration choice %s after migration and subsequent edits", async action => {
        const { original, item, sheet } = fixture();
        interact(({ keepAll, select, click }) => { keepAll(); select("用途自身の判定修正", "skill"); click("migrate"); });
        await Sheet._onMigrateSettings.call(sheet);
        sheet.usage.name = "Edited after migration";
        sheet.usage.checkBonusSelf = "99";
        const beforeRestore = structuredClone(sheet.usage);
        item.update.mockClear();
        interact(({ form, click, close }) => {
            expect(form.textContent).toContain("用途全体を移行直前の状態に戻します");
            if (action === "close") close(); else click(action);
        });
        await Sheet._onRestoreSettings.call(sheet);
        expect(item.update).toHaveBeenCalledTimes(action === "yes" ? 1 : 0);
        expect(sheet.usage).toEqual(action === "yes" ? original : beforeRestore);
        expect(item.system.actions[1]).toEqual({ _id: "other", name: "Untouched" });
    });
    it.each(["keep", "skill"])("受け値の来歴を%sで明示し、手動行の保持と復元を確認する", async choice => {
        const { item, sheet } = fixture();
        Object.assign(sheet.usage, { type: "reaction", guardBonusSelf: "6", guardBonusSelfStackable: true,
            guardBonuses: [{ source: "s", formula: "7" }, { source: "s", formula: "3" }] });
        item.system.guardBonusSelf = "3";
        const original = structuredClone(sheet.usage);
        interact(({ keepAll, select, click }) => {
            keepAll();
            select("用途自身の受け値修正", choice);
            select("受け値修正の重複可", choice);
            select("受け値修正行 2", choice);
            click("migrate");
        });
        await Sheet._onMigrateSettings.call(sheet);
        const effective = resolveUsageSettings(sheet.usage, item).effective;
        expect(effective.guardBonusSelf).toBe(choice === "keep" ? "6" : "");
        expect(effective.guardBonusSelfStackable).toBe(choice === "keep");
        expect(effective.guardBonuses.map(row => row.formula)).toEqual(choice === "keep" ? ["7", "3", "3"] : ["7", "3"]);
        expect(sheet.usage.settingsBackup).toEqual(original);
        interact(({ click }) => click("yes"));
        await Sheet._onRestoreSettings.call(sheet);
        expect(sheet.usage).toEqual(original);
    });
    it("旧パリー用途のバックアップを復元しても統合タイプと技能資格を保持する", async () => {
        const { item, sheet } = fixture();
        item.system.actionQualifications = ["parry"];
        const backup = { ...structuredClone(sheet.usage), type: "parry", weaponRefs: [{ itemId: "w" }], guardBonusSelf: "8" };
        item.system.actions[0] = { ...structuredClone(backup), type: "reaction", guardBonusSelf: "99", settingsBackup: backup };
        interact(({ click }) => click("yes"));
        await Sheet._onRestoreSettings.call(sheet);
        expect(sheet.usage).toEqual({ ...backup, type: "reaction" });
        expect(item.system.actionQualifications).toEqual(["parry"]);
        expect(backup.type).toBe("parry");
    });

});
