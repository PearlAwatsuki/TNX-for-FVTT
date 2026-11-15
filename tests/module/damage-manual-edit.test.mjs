import { afterEach, describe, expect, it, vi } from "vitest";
import { canManageDamageResult, manualEditDamage } from "../../scripts/flow/damage-flow.mjs";
import { TnxSocketHandler } from "../../scripts/core/tnx-socket-handler.mjs";
import { AmountInputDialog } from "../../scripts/ui/tnx-dialog.mjs";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(owner, isGM = false) {
    const actors = new Map(["a", "b", "c"].map(id => [id, { id, isOwner: id === owner, system: {}, items: [], effects: [] }]));
    vi.stubGlobal("game", { user: { isGM } });
    vi.stubGlobal("fromUuidSync", uuid => actors.get(uuid));
    foundry.utils.deepClone = structuredClone;
    const f = { category: "mental", attackerUuid: "a", cards: [{ value: 10 }], mods: [],
        targets: [{ uuid: "b", name: "B", mods: [] }, { uuid: "c", name: "C", mods: [] }] };
    const message = { getFlag: () => f };
    const patch = vi.spyOn(TnxSocketHandler, "applyMessagePatch").mockResolvedValue();
    const prompt = vi.spyOn(AmountInputDialog, "prompt").mockResolvedValue({ value: -2 });
    return { f, message, patch, prompt, actors };
}
describe("damage correction permissions and scope", () => {
    it("allows the attacker to edit the shared amount", async () => {
        const { message, patch } = fixture("a");
        expect(canManageDamageResult(message)).toBe(true);
        await manualEditDamage(message);
        expect(patch.mock.calls[0][1]).toEqual({ mods: [{ label: "手動修正", value: -2 }] });
    });
    it("allows a defender to edit only their target row", async () => {
        const { message, patch, prompt } = fixture("b");
        await manualEditDamage(message);
        expect(prompt.mock.calls[0][0].title).toContain("Bへのダメージ");
        expect(patch.mock.calls[0][1].mods).toBeUndefined();
        expect(patch.mock.calls[0][1].targets.map(t => t.mods)).toEqual([[{ label: "手動修正", value: -2 }], []]);
    });
    it("rejects unrelated players before prompting", async () => {
        const { message, patch, prompt } = fixture("none");
        expect(canManageDamageResult(message)).toBe(false);
        await manualEditDamage(message);
        expect(prompt).not.toHaveBeenCalled();
        expect(patch).not.toHaveBeenCalled();
    });
    it("lets RL choose a specific target and override its displayed value", async () => {
        const { message, patch, prompt } = fixture("none", true);
        foundry.utils.escapeHTML = s => s;
        foundry.applications.api.DialogV2 = { wait: vi.fn().mockResolvedValue({ index: 1 }) };
        prompt.mockResolvedValue({ value: 3, override: true });
        await manualEditDamage(message);
        expect(patch.mock.calls[0][1].targets[1].mods[0]).toMatchObject({ value: -7, overrideTo: 3 });
        expect(patch.mock.calls[0][1].targets[0].mods).toEqual([]);
    });
    it("rechecks permission after the input dialog", async () => {
        const { message, patch, prompt, actors } = fixture("b");
        prompt.mockImplementation(async () => { actors.get("b").isOwner = false; return { value: -2 }; });
        await manualEditDamage(message);
        expect(patch).not.toHaveBeenCalled();
    });
});
