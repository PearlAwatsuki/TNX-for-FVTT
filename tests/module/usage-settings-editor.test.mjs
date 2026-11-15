import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { prepareUsageContext } from "../../scripts/app/usage-sheet-context.mjs";
import { resolveUsageSettings } from "../../scripts/rules/usage-skill-sync.mjs";
import { UsageSettingsMigrationDialog } from "../../scripts/ui/tnx-dialog.mjs";

vi.mock("../../scripts/dictionary/skill-dictionary.mjs", async original => ({
    ...await original(), loadCascadeData: async () => ({}), loadSkillChoices: async () => ({}),
}));
let Sheet;
beforeAll(async () => {
    foundry.utils.deepClone = structuredClone;
    foundry.applications.api.ApplicationV2 = class { async _prepareContext() { return {}; } };
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    ({ TnxUsageSheet: Sheet } = await import("../../scripts/app/tnx-usage-sheet.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(settingsVersion = 1) {
    const usage = { _id: "u", settingsVersion, type: "declaration", skillRefs: [],
        checkBonusSelf: "5", timing: {}, checkBonuses: [{ source: "s", formula: "2" }] };
    const item = { id: "s", name: "Skill", type: "styleSkill", isOwner: true, update: vi.fn(), effects: new Map(),
        system: { actions: [usage], checkBonusSelf: "3", allowRecheck: true } };
    const items = [item]; items.get = id => items.find(i => i.id === id);
    item.actor = { items };
    const sheet = Object.assign(Object.create(Sheet.prototype), { _item: item, _usageId: "u", render: vi.fn() });
    vi.stubGlobal("game", { packs: new Map(), items: [], settings: { get: () => "" } });
    return { usage, item, sheet };
}
describe("usage editor boundaries", () => {
    it.each([0, 1])("preparing a version %s usage twice is read-only and uses the runtime resolver", async version => {
        const { usage, item, sheet } = fixture(version);
        const before = structuredClone(usage);
        const first = await prepareUsageContext(sheet, {});
        const second = await sheet._prepareContext({});
        expect(first.effectiveSettings).toEqual(resolveUsageSettings(usage, item).effective);
        expect(second.effectiveSettings).toEqual(first.effectiveSettings);
        expect(first.usage.checkBonusSelf).toBe("5");
        expect(first.settingsNeedsReview).toBe(version === 0);
        expect(item.update).not.toHaveBeenCalled();
        expect(usage).toEqual(before);
    });
    it("does not migrate when the review is cancelled", async () => {
        const { item, sheet } = fixture(0);
        vi.spyOn(UsageSettingsMigrationDialog, "prompt").mockResolvedValue(false);
        await Sheet._onMigrateSettings.call(sheet);
        expect(item.update).not.toHaveBeenCalled();
    });
    it("mounting the editor does not enforce or persist combo defaults", () => {
        const { item, sheet } = fixture();
        const dom = new JSDOM("<form></form>");
        sheet.element = dom.window.document.querySelector("form");
        sheet.tabGroups = {};
        sheet._enforceComboRequirements = vi.fn();
        sheet._onRender({ editable: true }, {});
        expect(sheet._enforceComboRequirements).not.toHaveBeenCalled();
        expect(item.update).not.toHaveBeenCalled();
        dom.window.close();
    });
    it("re-resolves skill edits without changing the editor's local fields", async () => {
        const { usage, item, sheet } = fixture();
        const first = await prepareUsageContext(sheet, {});
        expect(first.skillCheckContributions[0].formula).toBe("3");
        item.system.checkBonusSelf = "7";
        const second = await prepareUsageContext(sheet, {});
        expect(second.skillCheckContributions[0].formula).toBe("7");
        expect(second.usage.checkBonusSelf).toBe("5");
        expect(usage.checkBonusSelf).toBe("5");
        expect(item.update).not.toHaveBeenCalled();
    });
    it("rejects migration if the entry changed during review", async () => {
        const { usage, item, sheet } = fixture(0);
        vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
        vi.spyOn(UsageSettingsMigrationDialog, "prompt").mockImplementation(async () => {
            usage.name = "concurrent edit"; return {};
        });
        await Sheet._onMigrateSettings.call(sheet);
        expect(item.update).not.toHaveBeenCalled();
        expect(usage.name).toBe("concurrent edit");
    });
});
