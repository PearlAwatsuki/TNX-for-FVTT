import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveUsageSkillSet, detectUsageDefect } =
    await import("../../scripts/module/usage-check-context.mjs");

/** アクターのモック(items は Map 互換の get/has だけ使う)。 */
function mockActor(items) {
    const map = new Map(items.map(i => [i.id, i]));
    return { items: map };
}

const suits = (spade, club, heart, diamond) => ({ spade, club, heart, diamond });

describe("resolveUsageSkillSet()（参加技能の解決・旧 _resolveSkillSet）", () => {
    it("ベース=baseSkillRef 優先・コンボ=skillRefs・共通スートの積", () => {
        const base = { id: "base", system: { suits: suits(true, true, false, false) } };
        const combo = { id: "combo", system: { suits: suits(true, false, true, false) } };
        const actor = mockActor([base, combo]);
        const usage = { baseSkillRef: { itemId: "base" }, skillRefs: [{ itemId: "combo" }] };
        const r = resolveUsageSkillSet(base, usage, actor);
        expect(r.baseSkillId).toBe("base");
        expect(r.allSkillIds).toEqual(["base", "combo"]);
        expect(r.validSuits).toEqual(["spade"]);
    });

    it("baseSkillRef 未設定は親アイテムがベース", () => {
        const parent = { id: "parent", system: { suits: suits(true, true, true, true) } };
        const actor = mockActor([parent]);
        const r = resolveUsageSkillSet(parent, { baseSkillRef: { itemId: "" }, skillRefs: [] }, actor);
        expect(r.baseSkillId).toBe("parent");
        expect(r.baseSkill).toBe(parent);
    });

    it("非ベースの親技能は自動的にコンボへ追加される(非アクション技能からの起動)", () => {
        const base = { id: "base", system: { suits: suits(true, true, true, true) } };
        const parent = { id: "parent", system: { suits: suits(true, true, false, false) } };
        const actor = mockActor([base, parent]);
        const usage = { baseSkillRef: { itemId: "base" }, skillRefs: [] };
        const r = resolveUsageSkillSet(parent, usage, actor);
        expect(r.allSkillIds).toEqual(["base", "parent"]);
        expect(r.validSuits).toEqual(["spade", "club"]);
    });

    it("所持していない skillRefs は無視する", () => {
        const parent = { id: "parent", system: { suits: suits(true, true, true, true) } };
        const actor = mockActor([parent]);
        const usage = { baseSkillRef: { itemId: "parent" }, skillRefs: [{ itemId: "gone" }] };
        const r = resolveUsageSkillSet(parent, usage, actor);
        expect(r.allSkillIds).toEqual(["parent"]);
    });
});

describe("detectUsageDefect()（用途不備検知・旧 _detectUsageDefect）", () => {
    it("check: ベース技能が解決できない → 不備", () => {
        const parent = { id: "parent", system: { suits: suits(true, true, true, true) } };
        const actor = mockActor([parent]);
        const usage = { type: "check", baseSkillRef: { itemId: "gone" }, skillRefs: [] };
        expect(detectUsageDefect(parent, usage, actor)).toBe("ベース技能が見つかりません");
    });

    it("check: 参加技能に共通スートが無い → 不備", () => {
        const base = { id: "base", system: { suits: suits(true, false, false, false) } };
        const combo = { id: "combo", system: { suits: suits(false, true, false, false) } };
        const actor = mockActor([base, combo]);
        const usage = { type: "check", baseSkillRef: { itemId: "base" }, skillRefs: [{ itemId: "combo" }] };
        expect(detectUsageDefect(base, usage, actor)).toBe("参加技能に共通スートがありません");
    });

    it("check: 固定達成値の用途は不備検知の対象外", () => {
        const parent = { id: "parent", system: {} };
        const actor = mockActor([parent]);
        const usage = { type: "check", fixedResult: 15, baseSkillRef: { itemId: "gone" }, skillRefs: [] };
        expect(detectUsageDefect(parent, usage, actor)).toBeNull();
    });

    it("check: 不備なし → null／他タイプは未検知 → null", () => {
        const parent = { id: "parent", system: { suits: suits(true, true, true, true) } };
        const actor = mockActor([parent]);
        expect(detectUsageDefect(parent, { type: "check", baseSkillRef: { itemId: "parent" }, skillRefs: [] }, actor)).toBeNull();
        expect(detectUsageDefect(parent, { type: "declaration" }, actor)).toBeNull();
    });
});
