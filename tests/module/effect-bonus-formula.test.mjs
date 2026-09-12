import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectActorEffectBuffs, gatherCheckBonusSources, gatherDamageDealtSources,
  gatherDamageVsSources, gatherDamageTakenSources,
} from "../../scripts/data/item/helpers.mjs";
import { createEffectBonusEvaluator } from "../../scripts/rules/tnx-formula.mjs";
import { calcSkillCheck } from "../../scripts/rules/tnx-check-engine.mjs";

// Foundry 境界だけを代替。収集→式データ構築→集計→達成値計算は実コードを使う。
beforeEach(() => vi.stubGlobal("Roll", class {
  constructor(formula, data) {
    this.isDeterministic = !/\d+d\d+/i.test(formula);
    this.formula = formula.replace(/@([a-z.0-9_-]+)/gi, (_, path) => {
      const value = path.split(".").reduce((obj, key) => obj?.[key], data);
      if (typeof value !== "number") throw new Error(`Missing numeric reference: ${path}`);
      return String(value);
    });
  }
  evaluateSync() {
    this.total = this.formula.split("+").reduce((sum, value) => sum + Number(value.trim()), 0);
  }
}));
afterEach(() => vi.unstubAllGlobals());

function effect(key, value, extra = {}) {
  return { id: "bonus", name: "栄華", active: true, transfer: true, changes: [{ key, value }], ...extra };
}

function fixture(key = "check.all", value = "@item.eika.system.levelTotal") {
  const skill = { id: "eika", documentName: "Item", system: { identificationKey: "eika", level: 3, levelTotal: 5 }, effects: [] };
  // v13 標準の getRollData は system 自体を返す。
  skill.getRollData = () => skill.system;
  const actor = { documentName: "Actor", system: { reason: { total: 4 } }, items: [skill], effects: [effect(key, value)] };
  actor.getRollData = () => actor.system;
  return { actor, skill };
}

function checkSources(actor) {
  return gatherCheckBonusSources(collectActorEffectBuffs(actor), { type: "ability", ability: "reason" }, createEffectBonusEvaluator(actor));
}

describe("AE の効果値の式を実行時ボーナスへ反映する", () => {
  it("eika の実効レベル5をボーナス・内訳・達成値に加える", () => {
    const { actor } = fixture();
    const sources = checkSources(actor);
    expect(sources).toEqual([{ name: "栄華", value: 5 }]);
    const result = calcSkillCheck({ cardCheckValue: 7, suit: "spade",
      abilitiesCtx: { reason: { totalValue: 4 } }, checkBonus: sources.reduce((sum, row) => sum + row.value, 0) });
    expect(result.checkBonus).toBe(5);
    expect(result.achievement).toBe(16);
    expect(actor.effects[0].changes[0].value).toBe("@item.eika.system.levelTotal");
  });

  it("式・数値の行を合計してから、同一効果を重複排除する", () => {
    const { actor } = fixture();
    actor.effects[0].changes.push({ key: "check.reason", value: "2" });
    actor.effects.push(effect("check.all", "6"));
    expect(checkSources(actor)).toEqual([{ name: "栄華", value: 7 }]);
  });

  it("アイテム効果の self / parent はその効果の保持元と準備先を参照する", () => {
    const { actor, skill } = fixture();
    actor.effects = [];
    const option = { id: "opt", documentName: "Item", system: { levelTotal: 2, parentItemId: skill.id }, effects: [] };
    const bonus = effect("check.all", "@item.self.system.levelTotal + @item.parent.system.levelTotal");
    bonus.parent = option;
    option.effects.push(bonus);
    actor.items.push(option);
    actor.items.get = (id) => actor.items.find(item => item.id === id);
    expect(checkSources(actor)).toEqual([{ name: "栄華", value: 7 }]);
    bonus.transfer = false;
    expect(checkSources(actor)).toEqual([]);
  });

  it("無効化・対象外の効果は式を評価しない", () => {
    const { actor } = fixture();
    actor.effects[0].active = false;
    actor.effects.push(effect("check.passion", "@item.eika.system.levelTotal"));
    const evaluate = vi.fn(createEffectBonusEvaluator(actor));
    expect(gatherCheckBonusSources(collectActorEffectBuffs(actor), { type: "ability", ability: "reason" }, evaluate)).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each(["@item.missing.system.levelTotal", "1d6", "自由文"])("評価できない値 %s は従来どおり0扱い", (value) => {
    const { actor } = fixture("check.all", value);
    expect(checkSources(actor)).toEqual([{ name: "栄華", value: 0 }]);
  });

  it("与えるダメージ・対象限定ボーナス・受けるダメージ軽減にも同じ式評価を使う", () => {
    const { actor } = fixture("damage.dealt.physical");
    actor.effects.push(effect("damage.vsStyle.kabuto", "@item.eika.system.levelTotal", { id: "vs" }));
    actor.effects.push(effect("damage.taken.physical", "-@item.eika.system.levelTotal", { id: "taken" }));
    const effects = collectActorEffectBuffs(actor);
    const evaluate = createEffectBonusEvaluator(actor);
    expect(gatherDamageDealtSources(effects, "physical", evaluate)).toEqual([{ name: "栄華", value: 5 }]);
    expect(gatherDamageVsSources(effects, { styles: ["kabuto"] }, evaluate)).toEqual([{ name: "栄華", value: 5 }]);
    expect(gatherDamageTakenSources(effects, { category: "physical" }, evaluate)).toEqual([{ name: "栄華", value: -5 }]);
  });
});
