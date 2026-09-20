import { describe, it, expect } from "vitest";
import { normalizeEffectKindData, enchantmentAppliesToSelf } from "../../scripts/rules/ae-kind.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { collectActorEffectBuffs, buildTransferredEffectData } from "../../scripts/data/item/helpers.mjs";
import { getConditionKinds } from "../../scripts/rules/conditions.mjs";
import { buildGrantedEffectDataFrom } from "../../scripts/flow/usage-effects.mjs";

const make = (flags, transfer = true) => ({ type: "enchantment", transfer, flags: { [SYSTEM_ID]: flags } });

describe("アウトフィット付与AE", () => {
    it("自動適用は片方必須で、両方オンも拒否", () => {
        expect(() => normalizeEffectKindData(make({ applyToParent: false, applyToSelf: false }))).toThrow();
        expect(() => normalizeEffectKindData(make({ applyToParent: true, applyToSelf: true }))).toThrow();
        expect(normalizeEffectKindData(make({ applyToParent: true, applyToSelf: false })).flags[SYSTEM_ID].applyToParent).toBe(true);
    });
    it("自動適用オフは両方オフを保持する", () => {
        expect(normalizeEffectKindData(make({ applyToParent: false, applyToSelf: false }, false)).flags[SYSTEM_ID]).toMatchObject({ applyToParent: false, applyToSelf: false });
    });
    it("状態を除去し、持続・重複可・神業由来は保持する", () => {
        const source = { ...make({ applyToSelf: true, conditions: { poison: { magnitude: 3 } }, conditionKind: "poison", stackable: true, tnxDuration: "act", fromMiracle: true }), statuses: ["poison"] };
        const normalized = normalizeEffectKindData(source);
        expect(normalized.statuses).toEqual([]);
        expect(normalized.flags[SYSTEM_ID]).toMatchObject({ stackable: true, tnxDuration: "act", fromMiracle: true });
        expect(normalized.flags[SYSTEM_ID]).not.toHaveProperty("conditions");
        expect(source.statuses).toEqual(["poison"]);
        expect(getConditionKinds(source)).toEqual([]);
    });
    it("技能・アクターへ付与AEの自己適用を許さない", () => {
        const effect = make({ applyToSelf: true });
        expect(enchantmentAppliesToSelf(effect, { documentName: "Item", type: "weapon" })).toBe(true);
        expect(enchantmentAppliesToSelf(effect, { documentName: "Item", type: "generalSkill" })).toBe(false);
        expect(enchantmentAppliesToSelf(effect, { documentName: "Actor", type: "cast" })).toBe(false);
    });
    it("付与AEをアクターの判定補正やダメージ補正として収集しない", () => {
        const effect = { ...make({ applyToSelf: true }), id: "e", active: true, changes: [{ key: "system.check.all", value: "99" }] };
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
