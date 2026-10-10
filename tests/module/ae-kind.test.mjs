import { describe, it, expect } from "vitest";
import { normalizeEffectKindData, enchantmentAppliesToSelf } from "../../scripts/rules/ae-kind.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { collectActorEffectBuffs, buildTransferredEffectData } from "../../scripts/data/item/helpers.mjs";
import { getConditionKinds } from "../../scripts/rules/conditions.mjs";
import { buildGrantedEffectDataFrom } from "../../scripts/flow/usage-effects.mjs";

const make = (flags, transfer = true) => ({ type: "enchantment", transfer, flags: { [SYSTEM_ID]: flags } });

describe("アウトフィット付与AE", () => {
    it("自動適用は準備先と指定対象の排他的な二択", () => {
        expect(() => normalizeEffectKindData(make({ applyToParent: false, applyToTarget: false }))).toThrow();
        expect(() => normalizeEffectKindData(make({ applyToParent: true, applyToTarget: true, targetItemId: "x" }))).toThrow();
        expect(normalizeEffectKindData(make({ applyToParent: true, applyToSelf: true })).flags[SYSTEM_ID]).toMatchObject({ applyToParent: true, applyToTarget: false, applyToSelf: false });
        expect(normalizeEffectKindData(make({ applyToTarget: true, targetItemId: "x" })).flags[SYSTEM_ID]).toMatchObject({ applyToParent: false, applyToTarget: true, targetItemId: "x", applyToSelf: false });
    });
    it("自動適用オフだけ自身適用を保持し、適用先は排他的", () => {
        expect(normalizeEffectKindData(make({ applyToSelf: true }, false)).flags[SYSTEM_ID].applyToSelf).toBe(true);
        expect(() => normalizeEffectKindData(make({ applyToParent: true, applyToSelf: true }, false))).toThrow();
    });
    it("状態を除去し、持続・重複可・神業由来は保持する", () => {
        const source = { ...make({ applyToParent: true, conditions: { poison: { magnitude: 3 } }, conditionKind: "poison", stackable: true, tnxDuration: "act", fromMiracle: true }), statuses: ["poison"] };
        const normalized = normalizeEffectKindData(source);
        expect(normalized.statuses).toEqual([]);
        expect(normalized.flags[SYSTEM_ID]).toMatchObject({ stackable: true, tnxDuration: "act", fromMiracle: true });
        expect(normalized.flags[SYSTEM_ID]).not.toHaveProperty("conditions");
        expect(source.statuses).toEqual(["poison"]);
        expect(getConditionKinds(source)).toEqual([]);
    });
    it("技能・アクターへ付与AEの自己適用を許さない", () => {
        const effect = make({ applyToSelf: true }, false);
        expect(enchantmentAppliesToSelf(effect, { documentName: "Item", type: "weapon" })).toBe(true);
        expect(enchantmentAppliesToSelf(effect, { documentName: "Item", type: "generalSkill" })).toBe(false);
        expect(enchantmentAppliesToSelf(effect, { documentName: "Actor", type: "cast" })).toBe(false);
    });
    it("付与AEをアクターの判定補正やダメージ補正として収集しない", () => {
        const effect = { ...make({ applyToParent: true }), id: "e", active: true, changes: [{ key: "system.check.all", value: "99" }] };
        expect(collectActorEffectBuffs({ effects: [effect], items: [{ effects: [effect] }] })).toEqual([]);
    });
    it("準備先コピーは付与AE型と元IDを保持", () => {
        const source = { ...make({ applyToParent: true }), id: "e", uuid: "Item.source.ActiveEffect.e", name: "効果", changes: [{ key: "system.attack.value", mode: 2, value: "3" }] };
        const copy = buildTransferredEffectData(source, { id: "host" }, { documentName: "Item", system: { parentItemId: "host" } });
        expect(copy).toMatchObject({ type: "enchantment", statuses: [], flags: { [SYSTEM_ID]: { applyToSelf: true, applyToParent: false, effectId: "e" } } });
    });
    it("V14の付与コピーに状態マーカーを追加せず、changesを保持", () => {
        const source = { ...make({ applyToParent: true, conditionKind: "poison" }), _id: "e", system: { changes: [{ key: "system.attack.value", type: "add", value: "3" }] } };
        const copy = buildGrantedEffectDataFrom(source, "Item.source.ActiveEffect.e");
        expect(copy.system.changes).toEqual(source.system.changes);
        expect(copy.statuses).toEqual([]);
        expect(copy.flags[SYSTEM_ID]).toMatchObject({ applyToSelf: true, applyToParent: false });
        expect(copy.flags[SYSTEM_ID]).not.toHaveProperty("conditionKind");
    });
});


describe("通常AEの準備ゲート", () => {
  const effect = { id: "e", active: true, transfer: true, flags: {}, changes: [{ key: "system.check.all", value: "1" }] };
  it("未準備アウトフィット由来を収集せず、準備済みと準備不要は収集する", () => {
    const actor = { effects: [], items: [
      { id: "off", uuid: "Item.off", type: "weapon", system: { isPrepared: false }, effects: [effect] },
      { id: "on", uuid: "Item.on", type: "weapon", system: { isPrepared: true }, effects: [{ ...effect, id: "e2" }] },
      { id: "free", uuid: "Item.free", type: "weapon", system: { isPrepared: false, noPrepareRequired: true }, effects: [{ ...effect, id: "e3" }] },
    ] };
    expect(collectActorEffectBuffs(actor).map(row => row.bearer.id)).toEqual(["on", "free"]);
  });
});
