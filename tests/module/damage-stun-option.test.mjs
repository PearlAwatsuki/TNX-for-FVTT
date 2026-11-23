import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
vi.mock("../../scripts/flow/attack-flow.mjs", () => ({ applyAttackPatch: vi.fn(async () => {}) }));
const { openDamageRollDialog, finalizeDamageRoll } = await import("../../scripts/flow/damage-flow.mjs");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("stun and persuasion as basic damage operations", () => {
    it.each([["physical", "スタン攻撃"], ["mental", "説得"], ["social", null]])(
        "shows the attack declaration in the damage dialog: %s", async (category, label) => {
            vi.stubGlobal("game", { user: { isGM: true } });
            vi.stubGlobal("fromUuid", vi.fn().mockResolvedValue(null));
            const f = { category, stunCapable: false, stunDeclared: true, targets: [] };
            const render = vi.fn().mockResolvedValue("");
            const original = foundry.applications.handlebars;
            foundry.applications.handlebars = { renderTemplate: render };
            foundry.applications.api.DialogV2 = { wait: vi.fn(async options => {
                // The same form reader is used by the deck button and the hand-card route.
                const dom = new JSDOM('<input name="stun" type="checkbox" checked>');
                const element = dom.window.document.body;
                expect(options.buttons[0].callback(null, null, { element }).stun).toBeUndefined();
                element.querySelector("input").checked = false;
                expect(options.buttons[0].callback(null, null, { element }).stun).toBeUndefined();
                dom.window.close();
                return false;
            }) };
            try {
                await openDamageRollDialog({ getFlag: () => f });
                expect(render.mock.calls[0][1]).toMatchObject({ declarationLabel: label });
            } finally { foundry.applications.handlebars = original; }
        }
    );
    it.each([
        ["physical", false, true, false], ["physical", true, false, true],
        ["mental", false, true, false], ["mental", true, false, true],
        ["social", false, true, false], ["physical", true, undefined, true],
    ])("keeps the attack declaration (%s, declared=%s, damage input=%s)", async (category, old, selected, expected) => {
        const create = vi.fn();
        vi.stubGlobal("ChatMessage", { create, getSpeaker: () => ({}) });
        const original = foundry.applications.handlebars;
        foundry.applications.handlebars = { renderTemplate: async () => "damage" };
        try {
            await finalizeDamageRoll({ attackMessage: { id: "m", getFlag: () => null },
                f: { stunCapable: false, stunDeclared: old }, attacker: null, category, attackPower: 0,
                damageBonusRows: [], damageTargets: [], hitTargets: [] },
            { manualMod: 0, stun: selected }, { value: 8 });
            expect(create.mock.calls[0][0].flags[SYSTEM_ID].damageRoll.stun).toBe(expected);
        } finally { foundry.applications.handlebars = original; }
    });
});
