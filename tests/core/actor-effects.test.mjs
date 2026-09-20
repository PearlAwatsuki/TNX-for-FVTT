import { afterEach, describe, expect, it, vi } from "vitest";
import { TokyoNovaActor } from "../../scripts/core/actor.mjs";
import { collectActorEffectBuffs, buildTransferredEffectData } from "../../scripts/data/item/helpers.mjs";
import { EffectsSheetMixin } from "../../scripts/ui/effects-sheet-mixin.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

afterEach(() => vi.restoreAllMocks());

describe("準備先への効果はアクターへ転送しない", () => {
    function setup() {
        const actor = Object.create(TokyoNovaActor.prototype);
        const item = { documentName: "Item", system: { parentItemId: "host" }, effects: [] };
        const own = { id: "own", active: true, flags: {} };
        const ordinary = { id: "ordinary", parent: item, transfer: true, active: true, flags: {} };
        const parentEffect = { id: "parent", uuid: "Item.source.ActiveEffect.parent", parent: item,
            transfer: true, active: true, statuses: new Set(["poison"]),
            flags: { [SYSTEM_ID]: { applyToParent: true } },
            changes: [{ key: "system.attack.value", value: "3", mode: 2 },
                { key: "check.all", value: "7", mode: 2 }] };
        item.effects = [ordinary, parentEffect];
        actor.effects = [own];
        actor.items = [item];
        // Foundry の標準列挙: アクター自身と transfer オンの所持アイテム効果。
        Object.defineProperty(Actor.prototype, "allApplicableEffects", { configurable: true,
            value: function* () {
                yield* this.effects;
                for (const it of this.items) for (const e of it.effects) if (e.transfer) yield e;
            } });
        return { actor, item, own, ordinary, parentEffect };
    }

    afterEach(() => { delete Actor.prototype.allApplicableEffects; });

    it("標準適用・ステータス収集・シート一覧に準備先向け効果を含めない", () => {
        const { actor, own, ordinary, parentEffect } = setup();
        expect([...actor.allApplicableEffects()]).toEqual([own, ordinary]);
        const statuses = new Set([...actor.allApplicableEffects()].flatMap(e => [...(e.statuses ?? [])]));
        expect(statuses.has("poison")).toBe(false);
        const context = {};
        EffectsSheetMixin.prepareEffectsContext(actor, context);
        expect(context.allEffects).toEqual([own, ordinary]);
        expect(parentEffect.transfer).toBe(true);
    });

    it("自身に適用する付与AEもアクターへ転送しない", () => {
        const { actor, ordinary } = setup();
        ordinary.type = "enchantment";
        ordinary.flags = { [SYSTEM_ID]: { applyToSelf: true } };
        expect([...actor.allApplicableEffects()]).not.toContain(ordinary);
        expect(collectActorEffectBuffs(actor).some(e => e.identity === ordinary.id)).toBe(false);
    });

    it("判定等の独自収集からも除外し、チェック解除時は通常転送へ戻る", () => {
        const { actor, parentEffect } = setup();
        expect(collectActorEffectBuffs(actor).map(e => e.identity)).toEqual(["own", "ordinary"]);
        parentEffect.flags[SYSTEM_ID].applyToParent = false;
        expect([...actor.allApplicableEffects()]).toContain(parentEffect);
        expect(collectActorEffectBuffs(actor).map(e => e.identity)).toContain("parent");
    });

    it("準備先への性能補正コピーは引き続き作れ、アクター向け変更は混ざらない", () => {
        const { item, parentEffect } = setup();
        const copy = buildTransferredEffectData(parentEffect, { id: "host" }, item);
        expect(copy.transfer).toBe(false);
        expect(copy.changes).toEqual([{ key: "system.attack.value", value: "3", mode: 2 }]);
        expect(copy.flags[SYSTEM_ID].transferredFrom).toBe(parentEffect.uuid);
        expect(buildTransferredEffectData(parentEffect, { id: "other" }, item)).toBeNull();
    });
});
