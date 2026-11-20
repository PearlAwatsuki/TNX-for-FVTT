import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

vi.mock("../../scripts/flow/usage-check-context.mjs", async original => ({ ...await original(),
    buildUsageCheckContext: vi.fn(async (actor, item, usage) => ({ actorId: actor.id, type: "skillCheck",
        skillIds: [item.id, ...(usage.skillRefs ?? []).map(r => r.itemId)], sourceItemId: item.id,
        sourceUsageId: usage._id, usageType: usage.type })) }));
vi.mock("../../scripts/session/vehicle-state.mjs", async original => ({ ...await original(),
    ghostCanInteract: () => true, preparedVehicle: () => null }));
let activate, Flow, Sheet;
const { DialogV2 } = foundry.applications.api;
beforeAll(async () => {
    foundry.utils.deepClone = structuredClone;
    foundry.applications.api.ApplicationV2 = class {};
    foundry.applications.api.HandlebarsApplicationMixin = Base => Base;
    foundry.applications.sheets = { ...foundry.applications.sheets, ItemSheetV2: class {} };
    ({ activateItemCheck: activate } = await import("../../scripts/flow/item-activation.mjs"));
    ({ TnxCheckFlow: Flow } = await import("../../scripts/flow/tnx-check-flow.mjs"));
    ({ TokyoNovaItemSheet: Sheet } = await import("../../scripts/item/tnx-item-sheet.mjs"));
});
beforeEach(() => {
    vi.stubGlobal("game", { system: { id: "tokyo-nova-axleration" }, messages: new Map(), actors: new Map(), packs: new Map() });
    vi.spyOn(Flow, "open").mockResolvedValue(undefined);
    vi.spyOn(ui.notifications, "warn");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Flow._context = null; });
const use = (id, extra = {}) => ({ _id: id, type: "reaction", name: id, settingsVersion: 1, ...extra });
function fixture(actions = [use("reaction")]) {
    const item = { id: "base", type: "generalSkill", name: "Base", isOwner: true, system: {
        isAction: true, identificationKey: "base", actionQualifications: ["dodge", "parry"], level: 1,
        suits: { spade: true }, actions }, update: vi.fn(async patch => Object.assign(item.system,
            { actionQualifications: patch["system.actionQualifications"] })) };
    const items = [item]; items.get = id => items.find(s => s.id === id); items.has = id => !!items.get(id);
    const actor = { id: "actor", items, system: {}, type: "cast" };
    game.actors.set(actor.id, actor);
    return { actor, item, reaction: { mode: "dodge", confrontation: [{ value: "dodge" }] } };
}

describe("リアクション用途の起動とダイアログ操作", () => {
    it("1件なら自動選択し、攻撃・非表示用途を候補に混ぜない", async () => {
        const { actor, item, reaction } = fixture([use("attack", { type: "physicalAttack" }), use("hidden", { hideFromUsageSelection: true }), use("visible")]);
        const wait = vi.spyOn(DialogV2, "wait");
        await activate(actor, item, { reaction });
        expect(wait).not.toHaveBeenCalled();
        expect(Flow.open).toHaveBeenCalledWith(expect.objectContaining({ sourceUsageId: "visible", reaction }));
    });
    it("複数用途は用途だけを選択し、選んだ手段を変更しない", async () => {
        const { actor, item, reaction } = fixture([use("first"), use("second"), use("check", { type: "check" })]);
        vi.spyOn(DialogV2, "wait").mockImplementationOnce(async config => {
            expect(config.buttons.map(b => b.label)).toEqual(["first", "second", "キャンセル"]);
            return config.buttons[1].callback();
        });
        await activate(actor, item, { reaction });
        expect(Flow.open).toHaveBeenCalledWith(expect.objectContaining({ sourceUsageId: "second", reaction }));
    });
    it.each([false, null])("用途選択を中止(%s)すると起動しない", async cancel => {
        const { actor, item, reaction } = fixture([use("first"), use("second")]);
        vi.spyOn(DialogV2, "wait").mockResolvedValueOnce(cancel);
        await activate(actor, item, { reaction });
        expect(Flow.open).not.toHaveBeenCalled();
    });
    it("直接指定では非表示用途も使用できるが、他種用途は起動しない", async () => {
        const { actor, item, reaction } = fixture([use("hidden", { hideFromUsageSelection: true }), use("attack", { type: "physicalAttack" })]);
        await activate(actor, item, { reaction, usageId: "hidden" });
        expect(Flow.open).toHaveBeenCalledOnce();
        await activate(actor, item, { reaction, usageId: "attack" });
        expect(Flow.open).toHaveBeenCalledOnce();
    });
    it("統合用途でもパリー文脈だけが受け値を取得する", async () => {
        const { actor, item } = fixture();
        actor.system.unarmed = { guard: { mode: "value", value: 4 } };
        await activate(actor, item, { reaction: { mode: "parry", confrontation: [{ value: "parry" }] } });
        expect(Flow.open).toHaveBeenCalledWith(expect.objectContaining({ reaction: expect.objectContaining({ mode: "parry", parryWeapons: expect.any(Array) }) }));
        Flow.open.mockClear();
        await activate(actor, item, { reaction: { mode: "dodge", confrontation: [{ value: "dodge" }] } });
        const ctx = Flow.open.mock.calls[0][0];
        expect(ctx.reaction.mode).toBe("dodge");
        expect(ctx.reaction).not.toHaveProperty("parryWeapons");
    });
    it("組み合わせ追加で実行可能となり、削除すれば実行前に止める", async () => {
        const { actor, item, reaction } = fixture();
        item.system.actionQualifications = ["parry"];
        const grant = { id: "grant", type: "styleSkill", system: { identificationKey: "grant", level: 1, isAction: false,
            actionQualifications: ["dodge"], suits: { spade: true }, comboSkill: [{ value: "skillName", name: "base" }] } };
        actor.items.push(grant);
        const ctx = { actorId: actor.id, sourceItemId: item.id, sourceUsageId: "reaction", skillIds: [item.id], reaction };
        Flow._context = ctx;
        expect(await Flow.executeFromHand("never-consumed")).toBe(false);
        expect(Flow._context).toBe(ctx);
        ctx.skillIds.push(grant.id);
        expect(Flow._reactionBlockReason(ctx)).toBeNull();
        ctx.skillIds.pop();
        expect(await Flow.executeFromDeck()).toBe(false);
    });
    it("固定値リアクションも実参加資格を検証し、不足時は結果を投稿しない", async () => {
        const { actor, item, reaction } = fixture([use("fixed", { fixedResult: 12 })]);
        item.system.actionQualifications = ["parry"];
        actor.items.push({ id: "grant", type: "styleSkill", system: { identificationKey: "grant", level: 1,
            isAction: false, actionQualifications: ["dodge"], suits: { spade: true } } });
        const create = vi.fn();
        vi.stubGlobal("ChatMessage", { create, getSpeaker: () => ({}) });
        await activate(actor, item, { reaction });
        expect(create).not.toHaveBeenCalled();
        expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("組み合わせ"));
    });
    it("旧リアクションカードのAE照合は能動側カードの分類を参照する", () => {
        const { actor, item } = fixture();
        game.messages.set("attack", { getFlag: () => ({ usageType: "mentalAttack", category: "mental",
            confrontation: [{ value: "mentalReaction" }, { value: "socialReaction" }] }) });
        const ctx = { type: "skillCheck", skillIds: [item.id], usageType: "reaction",
            reaction: { mode: "reaction", attackMessageId: "attack" } };
        expect(Flow._checkCriteria(actor, ctx, "reason").reactionCheckTypes).toEqual(["reaction", "mentalReaction"]);
        expect(ctx.reaction).not.toHaveProperty("activeUsageType");
        ctx.reaction.mode = "parry";
        expect(Flow._checkCriteria(actor, ctx, "reason").reactionCheckTypes).toEqual(["reaction", "mentalReaction", "parry"]);
    });
    it("共通の資格編集UIはチェックを保持し、空選択を保存できる", async () => {
        const { item } = fixture();
        const sheet = { item, _isEditMode: true };
        vi.spyOn(DialogV2, "wait").mockImplementationOnce(async config => {
            const dom = new JSDOM(config.content);
            const inputs = [...dom.window.document.querySelectorAll("input")];
            expect(inputs).toHaveLength(6);
            expect(inputs.filter(i => i.checked).map(i => i.value)).toEqual(["dodge", "parry"]);
            for (const input of inputs) { input.checked = false; input.dispatchEvent(new dom.window.Event("change")); }
            const result = config.buttons[0].callback(null, null, { element: dom.window.document });
            dom.window.close();
            return result;
        });
        await Sheet._onEditActionQualifications.call(sheet);
        expect(item.update).toHaveBeenCalledWith({ "system.actionQualifications": [] });
    });
    it("資格編集のキャンセルは保存しない", async () => {
        const { item } = fixture();
        vi.spyOn(DialogV2, "wait").mockResolvedValueOnce(null);
        await Sheet._onEditActionQualifications.call({ item, _isEditMode: true });
        expect(item.update).not.toHaveBeenCalled();
    });
});
