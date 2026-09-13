import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", async importOriginal => ({
    ...await importOriginal(), loadGeneralSkillNameByKey: async () => ({}),
}));
import { bindInfoLinks, createInfoLink, hasDisclosedInfoLink, infoLinkPattern, infoLinkTooltip,
    publishInfoLink, registerInfoLinks, handleInfoLinkMessage } from "../../scripts/chat/info-links.mjs";
import { updateInfoItems } from "../../scripts/session/info-items.mjs";
import { enrichInfoCardData } from "../../scripts/chat/reference-links.mjs";

let dom, journal, items, users, state;
const payload = () => ({ journalUuid: journal.uuid, itemId: "target", userId: "pl" });
const match = text => [...text.matchAll(infoLinkPattern())][0];
beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><body></body>");
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
    items = [
        { id: "source", title: "入口", isPublic: true, contents: [{ id: "c1", isDisclosed: true,
            text: "<p>@Info[target]{次の調査先}</p>", skills: [{ id: "s1", name: "技能", tn: 8 }] }] },
        { id: "target", title: "秘密の項目名", isPublic: false, contents: [{ id: "c2", isDisclosed: false,
            text: "未開示本文", skills: [{ id: "s2", name: "技能", tn: 10 }],
            tiers: [{ id: "tier", tn: 15, text: "追加の秘密", isDisclosed: false }] }] },
    ];
    journal = { id: "act", uuid: "JournalEntry.act", documentName: "JournalEntry",
        getFlag: () => items,
        setFlag: vi.fn(async (_scope, _key, value) => { items = structuredClone(value); }) };
    users = [{ id: "gm", isGM: true, active: true }, { id: "pl", isGM: false, active: true }];
    users.get = id => users.find(u => u.id === id);
    users.activeGM = users[0];
    state = { actId: "act", actStarted: true };
    vi.stubGlobal("game", { user: users[0], users, journal: [journal],
        settings: { get: () => state }, socket: { emit: vi.fn() },
        tooltip: { activate: vi.fn(), deactivate: vi.fn(), dismissLockedTooltip: vi.fn() } });
    vi.stubGlobal("foundry", { utils: { deepClone: structuredClone, randomID: () => "request" },
        applications: { ux: { TextEditor: { enrichHTML: vi.fn(async t => t) } },
            handlebars: { renderTemplate: vi.fn(async (_path, data) => JSON.stringify(data)) } } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } });
});
afterEach(() => { dom.window.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("情報リンクの公開条件", () => {
    it("開示済み本文のリンクから PL が項目だけを公開する", async () => {
        const before = structuredClone(items[1].contents);
        expect(await publishInfoLink(payload())).toBeNull();
        expect(items[1].isPublic).toBe(true);
        expect(items[1].contents).toEqual(before);
    });
    it.each(["非公開の参照元", "未開示本文", "リンクなし", "secret内", "別項目"])("%s は公開不可", async kind => {
        if (kind === "非公開の参照元") items[0].isPublic = false;
        if (kind === "未開示本文") items[0].contents[0].isDisclosed = false;
        if (kind === "リンクなし") items[0].contents[0].text = "本文だけ";
        if (kind === "secret内") items[0].contents[0].text = '<section class="secret">@Info[target]</section>';
        if (kind === "別項目") items[0].contents[0].text = "@Info[other]";
        expect(await publishInfoLink(payload())).toBeTruthy();
        expect(journal.setFlag).not.toHaveBeenCalled();
    });
    it("開示済み追加情報からも公開できる", async () => {
        items[0].contents[0].isDisclosed = false;
        items[0].contents[0].tiers = [{ isDisclosed: true, text: "@Info[target]" }];
        expect(await publishInfoLink(payload())).toBeNull();
    });
    it("別アクト、アクト終了、存在しないユーザー、削除済みは更新しない", async () => {
        state.actId = "other";
        expect(await publishInfoLink(payload())).toBeTruthy();
        state.actId = "act"; state.actStarted = false;
        expect(await publishInfoLink(payload())).toBeTruthy();
        state.actStarted = true;
        expect(await publishInfoLink({ ...payload(), userId: "missing" })).toBeTruthy();
        expect(await publishInfoLink({ ...payload(), itemId: "deleted" })).toBeTruthy();
        expect(journal.setFlag).not.toHaveBeenCalled();
    });
    it("activeGM だけが適用し、RL 自身は未開示の原稿からも操作できる", async () => {
        game.user = users[1];
        expect(await publishInfoLink(payload())).toBeTruthy();
        game.user = users[0];
        items[0].isPublic = false;
        expect(await publishInfoLink({ ...payload(), userId: "gm" })).toBeNull();
    });
    it("同時クリックは一度だけ保存し、別項目への同時公開も失わない", async () => {
        items.push({ id: "other", isPublic: false });
        items[0].contents[0].text += " @Info[other]";
        await Promise.all([publishInfoLink(payload()), publishInfoLink(payload()),
            publishInfoLink({ ...payload(), itemId: "other" })]);
        expect(items.slice(1).every(i => i.isPublic)).toBe(true);
        expect(journal.setFlag).toHaveBeenCalledTimes(2);
    });
    it("判定開示と公開の同時更新で本文開示を巻き戻さない", async () => {
        await Promise.all([
            updateInfoItems(journal, async rows => { await Promise.resolve(); rows[1].contents[0].isDisclosed = true; }),
            publishInfoLink(payload()),
        ]);
        expect(items[1].isPublic).toBe(true);
        expect(items[1].contents[0].isDisclosed).toBe(true);
    });
    it("保存失敗後も次の要求を処理できる", async () => {
        journal.setFlag.mockRejectedValueOnce(new Error("offline"));
        await expect(publishInfoLink(payload())).rejects.toThrow("offline");
        expect(await publishInfoLink(payload())).toBeNull();
        expect(items[1].isPublic).toBe(true);
    });
});

describe("情報リンクの表示", () => {
    it("任意名をテキストとして保存し、アクトの UUID を保持する", () => {
        const link = createInfoLink(match('@Info[target]{<img src=x onerror=alert(1)>}'), { relativeTo: journal });
        expect(link.dataset.infoJournal).toBe(journal.uuid);
        expect(link.querySelector("img")).toBeNull();
        expect(link.textContent).toBe("【<img src=x onerror=alert(1)>】");
        state.actId = "other";
        bindInfoLinks(link);
        expect(link.dataset.infoJournal).toBe("JournalEntry.act");
    });
    it("ラベルなしの保存 HTML に RL 専用の項目名を含めず、閲覧者ごとに解決する", () => {
        const link = createInfoLink(match("@Info[target]"), { relativeTo: journal });
        expect(link.outerHTML).not.toContain("秘密の項目名");
        game.user = users[1]; bindInfoLinks(link);
        expect(link.textContent).toBe("【非公開の情報】");
        items[1].isPublic = true; bindInfoLinks(link);
        expect(link.textContent).toBe("【秘密の項目名】");
    });
    it("文脈なしの記法を上演中のアクトへ誤って結び付けない", () => {
        const link = createInfoLink(match("@Info[target]"));
        bindInfoLinks(link);
        expect(link.dataset.infoJournal).toBe("");
        expect(link.classList.contains("broken")).toBe(true);
    });
    it("太字内でも連続する記法を認識し、ID の途中の書式分割は認識しない", () => {
        items[0].contents[0].text = "<strong>@Info[target]{別名}</strong>";
        expect(hasDisclosedInfoLink(items, "target")).toBe(true);
        items[0].contents[0].text = "<strong>@Info[tar</strong>get]";
        expect(hasDisclosedInfoLink(items, "target")).toBe(false);
    });
    it("非公開のツールチップに技能・目標値・本文を含めない", async () => {
        const result = await infoLinkTooltip(journal, items[1], { isGM: false });
        expect(result).toEqual({ text: "未公開の情報項目・クリックで公開" });
        expect(foundry.applications.handlebars.renderTemplate).not.toHaveBeenCalled();
    });
    it("公開後は HUD と同じ目標値を示し、開示済み本文だけを示す", async () => {
        items[1].isPublic = true;
        let result = await infoLinkTooltip(journal, items[1], { isGM: false });
        expect(result.html).toContain("10, 15");
        expect(result.html).not.toContain("未開示本文");
        items[1].contents[0].isDisclosed = true;
        result = await infoLinkTooltip(journal, items[1], { isGM: false });
        expect(result.html).toContain("未開示本文");
        expect(result.html).not.toContain("追加の秘密");
        expect(result.cssClass).toBe("tnx-info-card-tooltip");
    });
    it("循環参照は本文として渡すだけで再帰展開せず、元のアクトを引き継ぐ", async () => {
        items[1].isPublic = true; items[1].contents[0].isDisclosed = true;
        items[1].contents[0].text = "@Info[source]";
        await infoLinkTooltip(journal, items[1]);
        expect(foundry.applications.ux.TextEditor.enrichHTML).toHaveBeenCalledWith("@Info[source]",
            { async: true, relativeTo: journal });
        expect(foundry.applications.handlebars.renderTemplate).toHaveBeenCalledTimes(1);
    });
    it("カードの各本文へ元アクトを渡し、元データを変更しない", async () => {
        const card = { blocks: [{ rows: [{ text: "@Info[target]" }] }] };
        await enrichInfoCardData(card, { relativeTo: journal });
        expect(foundry.applications.ux.TextEditor.enrichHTML).toHaveBeenCalledWith("@Info[target]",
            { async: true, relativeTo: journal });
        expect(card.blocks[0].rows[0].text).toBe("@Info[target]");
    });
    it("削除された参照先のツールチップはエラー表示", async () => {
        expect(await infoLinkTooltip(journal, null)).toEqual({ text: "参照先が見つかりません。" });
    });
    it("登録する enricher は DOM 挿入時に操作を配線する", () => {
        vi.stubGlobal("CONFIG", { TextEditor: { enrichers: [] } });
        vi.stubGlobal("Hooks", { on: vi.fn() });
        registerInfoLinks();
        expect(CONFIG.TextEditor.enrichers[0]).toMatchObject({ id: "tnx-info", onRender: bindInfoLinks });
    });
    it("RL 不在でクリックしても公開せず通知する", async () => {
        game.user = users[1]; users.activeGM = null;
        const link = createInfoLink(match("@Info[target]"), { relativeTo: journal });
        bindInfoLinks(link); link.click();
        await vi.waitFor(() => expect(ui.notifications.warn).toHaveBeenCalled());
        expect(game.socket.emit).not.toHaveBeenCalled();
        expect(items[1].isPublic).toBe(false);
    });
    it("PL の要求は結果を受信してから成功通知する", async () => {
        game.user = users[1];
        const link = createInfoLink(match("@Info[target]"), { relativeTo: journal });
        bindInfoLinks(link); link.click();
        expect(ui.notifications.info).not.toHaveBeenCalled();
        const data = game.socket.emit.mock.calls[0][1];
        game.user = users[0]; await handleInfoLinkMessage(data);
        const response = game.socket.emit.mock.calls[1][1];
        game.user = users[1]; await handleInfoLinkMessage(response);
        await vi.waitFor(() => expect(ui.notifications.info).toHaveBeenCalledTimes(1));
        expect(items[1].isPublic).toBe(true);
    });
    it.runIf(process.env.TNX_FOUNDRY_CLIENT)("実際の Foundry TextEditor で記法・保存 HTML・DOM 配線を検証する", async () => {
        // コアは同梱せず、手元のインストール先を指定した時だけ実ソースを読む。
        const root = process.env.TNX_FOUNDRY_CLIENT;
        const editorSource = await readFile(join(root, "applications/ux/text-editor.mjs"), "utf8");
        const elementSource = await readFile(join(root, "applications/elements/enriched-content.mjs"), "utf8");
        const TextEditor = new Function(editorSource.replace(/^import .*;\r?\n/gm, "")
            .replace("export default class", "class") + "\nreturn TextEditor;")();
        const Enriched = new Function("HTMLElement", elementSource.replace("export default class", "class")
            + "\nreturn HTMLEnrichedContentElement;")(dom.window.HTMLElement);
        dom.window.customElements.define("enriched-content", Enriched);
        foundry.applications.elements = { HTMLEnrichedContentElement: Enriched };
        foundry.applications.ux.TextEditor = TextEditor;
        vi.stubGlobal("CONFIG", { TextEditor: { enrichers: [] }, ux: { TextEditor } });
        vi.stubGlobal("Hooks", { on: vi.fn(), onError: (_name, error) => { throw error; } });
        registerInfoLinks();
        const options = { documents: false, links: false, embeds: false, rolls: false, relativeTo: journal };
        const html = await TextEditor.enrichHTML('<p><strong>@Info[target]{任意名}</strong> @Info[target]</p>', options);
        expect(html).toContain('enricher="tnx-info"');
        expect(html).not.toContain("秘密の項目名");
        game.user = users[1];
        document.body.innerHTML = html;
        const links = document.querySelectorAll("a.tnx-info-link");
        expect(links).toHaveLength(2);
        expect(links[0].textContent).toBe("【任意名】");
        expect(links[1].textContent).toBe("【非公開の情報】");
        expect(links[0].dataset.infoJournal).toBe(journal.uuid);
        const broken = await TextEditor.enrichHTML('<strong>@Info[target]</strong>{別書式}', options);
        expect(broken).toContain("</strong>{別書式}");
        users.activeGM = null;
        links[0].click();
        await vi.waitFor(() => expect(ui.notifications.warn).toHaveBeenCalled());
    });
});
