import { describe, it, expect } from "vitest";

const { resolveUsageEffectData } = await import("../../scripts/module/usage-effects.mjs");

// toObject を持つ簡易 effect / effects コレクション
const mkEffect = (id, name) => ({ id, name, toObject: () => ({ _id: id, name, disabled: true, transfer: true }) });
const mkEffects = (effs) => ({ get: (id) => effs.find(e => e.id === id) ?? null });

describe("resolveUsageEffectData()（用途effects→付与用AEデータ・2026-07-10）", () => {
  const parentItem = { id: "parent1", effects: mkEffects([mkEffect("e_par", "毒")]) };
  const weapon = { id: "wep1", effects: mkEffects([mkEffect("e_wep", "呪い")]) };
  const actor = { items: { get: (id) => (id === "wep1" ? weapon : null) } };

  it("itemId 空＝親アイテムから効果を引く（disabled=false・transfer=false・_id除去）", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [{ itemId: "", effectId: "e_par" }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("毒");
    expect(out[0].data.disabled).toBe(false);
    expect(out[0].data.transfer).toBe(false);
    expect(out[0].data._id).toBeUndefined();
  });

  it("itemId 指定＝そのアイテム（使用武器など）から引く", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [{ itemId: "wep1", effectId: "e_wep" }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("呪い");
  });

  it("解決できない参照（effectId 空・見つからない）は捨てる", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [
      { itemId: "", effectId: "" },
      { itemId: "", effectId: "missing" },
      { itemId: "nope", effectId: "e_wep" },
    ] });
    expect(out).toEqual([]);
  });

  it("effects 無しは空配列", () => {
    expect(resolveUsageEffectData(actor, parentItem, {})).toEqual([]);
    expect(resolveUsageEffectData(actor, parentItem, { effects: [] })).toEqual([]);
  });
});
