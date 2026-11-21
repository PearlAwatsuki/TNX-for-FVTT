import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { resolveUsageSettings } from "../../scripts/rules/usage-skill-sync.mjs";
import { styleSkillAttackType } from "../../scripts/rules/style-skill-usage-defaults.mjs";
import { StyleSkillDataModel } from "../../scripts/data/item/style-skill.mjs";
import { buildParryGuardSnapshot } from "../../scripts/rules/parry-weapons.mjs";

vi.mock("../../scripts/dictionary/skill-dictionary.mjs", async original => ({ ...await original(), loadSkillClassByKey: async () => new Map() }));
const base = { id: "base", name: "Base", type: "generalSkill", system: { identificationKey: "base", suits: { spade: true } } };
const skill = (extra = {}) => ({ id: "s", name: "Supplier", type: "styleSkill", system: {
    identificationKey: "supplier", suits: { spade: true }, dealsDamage: true, attackMethod: "social",
    damageBonusSelf: "5", guardBonusSelf: "3", ...extra } });
const usage = (extra = {}) => ({ settingsVersion: 1, type: "physicalAttack", skillRefs: [{ itemId: "s" }], ...extra });
const categories = selected => Object.fromEntries(["physical", "mental", "social"].map(key => [key, selected.includes(key)]));
function actorOf(items) {
    items.get = id => items.find(item => item.id === id);
    return { id: "a", uuid: "Actor.a", system: {}, items, getRollData: () => ({}) };
}
let Flow, complete, Socket;
beforeAll(async () => {
    foundry.utils.deepClone = structuredClone;
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
    ({ completeReactionFromCheck: complete } = await import("../../scripts/flow/attack-flow.mjs"));
    ({ TnxSocketHandler: Socket } = await import("../../scripts/core/tnx-socket-handler.mjs"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Flow._context = null; });

describe("攻撃を行う系統とダメージ修正を提供する系統", () => {
    const patterns = [["壱の太刀", ["physical"]], ["†葉隠", ["physical", "mental"]],
        ["†ペンは剣よりも強し", ["mental", "social"]], ["†支配者の拳", ["physical", "mental", "social"]]];
    for (const [label, selected] of patterns) it.each(["physical", "mental", "social"])(`${label}の指定範囲: %s`, category => {
        // 技能名は説明だけに用い、実装には一切渡さない。
        const s = skill({ damageBonusCategories: categories(selected) });
        const local = usage({ type: `${category}Attack`, damageBonuses: [{ source: "supplier", formula: "7" }] });
        const before = structuredClone(local);
        const result = resolveUsageSettings(local, base, () => s);
        expect(result.contributions.damageBonuses).toHaveLength(selected.includes(category) ? 1 : 0);
        expect(result.effective.damageBonuses[0]).toMatchObject({ source: "supplier", formula: "7", origin: { kind: "usage" } });
        expect(local).toEqual(before);
        expect(styleSkillAttackType(s.system)).toBe("socialAttack");
    });
    it("未設定は全系統を維持、全チェックオフは供給なし、dealsDamageのゲートも維持", () => {
        expect(resolveUsageSettings(usage(), base, () => skill()).contributions.damageBonuses).toHaveLength(1);
        expect(resolveUsageSettings(usage(), base, () => skill({ damageBonusCategories: categories([]) })).contributions.damageBonuses).toEqual([]);
        expect(resolveUsageSettings(usage(), base, () => skill({ dealsDamage: false })).contributions.damageBonuses).toEqual([]);
        const schema = StyleSkillDataModel.defineSchema();
        for (const field of Object.values(schema.damageBonusCategories.fields)) expect(field.options.initial).toBe(true);
    });
    it("適用系統を絞っても対象条件と重複可を変えない", () => {
        const condition = { kind: "style", mode: "only", key: "target" };
        const s = skill({ damageBonusCategories: categories(["mental"]), damageBonusSelfCondition: condition, damageBonusSelfStackable: true });
        const result = resolveUsageSettings(usage({ type: "mentalAttack" }), base, () => s);
        expect(result.contributions.damageBonuses[0]).toMatchObject({ targetCondition: condition, stackable: true });
    });
});

describe("受け値の導出・保存境界・実行文脈", () => {
    it("リアクションにだけ受け値行を供給し、dealsDamageに依存しない", () => {
        const s = skill({ dealsDamage: false, guardBonusSelfStackable: true });
        for (const type of ["physicalAttack", "mentalAttack", "socialAttack", "check", "declaration"])
            expect(resolveUsageSettings(usage({ type }), base, () => s).contributions.guardBonuses).toEqual([]);
        const resolved = resolveUsageSettings(usage({ type: "reaction" }), base, () => s);
        expect(resolved.contributions.guardBonuses[0]).toMatchObject({ formula: "3", stackable: true, origin: { kind: "skill", itemId: "s" } });
    });
    it("重複参加・再解決・技能削除でも自動行が増殖せず手動行を保全", () => {
        const s = skill(), input = usage({ type: "reaction", baseSkillRef: { itemId: "s" },
            skillRefs: [{ itemId: "s" }, { itemId: "s" }], guardBonuses: [{ source: "supplier", formula: "3" }], guardBonusSelf: "2" });
        const before = structuredClone(input), first = resolveUsageSettings(input, base, () => s);
        expect(first.effective.guardBonuses.map(r => r.origin.kind)).toEqual(["usage", "skill"]);
        expect(resolveUsageSettings(first.effective, base, () => s)).toEqual(first);
        expect(resolveUsageSettings(input, base, () => null).effective.guardBonuses).toHaveLength(1);
        expect(input).toEqual(before);
        const old = { ...input, settingsVersion: 0 };
        expect(resolveUsageSettings(old, base, () => s).effective.guardBonuses).toEqual(old.guardBonuses);
    });
    it.each([false, true])("通常/再判定(%s)で追加と削除に追従し、入口修正と消費を保全", async isRecheck => {
        const s = skill(), actor = actorOf([base, s]);
        const input = usage({ type: "reaction", skillRefs: [], guardBonuses: [{ source: "supplier", formula: "4" }] });
        const initial = resolveUsageSettings(input, base).effective;
        const extra = { label: "入口の修正", formula: "-2" };
        vi.stubGlobal("game", { actors: new Map([[actor.id, actor]]) });
        const ctx = Flow._context = { type: "skillCheck", actorId: actor.id, sourceItemId: base.id, isRecheck,
            baseSkillIds: [base.id], dialogAddedSkillIds: [s.id], usageSettingsInput: input,
            checkBonuses: [...initial.checkBonuses, extra], baseConsumeUses: [{ itemId: "other", amount: 1 }],
            consumeUses: [{ itemId: "other", amount: 1 }], reaction: { mode: "parry", parryGuardBase: 8 } };
        await Flow._rebuildDialogSkillContext();
        expect(ctx.reaction.guardBonuses.map(r => r.formula)).toEqual(["4", "3"]);
        await Flow._rebuildDialogSkillContext();
        expect(ctx.checkBonuses.filter(r => r.label === extra.label)).toEqual([extra]);
        expect(ctx.reaction.guardBonuses).toHaveLength(2);
        ctx.dialogAddedSkillIds = [];
        await Flow._rebuildDialogSkillContext();
        expect(ctx.reaction.guardBonuses.map(r => r.formula)).toEqual(["4"]);
        expect(ctx.consumeUses).toEqual([{ itemId: "other", amount: 1 }]);
        expect(input.guardBonuses).toEqual([{ source: "supplier", formula: "4" }]);
    });
    it.each([["parry", true, 18, false], ["parry", true, 26, true], ["parry", false, 0, false], ["dodge", true, 0, false], ["reaction", true, 0, false]])(
        "実際の完了処理: mode=%s、成立=%sの受け値は%s", async (mode, established, expected, stackable) => {
            vi.stubGlobal("Roll", class {
                constructor(formula, data) { this.isDeterministic = true; this.formula = formula.replace(/@([a-zA-Z0-9_.]+)/g,
                    (_, path) => String(path.split(".").reduce((o, k) => o?.[k], data))); }
                async evaluate() { this.total = Number(this.formula); }
            });
            const weapon = { id: "w", uuid: "Item.w", name: "Blade", type: "weapon",
                system: { identificationKey: "blade", guardValue: { mode: "value", value: 6, total: 8 } } };
            const s = skill({ guardBonusSelf: "@outfit.blade.guard.value", guardBonusSelfStackable: stackable });
            const actor = actorOf([base, s, weapon]);
            const input = usage({ type: "reaction", weaponRefs: [{ itemId: "w" }], guardBonuses: [{ source: "supplier", formula: "2" }, { source: "supplier", formula: "@outfit.blade.guard.value" }] });
            const resolved = resolveUsageSettings(input, base, id => actor.items.get(id)).effective;
            const snapshot = buildParryGuardSnapshot(actor, resolved, base);
            const active = { achievement: 30, openReactions: [] };
            const message = { getFlag: () => active };
            vi.stubGlobal("game", { messages: new Map([["attack", message]]) });
            vi.stubGlobal("fromUuid", async () => actor);
            const patch = vi.spyOn(Socket, "applyMessagePatch").mockResolvedValue(undefined);
            await complete({ mode, open: true, attackMessageId: "attack", reactorUuid: actor.uuid,
                guardBonusSourceItemId: base.id, guardBonuses: resolved.guardBonuses, parryGuardBase: snapshot.base },
            { achievement: 10, fumble: !established });
            expect(patch.mock.calls[0][1].openReactions[0].parryGuard).toBe(expected);
        });
});
