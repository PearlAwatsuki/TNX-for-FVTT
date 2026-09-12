import { afterEach, describe, expect, it, vi } from "vitest";
import { TokyoNovaActiveEffect } from "../../scripts/core/active-effect.mjs";
import { CharacterBaseDataModel } from "../../scripts/data/actor/common/character-base.mjs";
import { buildFormulaData, evaluateFormulaSync } from "../../scripts/rules/tnx-formula.mjs";

afterEach(() => {
  delete ActiveEffect.prototype.apply;
  delete ActiveEffect.prototype.shouldApplyChange;
  delete ActiveEffect.applyChange;
  vi.unstubAllGlobals();
});

// Roll.replaceFormulaData と同じパス構文で置換する。欠損参照はテストを失敗させる。
// 評価は今回検証する数値加算のみ。Foundry の Roll 全体を模倣しない。
function installFormulaRoll() {
  vi.stubGlobal("Roll", class {
    isDeterministic = true;
    constructor(formula, data) {
      this.formula = formula.replace(/@([a-z.0-9_-]+)/gi, (_, path) => {
        const value = path.split(".").reduce((obj, key) => obj?.[key], data);
        if (value === null || value === undefined) throw new Error(`Missing formula data: ${path}`);
        return String(value);
      });
    }
    evaluateSync() {
      this.total = this.formula.split("+").reduce((sum, value) => sum + Number(value.trim()), 0);
    }
  });
}

describe("TNX ActiveEffect の v13 / v14 適用経路", () => {
  it("v14 の標準処理では TNX キーの式を評価せず、標準キーはコアに委譲する", () => {
    ActiveEffect.prototype.shouldApplyChange = vi.fn(() => true);
    const effect = new TokyoNovaActiveEffect();
    for (const key of ["system.attack.value", "system.ability.reason", "check.all", "name"]) {
      expect(effect.shouldApplyChange({ key, value: "@item.eika.system.levelTotal" }, { phase: "base" })).toBe(false);
    }
    expect(ActiveEffect.prototype.shouldApplyChange).not.toHaveBeenCalled();
    const change = { key: "system.handMaxSizeMod", value: "2" };
    expect(effect.shouldApplyChange(change, { phase: "base" })).toBe(true);
    expect(ActiveEffect.prototype.shouldApplyChange).toHaveBeenCalledWith(change, { phase: "base" });
  });

  it("v13 の評価済み数値は既存 apply へ渡し、Actor の名前は変更しない", () => {
    ActiveEffect.prototype.apply = vi.fn(() => ({ "system.life.total": 5 }));
    const effect = new TokyoNovaActiveEffect();
    const actor = new Actor();
    const change = { key: "system.life.total", mode: 2, value: "3" };
    expect(effect.apply(actor, change)).toEqual({ "system.life.total": 5 });
    expect(ActiveEffect.prototype.apply).toHaveBeenCalledWith(actor, change);
    expect(effect.apply(actor, { key: "name", value: "{}改" })).toEqual({});
    expect(ActiveEffect.prototype.apply).toHaveBeenCalledTimes(1);
  });

  it("v14 ではリテラルのレベル補正後に eika の式を評価し、実効攻撃力へ一度だけ適用する", () => {
    installFormulaRoll();
    ActiveEffect.applyChange = vi.fn((doc, change) => {
      const keys = change.key.split(".");
      const parent = keys.slice(0, -1).reduce((obj, key) => obj[key], doc);
      parent[keys.at(-1)] += Number(change.value);
      return { [change.key]: parent[keys.at(-1)] };
    });
    const makeEffect = (change) => Object.assign(new TokyoNovaActiveEffect(), {
      id: change.key, active: true, transfer: true, flags: {}, changes: [change],
    });
    const skill = { id: "s1", documentName: "Item", type: "styleSkill", effects: [],
      system: { identificationKey: "eika", level: 3, levelTotal: 3 } };
    const weapon = { id: "w1", documentName: "Item", type: "weapon", effects: [],
      system: { attack: { value: 4, total: 4 } } };
    const levelEffect = makeEffect({ key: "system.level", mode: 2, type: "add", value: "2" });
    const attackEffect = makeEffect({ key: "system.attack.value", mode: 2, type: "add",
      value: "@item.eika.system.levelTotal + 2" });
    levelEffect.parent = skill;
    attackEffect.parent = weapon;
    skill.effects.push(levelEffect);
    weapon.effects.push(attackEffect);
    const actor = { documentName: "Actor", effects: [], items: [weapon, skill], system: {} };
    const model = Object.create(CharacterBaseDataModel.prototype);
    model.parent = actor;
    model._applyEffectBuffs();
    expect(skill.system.levelTotal).toBe(5);
    expect(weapon.system.attack.total).toBe(11);
    expect(skill.system.level).toBe(3);
    expect(weapon.system.attack.value).toBe(4);
    expect(ActiveEffect.applyChange).toHaveBeenCalledTimes(2);
    expect(ActiveEffect.applyChange.mock.calls[1][1]).toMatchObject({
      key: "system.attack.total", type: "add", value: "7", effect: attackEffect,
    });
  });

  it.each(["eika", "01feeling", "style-x"])("式キー %s のレベル参照を解決する", (key) => {
    installFormulaRoll();
    const system = { life: { total: 4 } };
    const actor = { system, getRollData: () => system,
      items: [{ system: { identificationKey: key, levelTotal: 5 } }] };
    expect(evaluateFormulaSync(`@item.${key}.system.levelTotal + @system.life.total`, buildFormulaData(actor))).toBe(9);
  });
});
