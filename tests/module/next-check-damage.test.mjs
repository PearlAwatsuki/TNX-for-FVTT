import { describe, expect, it, vi } from "vitest";
import "../setup.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { captureNextCheckEffects } from "../../scripts/rules/next-check-expiry.mjs";

vi.mock("../../scripts/flow/attack-flow.mjs", () => ({ applyAttackPatch: vi.fn(async () => {}) }));
const { finalizeDamageRoll } = await import("../../scripts/flow/damage-flow.mjs");
const { applyAttackPatch } = await import("../../scripts/flow/attack-flow.mjs");

describe("攻撃の判定1回持続はダメージ算出完了で終了する", () => {
    it.each([false, true])("ダメージ結果の保存失敗=%sでの失効時点", async fail => {
        const data = { _id: "e", transfer: false, flags: { [SYSTEM_ID]: { tnxDuration: "nextCheck" } },
            system: { changes: [{ key: "system.damage.dealt", value: "5" }] } };
        const effect = { ...data, id: "e", toObject: () => structuredClone(data) };
        const effects = new Map([["e", effect]]);
        effects[Symbol.iterator] = effects.values.bind(effects);
        const order = [];
        const actor = { uuid: "Actor.a", effects, items: [], deleteEmbeddedDocuments: vi.fn(async () => { order.push("expire"); effects.clear(); }) };
        const snapshot = { actorUuid: actor.uuid, entries: captureNextCheckEffects(actor) };
        const oldChat = globalThis.ChatMessage;
        const oldHandlebars = foundry.applications.handlebars;
        foundry.applications.handlebars = { renderTemplate: vi.fn(async () => "damage") };
        globalThis.ChatMessage = { getSpeaker: () => ({}), create: vi.fn(async () => {
            order.push("save-damage");
            expect(effects.has("e")).toBe(true);
            if (fail) throw new Error("save failed");
        }) };
        applyAttackPatch.mockImplementation(async () => { order.push("mark-calculated"); });
        try {
            const action = finalizeDamageRoll({ attackMessage: { id: "m", getFlag: () => null },
                f: { nextCheckExpiry: snapshot }, attacker: actor, category: "physical", attackPower: 3,
                damageBonusRows: [{ name: "効果", value: 5 }], damageTargets: [], hitTargets: [] },
            { manualMod: 0 }, { value: 7 });
            if (fail) {
                await expect(action).rejects.toThrow("save failed");
                expect(order).toEqual(["save-damage"]);
                expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
            } else {
                await action;
                expect(order).toEqual(["save-damage", "mark-calculated", "expire"]);
                expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", ["e"]);
            }
        } finally {
            globalThis.ChatMessage = oldChat;
            foundry.applications.handlebars = oldHandlebars;
        }
    });
});
