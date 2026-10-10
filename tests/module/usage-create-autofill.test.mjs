import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../../scripts/app/tnx-usage-sheet.mjs", () => ({
    TnxUsageSheet: class { render() {} }, USAGE_TYPES: {},
}));
vi.mock("../../scripts/flow/item-activation.mjs", () => ({ activateItemCheck: vi.fn() }));
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", async importOriginal => ({
    ...await importOriginal(),
    loadDictionarySkillItems: async () => [],
    loadSkillUsageTypeIndex: async () => new Map(),
}));

let TokyoNovaItemSheet;
beforeAll(async () => {
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.applications.sheets = { ItemSheetV2: class {} };
    foundry.utils.deepClone = structuredClone;
    foundry.utils.expandObject = data => {
        const result = {};
        for (const [path, value] of Object.entries(data)) {
            const parts = path.split(".");
            const key = parts.pop();
            let node = result;
            for (const part of parts) node = node[part] ??= {};
            node[key] = value;
        }
        return result;
    };
    foundry.utils.mergeObject = (target, source) => Object.assign(target, source);
    ({ TokyoNovaItemSheet } = await import("../../scripts/item/tnx-item-sheet.mjs"));
});
afterEach(() => vi.restoreAllMocks());

async function createUsage(type, { fixed = false } = {}) {
    const item = {
        id: "parent-skill", type: fixed ? "generalSkill" : "styleSkill", isOwner: true,
        parent: fixed ? { type: "extra" } : null,
        system: {
            actions: [], target: "single", isFixedTarget: true,
            range: "short", isFixedRange: true,
            timing: [{ value: "action", actionName: "minor" }],
            targetValue: "number", targetValueNumber: 12,
            confrontation: [{ value: "dodge", name: "" }],
            uses: { isLimit: true },
        },
        async update(data) { this.system.actions = data["system.actions"]; },
    };
    vi.spyOn(TokyoNovaItemSheet, "_promptUsageType").mockResolvedValue(type);
    await TokyoNovaItemSheet._onActionCreate.call({ item, document: item });
    return item.system.actions[0];
}

describe("用途作成時の自動入力", () => {
    it.each(["declaration", "check", "physicalAttack"])("%s は親技能の発動値と消費を保存する", async type => {
        const usage = await createUsage(type);
        expect(usage).toMatchObject({
            type, target: "single", isFixedTarget: true, range: "short", isFixedRange: true,
            timing: { value: "action", actionName: "minor" },
            targetValue: "number", targetValueNumber: 12,
            consumeTargets: [{ type: "item", itemId: "", resource: "uses", amount: 1 }],
        });
        expect(usage.confrontation).toContainEqual(expect.objectContaining({ value: "dodge" }));
    });

    it("固定値判定は発動値を取得しない", async () => {
        expect(await createUsage("check", { fixed: true })).toMatchObject({
            fixedResult: 10, target: "blank", timing: { value: "blank" }, consumeTargets: [],
        });
    });

    it("再取得ボタンはコンボ設定とは別に宣言用途にも表示できる", () => {
        const context = readFileSync(new URL("../../scripts/app/usage-sheet-context.mjs", import.meta.url), "utf8");
        const template = readFileSync(new URL("../../templates/app/usage-sheet.hbs", import.meta.url), "utf8");
        expect(context).toContain("context.showAutoFill = !context.isFixedCheck && (context.showSkillParams || context.isDeclarationType)");
        expect(template).toMatch(/{{#if showAutoFill}}\s*{{#if editable}}[\s\S]*?data-action="autoFill"/);
    });
});
