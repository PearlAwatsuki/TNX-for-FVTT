import { submitUsageForm } from "../../scripts/app/usage-sheet-submit.mjs";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { styleSkillUsageDefaults, styleSkillAttackType } from "../../scripts/rules/style-skill-usage-defaults.mjs";
import { resolveUsageSettings, migrateUsageSettings, restoreUsageSettings, USAGE_SKILL_FIELDS } from "../../scripts/rules/usage-skill-sync.mjs";
import { evaluateBonusRows } from "../../scripts/rules/tnx-formula.mjs";
import { selectFormulaContributions } from "../../scripts/rules/formula-duplicates.mjs";
import { StyleSkillDataModel } from "../../scripts/data/item/style-skill.mjs";

// 参考資料27件の移植ではない。依頼文から独立に再現した監査ケース。
// 用途タイプのアダプターは使わず、本体の全ルールをそのまま読み込む。
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", async original => ({ ...await original(), loadSkillClassByKey: async () => new Map() }));
const skill = (id, system = {}) => ({ id, name: id, type: "styleSkill", system: {
    identificationKey: id, levelTotal: 4, suits: { spade: true }, dealsDamage: true, attackMethod: "physical",
    checkBonusSelf: "3", damageBonusSelf: "5", ...system } });
const base = { id: "base", name: "Base", type: "generalSkill", system: { identificationKey: "base", suits: { spade: true } } };
const local = (extra = {}) => ({ _id: "u", settingsVersion: 1, type: "physicalAttack", skillRefs: [{ itemId: "s" }],
    checkBonuses: [{ source: "s", formula: "2" }], damageBonuses: [{ source: "s", formula: "7" }], ...extra });
function actorOf(items) {
    items.get = id => items.find(item => item.id === id);
    return { id: "actor", system: {}, items, getRollData: () => ({}) };
}
afterEach(() => vi.unstubAllGlobals());

describe("数値供給の現行挙動と不足箇所（仕様の承認ではない）", () => {
    it.each(["physicalAttack", "mentalAttack", "socialAttack"])("現行ではphysical設定の技能修正が%sにも供給される", type => {
        const result = resolveUsageSettings(local({ type }), base, () => skill("s"));
        expect(result.contributions.damageBonuses.map(r => r.formula)).toEqual(["5"]);
    });
    it("dealsDamageは用途初期タイプと修正供給の両方を制御する", () => {
        expect(styleSkillAttackType(skill("s", { attackMethod: "social" }).system)).toBe("socialAttack");
        const disabled = skill("s", { dealsDamage: false });
        expect(styleSkillAttackType(disabled.system)).toBeNull();
        const result = resolveUsageSettings(local(), base, () => disabled);
        expect(result.contributions.damageBonuses).toEqual([]);
        expect(result.effective.damageBonuses[0]).toMatchObject({ source: "s", formula: "7" });
    });
    it("技能スキーマに受け値供給を追加し、ダメージ修正とは分離する", () => {
        const schema = StyleSkillDataModel.defineSchema();
        expect(schema).toHaveProperty("guardBonusSelf");
        expect(schema).toHaveProperty("guardBonusSelfStackable");
        expect(styleSkillUsageDefaults(skill("s").system, { type: "reaction" })).not.toHaveProperty("damageBonusSelf");
    });
    it("用途固有の受け値行を保持し、自動の判定・ダメージ行に混ぜない", () => {
        const input = local({ type: "reaction", guardBonusSelf: "4", guardBonuses: [{ source: "s", formula: "8" }] });
        const result = resolveUsageSettings(input, base, () => skill("s"));
        expect(result.effective.guardBonuses).toMatchObject(input.guardBonuses);
        expect(result.effective.guardBonuses[0].origin.kind).toBe("usage");
        expect(result.effective.guardBonusSelf).toBe("4");
        expect(result.contributions.damageBonuses).toEqual([]);
        expect(result.contributions.checkBonuses.map(r => r.formula)).toEqual(["3"]);
    });
});

describe("保存境界・来歴・評価までの回帰保護", () => {
    it("sourceが同じ手動・自動の定数行はどちらも評価される", async () => {
        const s = skill("s"), actor = actorOf([base, s]);
        const resolved = resolveUsageSettings(local(), base, id => actor.items.get(id));
        expect(resolved.effective.damageBonuses.map(r => r.origin.kind)).toEqual(["usage", "skill"]);
        const evaluated = await evaluateBonusRows(resolved.effective.damageBonuses, actor, null, null, null, base, { withReferences: true });
        expect(evaluated.sources.map(r => r.name)).toEqual(["s", "s"]);
        expect(selectFormulaContributions(evaluated.sources).total).toBe(12);
    });
    it("同一技能の重複参加を除き、削除・定義変更後も手動行を維持する", () => {
        const s = skill("s"), input = local({ baseSkillRef: { itemId: "s" }, skillRefs: [{ itemId: "s" }, { itemId: "s" }] });
        expect(resolveUsageSettings(input, base, () => s).contributions.damageBonuses).toHaveLength(1);
        s.system.damageBonusSelf = "9";
        expect(resolveUsageSettings(input, base, () => s).effective.damageBonuses.map(r => r.formula)).toEqual(["7", "9"]);
        expect(resolveUsageSettings(input, base, () => null).effective.damageBonuses).toEqual([
            { source: "s", formula: "7", origin: { kind: "usage", field: "damageBonuses", index: 0 } }]);
    });
    it("実効用途の繰り返し解決で二重加算も保存データの変化も起こさない", () => {
        const s = skill("s"), input = local(), before = structuredClone(input);
        const first = resolveUsageSettings(input, base, () => s);
        let result = first;
        for (let i = 0; i < 5; i++) result = resolveUsageSettings(result.effective, base, () => s);
        expect(result).toEqual(first);
        expect(input).toEqual(before);
    });
    it("式参照の競合はsourceではなく参照キーで判定し、重複可の手動行を維持する", () => {
        const rows = [{ name: "same", value: 3, referenceKeys: ["skill:s:level"] },
            { name: "different", value: 6, referenceKeys: ["skill:s:level"] },
            { name: "same", value: 2, referenceKeys: ["skill:s:level"], stackable: true }];
        const result = selectFormulaContributions(rows);
        expect(result.total).toBe(8);
        expect(result.sources[0].note).toContain("重複");
        expect(result.sources).toHaveLength(3);
    });
    it.each(["wet", "style", "works"])("%sの対象条件を技能由来行に保持する", kind => {
        const condition = { kind, mode: "only", key: kind === "wet" ? "" : "target_key" };
        const result = resolveUsageSettings(local(), base, () => skill("s", { damageBonusSelfCondition: condition }));
        expect(result.effective.damageBonuses[1].targetCondition).toEqual(condition);
        expect(result.effective.damageBonuses[0]).not.toHaveProperty("targetCondition");
    });
    it("ウェット対象の判定は行を削除せず、無効理由つき0行として評価する", async () => {
        const s = skill("s", { damageBonusSelfCondition: { kind: "wet", mode: "only", key: "" } });
        const actor = actorOf([base, s]);
        const rows = resolveUsageSettings(local({ damageBonuses: [] }), base, () => s).effective.damageBonuses;
        const dry = actorOf([]);
        const result = await evaluateBonusRows(rows, actor, null, null, dry, base);
        expect(result.total).toBe(0);
        expect(result.sources).toEqual([{ name: "s", value: 0, note: expect.stringContaining("ウェット") }]);
        expect((await evaluateBonusRows(rows, actor, null, null, null, base)).total).toBe(5);
    });
    it("受け値行を送信しない部分編集でも用途固有の受け値行を保持すべき", async () => {
        const input = local({ type: "reaction", timing: {}, guardBonuses: [{ source: "s", formula: "8" }] });
        const sheet = { usage: input, _item: { system: {} }, _patchUsage: vi.fn(), _enforceComboRequirements: vi.fn(), render: vi.fn() };
        await submitUsageForm(sheet, {}, {}, { object: { name: "renamed" } });
        expect(sheet._patchUsage.mock.calls[0][0].guardBonuses).toEqual(input.guardBonuses);
    });
    it("旧用途は自動導出せず、明示的移行・復元で供給元つき手動行を保全する", () => {
        const input = local({ settingsVersion: 0 });
        expect(resolveUsageSettings(input, base, () => skill("s")).effective.damageBonuses).toEqual(input.damageBonuses);
        const decisions = Object.fromEntries(USAGE_SKILL_FIELDS.map(key => [key, { action: "keep" }]));
        const migrated = migrateUsageSettings(input, decisions);
        expect(resolveUsageSettings(migrated, base, () => skill("s")).effective.damageBonuses).toHaveLength(2);
        expect(restoreUsageSettings(migrated)).toEqual(input);
    });
    it("武器を識別キーで明示した式は技能由来行でも評価できる（選択武器の自動参照とは別）", async () => {
        // FoundryのRoll境界だけを、参照解決と加算に限定したスタブで代替する。
        vi.stubGlobal("Roll", class {
            constructor(formula, data) { this.isDeterministic = true; this.formula = formula.replace(/@([a-zA-Z0-9_.]+)/g,
                (_, path) => { const v = path.split(".").reduce((o, k) => o?.[k], data);
                    if (typeof v !== "number") throw Error(path); return String(v); }); }
            async evaluate() { this.total = this.formula.split("+").reduce((n, term) => n + Number(term.trim()), 0); }
        });
        const weapon = { id: "w", type: "weapon", system: { identificationKey: "blade", attack: { total: 8 } } };
        const s = skill("s", { damageBonusSelf: "@item.blade.system.attack.total + @item.self.system.levelTotal" });
        const actor = actorOf([base, s, weapon]), input = local({ weaponRefs: [{ itemId: "w" }], damageBonuses: [] });
        const result = resolveUsageSettings(input, base, id => actor.items.get(id));
        const evaluated = await evaluateBonusRows(result.effective.damageBonuses, actor, null, null, null, base, { withReferences: true });
        expect(evaluated.total).toBe(12);
        expect(evaluated.sources[0].referenceKeys).toHaveLength(2);
    });
});

describe("判定ダイアログの実フローでの再導出", () => {
    let Flow;
    beforeAll(async () => {
        foundry.applications.api.ApplicationV2 = class {};
        foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
        ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
    });
    afterEach(() => { Flow._context = null; });
    async function rebuild(isRecheck) {
        const s = skill("s"), actor = actorOf([base, s]), input = local({ skillRefs: [] });
        const initial = resolveUsageSettings(input, base, id => actor.items.get(id)).effective;
        vi.stubGlobal("game", { actors: new Map([[actor.id, actor]]) });
        Flow._context = { type: "skillCheck", actorId: actor.id, sourceItemId: base.id, isRecheck,
            baseSkillIds: [base.id], dialogAddedSkillIds: [s.id], usageSettingsInput: input,
            checkBonuses: initial.checkBonuses, attack: { isAttack: true, category: "physical", damageBonuses: initial.damageBonuses } };
        await Flow._rebuildDialogSkillContext();
        return Flow._context;
    }
    it("再判定では参加技能追加・削除に追従する", async () => {
        const ctx = await rebuild(true);
        expect(ctx.checkBonuses.map(r => r.formula)).toEqual(["2", "3"]);
        expect(ctx.attack.damageBonuses.map(r => r.formula)).toEqual(["7", "5"]);
        ctx.dialogAddedSkillIds = [];
        await Flow._rebuildDialogSkillContext();
        expect(ctx.checkBonuses.map(r => r.formula)).toEqual(["2"]);
        expect(ctx.attack.damageBonuses.map(r => r.formula)).toEqual(["7"]);
    });
    // KI-069修正後は通常判定でも同じ再導出を検証する。
    it("通常判定でも追加技能から判定修正を再導出すべき", async () => {
        const ctx = await rebuild(false);
        expect(ctx.skillIds).toEqual(["base", "s"]);
        expect(ctx.checkBonuses.map(r => r.formula)).toEqual(["2", "3"]);
    });
    it("通常攻撃でも追加技能からダメージ修正を再導出すべき", async () => {
        const ctx = await rebuild(false);
        expect(ctx.attack.damageBonuses.map(r => r.formula)).toEqual(["7", "5"]);
    });
});
