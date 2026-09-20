import { describe, expect, it } from "vitest";
import { canonicalFormulaReference, formulaReferenceKeys, selectFormulaContributions, appendFormulaContribution } from "../../scripts/rules/formula-duplicates.mjs";
const actor = { uuid: "Actor.a", items: [] };
const row = (formula, value, stackable = false) => ({ name: formula, value, stackable, referenceKeys: formulaReferenceKeys(formula, { actor }) });
describe("式の直接参照の重複不可", () => {
    it("基礎生命・カードに重複する式を全体ごと外す", () => {
        const result = selectFormulaContributions([row("@abilities.life.value + 3", 10), row("@card + 5", 12), row("3", 3)], {
            baseline: [canonicalFormulaReference("system.life.total", { actor }), canonicalFormulaReference("check.card", { actor })],
        });
        expect(result.total).toBe(3);
        expect(result.sources.map(s => s.value)).toEqual([0, 0, 3]);
        expect(result.sources[0].excludedValue).toBe(10);
    });
    it("用途・AEの順序によらず最も有利な式を採る", () => {
        for (const rows of [[row("@abilities.life.value+3", 8), row("@system.life.total+5", 10)], [row("@system.life.total+5", 10), row("@abilities.life.value+3", 8)]]) {
            expect(selectFormulaContributions(rows).total).toBe(10);
        }
    });
    it("差分値の内部にある生命は展開せず、直接の差分値だけ照合する", () => {
        const result = selectFormulaContributions([row("@check.margin", 7), row("@abilities.life.value", 5), row("@diff + 1", 8)]);
        expect(result.total).toBe(13);
        expect(result.sources[0].value).toBe(0);
    });
    it("重複可は指定欄だけを例外とする", () => {
        const result = selectFormulaContributions([row("@card", 7, true), row("@check.card + 1", 8), row("@card+2", 9)]);
        expect(result.total).toBe(16);
        expect(result.sources[1].value).toBe(0);
    });
    it("不採用式の競合しないキーは予約しない", () => {
        const result = selectFormulaContributions([row("@card+@abilities.life.value", 12), row("@abilities.life.value", 5)], { baseline: ["check:card"] });
        expect(result.total).toBe(5);
    });
    it("同じ数値でも別Actorの参照は別物", () => {
        const self = formulaReferenceKeys("@abilities.life.value", { actor });
        const target = formulaReferenceKeys("@target.abilities.life.value", { actor, target: { uuid: "Actor.b" } });
        expect(self).not.toEqual(target);
        expect(formulaReferenceKeys("@target.system.life.total", { actor, target: actor })).toEqual(self);
    });
    it("技能の新キーと同じ技能への旧相対参照を照合する", () => {
        const skill = { uuid: "Actor.a.Item.s", type: "generalSkill", system: { identificationKey: "melee" } };
        const owner = { ...actor, items: [skill] };
        expect(formulaReferenceKeys("@item.self.system.levelTotal", { actor: owner, bearer: skill }))
            .toEqual(formulaReferenceKeys("@skill.melee.level", { actor: owner }));
    });
    it("被ダメージ修正は最も低い修正値が有利", () => {
        expect(selectFormulaContributions([row("-@abilities.life.value", -5), row("-@system.life.total - 3", -8)], { pick: "min" }).total).toBe(-8);
    });
    it("事後に有利な式が追加されたら差額だけを加える", () => {
        const first = selectFormulaContributions([row("@abilities.life.value+3", 8)]);
        const added = appendFormulaContribution({ baseline: [], sources: first.sources }, row("@system.life.total+5", 10));
        expect(added.delta).toBe(2);
        expect(added.snapshot.sources.map(s => s.value)).toEqual([0, 10]);
        const smaller = appendFormulaContribution(added.snapshot, row("@abilities.life.value+1", 6));
        expect(smaller.delta).toBe(0);
    });
});
