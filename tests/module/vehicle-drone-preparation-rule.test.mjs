import { describe, expect, it, vi } from "vitest";
import { mustUnprepareForDroneAppearance, normalizeGhostOutfitPreparation } from "../../scripts/session/vehicle-state.mjs";
const item = (id, type, system = {}) => ({ id, type, system: { isPrepared: true, ...system } });
describe("ドローン登場時の準備制限", () => {
    it("搭載兵器は維持し、通常武器・生身武器・防具は解除対象にする", () => {
        expect(mustUnprepareForDroneAppearance(item("mounted", "weapon", { minorCategory: "mounted" }))).toBe(false);
        expect(mustUnprepareForDroneAppearance(item("weapon", "weapon", { minorCategory: "melee" }))).toBe(true);
        expect(mustUnprepareForDroneAppearance(item("flesh", "general", { isFleshChange: true }))).toBe(true);
        expect(mustUnprepareForDroneAppearance(item("cyborg", "cyborg", { minorCategory: "fullCyborg" }))).toBe(true);
        expect(mustUnprepareForDroneAppearance(item("armor", "armor"))).toBe(true);
    });
    it("武器と防具以外のアウトフィットは維持する", () => {
        expect(mustUnprepareForDroneAppearance(item("tap", "tap"))).toBe(false);
        expect(mustUnprepareForDroneAppearance(item("software", "general", { minorCategory: "software" }))).toBe(false);
        expect(mustUnprepareForDroneAppearance(item("cyber", "general", { majorCategory: "cyberware" }))).toBe(false);
        expect(mustUnprepareForDroneAppearance(item("psycho", "general", { minorCategory: "psychoApp" }))).toBe(false);
    });
    it("正規化では禁止対象だけを一括解除する", async () => {
        const rows = [
            item("drone", "vehicle", { minorCategory: "drone" }),
            item("mounted", "weapon", { minorCategory: "mounted" }),
            item("weapon", "weapon", { minorCategory: "melee" }),
            item("flesh", "general", { isFleshChange: true }),
            item("armor", "armor"),
            item("tap", "tap"),
        ];
        const actor = { items: rows, updateEmbeddedDocuments: vi.fn(async () => []) };
        const invalid = await normalizeGhostOutfitPreparation(actor, rows[0]);
        expect(invalid.map(i => i.id)).toEqual(["weapon", "flesh", "armor"]);
    });
});
