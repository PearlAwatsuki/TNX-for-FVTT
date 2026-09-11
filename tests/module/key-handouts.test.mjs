import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../../scripts/ui/tnx-dialog.mjs", () => ({ confirmDialog: async () => true }));
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", () => ({ loadSkillChoices: async () => ({ kabuto: "カブト" }), STYLE_PACK: "styles" }));
vi.mock("../../scripts/session/handout-contact.mjs", () => ({ resolveHandoutContact: h => ({ type: "free", contactName: h.actConnection || "", itemUuid: "" }) }));
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { canReadKeyHandout, canPublishKeyHandout, keyHandoutFields, listKeyHandouts, getKeyHandoutRecord,
    distributeKeyHandout, publishKeyHandout, requestKeyHandoutPublication } from "../../scripts/session/key-handouts.mjs";
import { handoutDisplayTitle } from "../../scripts/rules/session.mjs";
let act, messages, users, persona;
beforeEach(() => {
    users = [{ id: "gm", isGM: true }, { id: "owner", name: "本人" }, { id: "other" }];
    users.get = id => users.find(u => u.id === id); users.activeGM = users[0];
    persona = { id: "ho", userId: "owner", ps: "ペルソナPS", keyHandout: {
        content: "秘密の本文", disclosure: "条件", recommendedTiming: "時期", ps: "混入禁止" } };
    const deliveries = {};
    act = { id: "act", getFlag: (_s, k) => k === "useKeyHandouts" ? true : k === "handouts" ? [persona] : deliveries,
        setFlag: vi.fn(async (_s, key, value) => { deliveries[key.split(".")[1]] = structuredClone(value); }) };
    messages = []; messages.get = id => messages.find(m => m.id === id);
    vi.stubGlobal("game", { user: users[0], users, journal: { get: () => act }, messages, socket: { emit: vi.fn() } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    vi.stubGlobal("JournalEntry", { create: vi.fn() });
    vi.stubGlobal("ChatMessage", { create: vi.fn(async input => {
        const flags = input.flags?.[SYSTEM_ID] ?? {};
        const message = { id: "msg", ...input, getFlag: (_s, key) => flags[key], update: vi.fn(async patch => {
            Object.assign(message, patch);
            if (patch[`flags.${SYSTEM_ID}.keyHandout.published`]) flags.keyHandout.published = true;
        }) };
        messages.push(message); return message;
    }) });
    vi.stubGlobal("foundry", { applications: { ux: { TextEditor: { enrichHTML: async t => t } },
        handlebars: { renderTemplate: async (_p, d) => JSON.stringify(d) } } });
});
afterEach(() => vi.unstubAllGlobals());
it("本人とRLだけへ配布し、ジャーナルは作成しない", async () => {
    await distributeKeyHandout("act", "ho");
    expect(messages[0].whisper).toEqual(["owner", "gm"]);
    expect(messages[0].content).toContain("秘密の本文");
    expect(messages[0].content).not.toContain("混入禁止");
    expect(JournalEntry.create).not.toHaveBeenCalled();
    await distributeKeyHandout("act", "ho"); expect(messages).toHaveLength(2);
});
it("配布後の原稿編集は配布済みの記録を変更しない", async () => {
    await distributeKeyHandout("act", "ho"); persona.keyHandout.content = "変更後";
    expect(messages[0].getFlag(SYSTEM_ID, "keyHandout").card.content).toBe("秘密の本文");
});
it("PLの再閲覧一覧は配布済みメッセージだけから得る", async () => {
    await distributeKeyHandout("act", "ho"); game.user = users[1];
    const read = act.getFlag;
    act.getFlag = (scope, key) => { if (key === "handouts") throw Error("原稿を読んではいけない"); return read(scope, key); };
    expect(listKeyHandouts("act")).toHaveLength(1);
    game.user = users[2]; expect(listKeyHandouts("act")).toHaveLength(0);
});
it("公開要求は本人のみ。私信を残して全内容を一度だけ公開送信する", async () => {
    await distributeKeyHandout("act", "ho");
    await publishKeyHandout("act.ho", "other"); expect(messages[0].update).not.toHaveBeenCalled();
    await Promise.all([publishKeyHandout("act.ho", "owner"), publishKeyHandout("act.ho", "owner")]);
    expect(messages[0].update).not.toHaveBeenCalled(); expect(messages[0].whisper).toEqual(["owner", "gm"]);
    expect(messages[1].whisper).toEqual([]);
    expect(messages[1].content).toContain("秘密の本文");
    expect(messages[1].content).toContain("条件");
    expect(messages[1].content).toContain("時期");
    expect(canReadKeyHandout(getKeyHandoutRecord("act.ho").data, users[2])).toBe(true);
    expect(persona.ps).toBe("ペルソナPS"); expect(ChatMessage.create).toHaveBeenCalledTimes(2);
});
it("プレイヤーの公開要求に本文は載せない", async () => {
    await distributeKeyHandout("act", "ho"); game.user = users[1];
    await requestKeyHandoutPublication(getKeyHandoutRecord("act.ho"));
    expect(game.socket.emit.mock.calls[0][1]).toEqual({ type: "publishKeyHandout", messageId: "act.ho", userId: "owner" });
});
it("原稿だけでは閲覧・公開できず、編集フィールドにPSや担当を入れない", () => {
    expect(canReadKeyHandout(null, users[1])).toBe(false);
    expect(canPublishKeyHandout(null, users[1])).toBe(false);
    const fields = keyHandoutFields({ ps: "PS", userId: "other", published: true });
    expect(fields).not.toHaveProperty("ps"); expect(fields).not.toHaveProperty("userId"); expect(fields).not.toHaveProperty("published");
});
it("導入アクトだけペルソナ表記にする", () => {
    const h = { recommendedStyle: "kabuto" };
    expect(handoutDisplayTitle(h, { styleName: "カブト" })).toBe("①カブト用ハンドアウト");
    expect(handoutDisplayTitle(h, { styleName: "カブト", label: "ペルソナハンドアウト" })).toBe("①カブト用ペルソナハンドアウト");
});

it("チャットを削除しても配布内容と公開操作は維持される", async () => {
    await distributeKeyHandout("act", "ho"); messages.length = 0;
    game.user = users[1];
    expect(listKeyHandouts("act")[0].data.card.content).toBe("秘密の本文");
    game.user = users[0]; await publishKeyHandout("act.ho", "owner");
    expect(getKeyHandoutRecord("act.ho").data.published).toBe(true);
    expect(ChatMessage.create).toHaveBeenCalledTimes(2);
});

it("RLは公開できず、公開済みでも本人へ何度でも再送できる", async () => {
    await distributeKeyHandout("act", "ho");
    expect(canPublishKeyHandout(getKeyHandoutRecord("act.ho").data, users[0])).toBe(false);
    await publishKeyHandout("act.ho", "gm"); expect(messages).toHaveLength(1);
    await publishKeyHandout("act.ho", "owner");
    persona.keyHandout.content = "改訂した本文";
    await distributeKeyHandout("act", "ho");
    expect(messages).toHaveLength(3);
    expect(messages[2].whisper).toEqual(["owner", "gm"]);
    expect(messages[2].content).toContain("改訂した本文");
    expect(getKeyHandoutRecord("act.ho").data.published).toBe(true);
});
