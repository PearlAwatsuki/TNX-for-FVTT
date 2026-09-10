import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.mock("../../scripts/dictionary/skill-dictionary.mjs", () => ({
    loadGroupedGeneralSkillChoices: async () => [],
    loadGeneralSkillNameByKey: async () => new Map([["old", "技能"]]),
    formatDesignatedSkills: () => "",
}));
let promptSceneEntry;
let options;
const originalFoundry = globalThis.foundry;
beforeAll(async () => {
    globalThis.foundry = { utils: { escapeHTML: s => String(s) }, applications: { api: {
        DialogV2: { wait: async value => { options = value; return null; } },
    } } };
    ({ promptSceneEntry } = await import("../../scripts/session/scene-entry-dialog.mjs"));
});
afterAll(() => { globalThis.foundry = originalFoundry; });
const rootOf = values => ({
    querySelector: selector => values[selector] === undefined ? null : { value: values[selector] },
    querySelectorAll: () => [],
});
const collect = values => options.buttons[0].callback(null, null, { element: rootOf(values) });
describe("シーン開始ダイアログの出し分け", () => {
    it("エリア設定済み・シーンプレイヤー任意ならプレイヤー選択だけを表示", async () => {
        await promptSceneEntry({ row: { area: "white", appearanceMode: "unset" }, choosePlayer: true,
            playerChoices: [{ id: "u", name: "キャスト" }] });
        expect(options.content).toContain('name="scenePlayerUserId"');
        for (const field of ['name="stage"', 'name="area"', 'name="appearanceValue"', 'data-skill-add']) {
            expect(options.content).not.toContain(field);
        }
        expect(collect({ '[name="scenePlayerUserId"]': "u" })).toEqual({ scenePlayerUserId: "u", override: null });
        // 非表示項目のDOMが無くても描画処理が落ちない。
        options.render(null, { element: rootOf({}) });
    });
    it.each(["fixed", "none"])("登場判定%sが設定済みなら指定技能も出さず値を保持", async appearanceMode => {
        await promptSceneEntry({ row: { appearanceMode, appearanceValue: 10, appearanceSkills: ["old"] }, choosePlayer: true });
        expect(options.content).not.toContain('name="appearanceValue"');
        expect(options.content).not.toContain("data-skill-add");
        expect(collect({}).override).toBeNull();
    });
    it("登場判定未設定では目標値と指定技能をセットで表示し、既存技能も初期値に残す", async () => {
        await promptSceneEntry({ row: { appearanceMode: "unset", appearanceSkills: ["old"] } });
        expect(options.content).not.toContain('name="scenePlayerUserId"');
        expect(options.content).toContain('name="appearanceValue" value="10"');
        expect(options.content).toContain("data-skill-add");
        expect(collect({ '[name="area"]': "green", '[name="appearanceValue"]': "10" }).override)
            .toEqual({ area: "green", appearanceValue: 10, appearanceSkills: ["old"] });
    });
    it("使用シーンが設定済みなら舞台選択を表示しない", async () => {
        await promptSceneEntry({ row: { stage: "scene:fixed", appearanceMode: "unset" } });
        expect(options.content).not.toContain('name="stage"');
        expect(options.content).toContain('name="appearanceValue"');
    });
    it("巡回シーンはプレイヤー選択と登場設定を同じダイアログに出す", async () => {
        await promptSceneEntry({ row: { kind: "rotation" }, rotation: true });
        expect(options.content).toContain('name="scenePlayerUserId"');
        expect(options.content).toContain('name="appearanceValue"');
    });
    it("住宅施設の目標値とエリアは選んだ住宅の値を保存する", async () => {
        await promptSceneEntry({ row: { appearanceMode: "unset" }, stageCandidates: [{ value: "house", area: "white", targetValue: 15 }] });
        expect(collect({ '[name="stage"]': "house" }).override)
            .toEqual({ area: "white", appearanceValue: 15, appearanceSkills: [] });
    });
    it("開始時の技能を追加・削除でき、プレイヤー変更で住宅候補も切り替わる", async () => {
        class Element {
            value = ""; children = []; style = {}; handlers = {};
            append(...children) { this.children.push(...children); }
            replaceChildren() { this.children = []; }
            addEventListener(name, fn) { this.handlers[name] = fn; }
            closest() { return this.group; }
        }
        const originalDocument = globalThis.document;
        globalThis.document = { createElement: () => new Element() };
        try {
            const row = { appearanceMode: "unset", appearanceSkills: ["old"] };
            await promptSceneEntry({ row, choosePlayer: true, stageActorIdsByUser: { u1: ["a"], u2: ["b"] },
                stageCandidates: [{ value: "house1", actorId: "a", label: "家1" }, { value: "house2", actorId: "b", label: "家2" }] });
            const player = new Element(); player.value = "u1";
            const stage = new Element(); stage.group = new Element();
            const chips = new Element(); const add = new Element(); const target = new Element(); target.value = "10";
            const elements = { '[name="scenePlayerUserId"]': player, '[name="stage"]': stage,
                '[name="appearanceValue"]': target, '[data-skill-chips]': chips, '[data-skill-add]': add };
            const root = { querySelector: key => elements[key] ?? null, querySelectorAll: () => [] };
            options.render(null, { element: root });
            expect(stage.children.map(o => o.value)).toEqual(["", "house1"]);
            add.value = "new"; add.handlers.change();
            chips.children[0].children[0].handlers.click();
            const result = options.buttons[0].callback(null, null, { element: root });
            expect(result.override.appearanceSkills).toEqual(["new"]);
            expect(row.appearanceSkills).toEqual(["old"]);
            stage.value = "house1"; player.value = "u2"; player.handlers.change();
            expect(stage.children.map(o => o.value)).toEqual(["", "house2"]);
            expect(stage.value).toBe("");
        } finally { globalThis.document = originalDocument; }
    });
    it("エンディングでは未設定の登場関連欄も出さず、任意プレイヤーだけを選べる", async () => {
        await promptSceneEntry({ row: { appearanceMode: "unset", appearanceSkills: ["old"] }, phase: "ending", choosePlayer: true });
        expect(options.content).toContain('name="scenePlayerUserId"');
        for (const field of ['name="stage"', 'name="area"', 'name="appearanceValue"', 'data-skill-add']) {
            expect(options.content).not.toContain(field);
        }
        expect(collect({ '[name="scenePlayerUserId"]': "u" })).toEqual({ scenePlayerUserId: "u", override: null });
    });
    it("キャンセル時は開始用の入力を返さない", async () => {
        await promptSceneEntry({ row: {} });
        expect(options.buttons[1].callback()).toBe(false);
        expect(options.close()).toBeNull();
    });
});
