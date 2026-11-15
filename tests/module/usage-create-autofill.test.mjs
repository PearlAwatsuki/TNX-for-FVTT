import { resolveUsageSettings } from "../../scripts/rules/usage-skill-sync.mjs";
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

async function createUsage(type, { fixed = false, system = {} } = {}) {
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
            ...system,
        },
        async update(data) { this.system.actions = data["system.actions"]; },
    };
    vi.spyOn(TokyoNovaItemSheet, "_promptUsageType").mockImplementation(async (_choices, selected) => type ?? selected);
    await TokyoNovaItemSheet._onActionCreate.call({ item, document: item });
    return item.system.actions[0];
}

describe("用途作成時の自動入力", () => {
    it.each([["physical", "physicalAttack"], ["mental", "mentalAttack"], ["social", "socialAttack"]])(
        "%s の技能設定から攻撃用途の初期値を読み取る", async (attackMethod, type) => {
            const system = { dealsDamage: true, attackMethod, damageType: "P", canStun: true,
                checkMode: "normal", allowRecheck: true, allowSuitChange: true,
                checkBonusSelf: "@item.self.system.levelTotal", checkBonusSelfStackable: true,
                damageBonusSelf: "5", damageBonusSelfStackable: true,
                damageBonusSelfCondition: { kind: "wet", mode: "exclude", key: "" } };
            const usage = await createUsage(undefined, { system });
            expect(usage.settingsVersion).toBe(1);
            expect(usage.checkBonusSelf).toBeUndefined();
            expect(usage.damageBonuses).toEqual([]);
            const result = resolveUsageSettings(usage, { id: "parent-skill", type: "styleSkill", system });
            expect(result.effective).toMatchObject({ type, allowRecheck: true, allowSuitChange: true });
            expect(result.contributions.checkBonuses[0].formula).toBe(system.checkBonusSelf);
            expect(result.contributions.damageBonuses[0]).toMatchObject({ formula: "5", stackable: true,
                targetCondition: system.damageBonusSelfCondition });
            expect(result.effective.damageType).toBe(type === "physicalAttack" ? "P" : "");
        });

    it("does not copy skill permissions into new local settings", async () => {
        const usage = await createUsage("check", { system: { allowRecheck: true, checkBonusSelf: "3" } });
        expect(usage.allowRecheck).toBeUndefined();
        expect(usage.checkBonusSelf).toBeUndefined();
        expect(usage.settingsVersion).toBe(1);
    });

    it("ダメージ特性オフでは保管されているダメージ設定を複写しない", async () => {
        const usage = await createUsage("physicalAttack", { system: { dealsDamage: false, damageBonusSelf: "99", damageType: "X" } });
        expect(usage.damageBonusSelf ?? "").toBe("");
        expect(usage.damageType).toBe("");
    });

    it("用途タイプの手動選択は維持する", async () => {
        const usage = await createUsage("declaration", { system: { dealsDamage: true, attackMethod: "physical" } });
        expect(usage.type).toBe("declaration");
    });
    it("親技能の射程・目標値・対決の「なし」を用途に保存する", async () => {
        const usage = await createUsage("check", { system: {
            range: "none", targetValue: "none", confrontation: [{ value: "none" }],
        } });
        expect(usage).toMatchObject({ range: "none", targetValue: "none" });
        expect(usage.confrontation).toEqual([expect.objectContaining({ value: "none" })]);
    });
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
