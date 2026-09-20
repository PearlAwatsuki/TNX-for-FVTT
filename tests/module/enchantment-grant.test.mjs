import { afterEach, describe, it, expect, vi } from "vitest";
import { applyEnchantmentGrant } from "../../scripts/flow/usage-effects.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

afterEach(() => vi.unstubAllGlobals());

function setup() {
    const source = { uuid: "Actor.source", documentName: "Actor", testUserPermission: vi.fn(() => true) };
    const entry = { name: "付与", data: { type: "enchantment", transfer: false, system: { changes: [{ key: "system.attack.value", type: "add", value: "2" }] }, flags: { [SYSTEM_ID]: { effectId: "e", stackable: true, applyToSelf: true } } }, enchantment: { mode: "drop", sourceItemUuid: "Actor.source.Item.skill" } };
    const flags = { usageEffects: { sourceActorUuid: source.uuid, effects: [entry], targets: [] } };
    const message = { id: "m", uuid: "ChatMessage.m", isOwner: true, getFlag: (_scope, key) => flags[key], setFlag: vi.fn(async (_scope, key, value) => { flags[key] = value; }) };
    const item = { uuid: "Actor.target.Item.w", documentName: "Item", type: "weapon", name: "武器", parent: { documentName: "Actor" }, isOwner: true, effects: [] };
    item.createEmbeddedDocuments = vi.fn(async (_type, data) => { item.effects.push(...data); return data; });
    const other = { ...item, uuid: "Actor.target.Item.other", effects: [], createEmbeddedDocuments: vi.fn() };
    const users = new Map([["gm", { id: "gm", isGM: true }], ["pl", { id: "pl", isGM: false }]]);
    users.activeGM = users.get("gm");
    vi.stubGlobal("game", { user: users.get("gm"), users, messages: new Map([["m", message]]) });
    vi.stubGlobal("foundry", { ...foundry, utils: { ...foundry.utils, deepClone: structuredClone } });
    const documents = new Map([[source.uuid, source], [item.uuid, item], [other.uuid, other]]);
    vi.stubGlobal("fromUuid", vi.fn(async uuid => documents.get(uuid)));
    return { source, entry, flags, item, other, message, documents };
}

describe("用途カードからのアウトフィット付与", () => {
    it("所持アウトフィット1個へV14の変更内容を保持して付与する", async () => {
        const s = setup();
        expect(await applyEnchantmentGrant("m", s.item.uuid, "pl")).toBe(true);
        expect(s.item.effects[0].system.changes).toEqual(s.entry.data.system.changes);
        expect(s.flags.enchantmentTarget.uuid).toBe(s.item.uuid);
    });
    it("同じカードの再ドロップは重複可AEでも二重作成しない", async () => {
        const s = setup();
        await Promise.all([applyEnchantmentGrant("m", s.item.uuid, "pl"), applyEnchantmentGrant("m", s.item.uuid, "pl")]);
        expect(s.item.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    });
    it("別のアウトフィットへ二度目の付与はできない", async () => {
        const s = setup();
        await applyEnchantmentGrant("m", s.item.uuid, "pl");
        expect(await applyEnchantmentGrant("m", s.other.uuid, "pl")).toBe(false);
        expect(s.other.createEmbeddedDocuments).not.toHaveBeenCalled();
    });
    it.each(["world", "skill"])("%sへの付与を拒否", async kind => {
        const s = setup();
        if (kind === "world") s.item.parent = null;
        else s.item.type = "generalSkill";
        expect(await applyEnchantmentGrant("m", s.item.uuid, "pl")).toBe(false);
        expect(s.message.setFlag).not.toHaveBeenCalled();
        expect(s.item.createEmbeddedDocuments).not.toHaveBeenCalled();
    });
    it("行為者を操作できない要求者を拒否", async () => {
        const s = setup();
        s.source.testUserPermission.mockReturnValue(false);
        expect(await applyEnchantmentGrant("m", s.item.uuid, "pl")).toBe(false);
        expect(s.item.createEmbeddedDocuments).not.toHaveBeenCalled();
    });
    it("準備先指定は供給元の準備先へ解決する", async () => {
        const s = setup();
        s.entry.enchantment.mode = "parent";
        s.documents.set(s.entry.enchantment.sourceItemUuid, { system: { parentItemId: "host" }, actor: { items: new Map([["host", s.item]]) } });
        expect(await applyEnchantmentGrant("m", null, "pl")).toBe(true);
        expect(s.item.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    });
});
