import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveUsageSkillSet, detectUsageDefect, enumerateRequestComboCandidates, buildRequestUsageChoices } =
    await import("../../scripts/flow/usage-check-context.mjs");

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

describe("enumerateRequestComboCandidates()（判定要求のコンボ候補列挙・KI-025）", () => {
    // Foundry の Collection は for...of で値を返すため、Map 互換+値イテレータのモックを使う
    const mkActor = (items) => {
        const map = new Map(items.map(i => [i.id, i]));
        return { items: {
            get: (id) => map.get(id),
            has: (id) => map.has(id),
            [Symbol.iterator]: () => map.values(),
        } };
    };
    const all = suits(true, true, true, true);

    it("指定技能をベース技能に含む他アイテムの判定用途を列挙する", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: all } };
        const style = { id: "s1", system: { identificationKey: "", suits: all, actions: [
            { _id: "u1", type: "check", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
        ] } };
        const actor = mkActor([perception, style]);
        const found = enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" });
        expect(found.map(c => [c.item.id, c.usage._id])).toEqual([["s1", "u1"]]);
    });

    it("組み合わせ技能(skillRefs)に含む場合も列挙する", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: all } };
        const melee = { id: "m1", system: { identificationKey: "melee", suits: all, actions: [
            { _id: "u1", type: "check", baseSkillRef: { itemId: "m1" }, skillRefs: [{ itemId: "p1" }] },
        ] } };
        const actor = mkActor([perception, melee]);
        const found = enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" });
        expect(found.map(c => [c.item.id, c.usage._id])).toEqual([["m1", "u1"]]);
    });

    it("指定技能自身(excludeItemId)の用途は除外する(従来のアイテム起動側が受け持つ)", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: all, actions: [
            { _id: "u1", type: "check", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
        ] } };
        const actor = mkActor([perception]);
        expect(enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" })).toEqual([]);
    });

    it("指定技能が参加しない用途は載らない", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: all } };
        const other = { id: "o1", system: { identificationKey: "melee", suits: all, actions: [
            { _id: "u1", type: "check", baseSkillRef: { itemId: "o1" }, skillRefs: [] },
        ] } };
        const actor = mkActor([perception, other]);
        expect(enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" })).toEqual([]);
    });

    it("「判定」タイプ以外・通常判定へ流れない判定用途は候補にしない(2026-07-19 裁定=判定タイプ限定)", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: all } };
        const style = { id: "s1", system: { identificationKey: "", suits: all, actions: [
            { _id: "a", type: "physicalAttack", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "b", type: "check", fixedResult: 10, baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "c", type: "check", grantRecheck: true, baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "d", type: "check", npcAcquire: true, baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "e", type: "treatment", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "f", type: "repair", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "g", type: "covering", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "h", type: "dodge", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
            { _id: "i", type: "check", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
        ] } };
        const actor = mkActor([perception, style]);
        const found = enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" });
        // リアクション等の行動種別タイプ(h)も除外され、素の「判定」用途(i)だけが残る
        expect(found.map(c => c.usage._id)).toEqual(["i"]);
    });

    it("不備のある用途(共通スート無し)は除外する", () => {
        const perception = { id: "p1", system: { identificationKey: "perception", suits: suits(true, false, false, false) } };
        const style = { id: "s1", system: { identificationKey: "", suits: suits(false, true, false, false), actions: [
            { _id: "u1", type: "check", baseSkillRef: { itemId: "p1" }, skillRefs: [] },
        ] } };
        const actor = mkActor([perception, style]);
        expect(enumerateRequestComboCandidates(actor, "perception", { excludeItemId: "p1" })).toEqual([]);
    });

    it("識別キー未指定・アクター無しは空", () => {
        expect(enumerateRequestComboCandidates(null, "perception")).toEqual([]);
        expect(enumerateRequestComboCandidates(mkActor([]), "")).toEqual([]);
    });
});

describe("buildRequestUsageChoices()（判定要求の第2段プルダウンの用途リスト・KI-025 改）", () => {
    const perception = { id: "p1", type: "generalSkill", name: "知覚", system: { actions: [
        { _id: "u1", type: "check" },
        { _id: "u2", type: "declaration" },                       // 宣言=判定タイプでない
        { _id: "u3", type: "declaration", grantRecheck: true },   // バフ宣言=判定タイプでない
        { _id: "u4", type: "dodge" },                             // 行動種別タイプ=対象外(2026-07-19 裁定)
        { _id: "u5", type: "check", grantRecheck: true },         // クリック待ち系=要求に結果を返せない
    ] } };
    const style = { id: "s1", type: "styleSkill", name: "見切り", system: { actions: [] } };

    it("指定技能自身とコンボ候補を統合(どちらも「判定」タイプ限定)しラベルは用途の実効名", () => {
        const combos = [
            { item: style, usage: { _id: "c1", type: "check" } },
            { item: style, usage: { _id: "c2", type: "check", name: "カウンター" } },
        ];
        const choices = buildRequestUsageChoices(perception, combos);
        expect(choices.map(c => c.usage._id)).toEqual(["u1", "c1", "c2"]);
        // 実効名の親名は素の名前(「判定（知覚）」・2026-07-19 ユーザー指摘=〈〉は付けない)
        expect(choices[0].label).toBe("判定（知覚）");
        expect(choices[1].label).toBe("判定（見切り）");
        // 名前つきのコンボ候補は「用途名（親名）」で由来を判別可能に
        expect(choices[2].label).toBe("カウンター（見切り）");
    });

    it("指定技能なし(未所持)はコンボ候補のみ・両方なしは空", () => {
        const combos = [{ item: style, usage: { _id: "c1", type: "check" } }];
        expect(buildRequestUsageChoices(null, combos).map(c => c.usage._id)).toEqual(["c1"]);
        expect(buildRequestUsageChoices(null, [])).toEqual([]);
    });

    it("長すぎる用途名は「…」省略・親名(技能名)は必ず残す(2026-07-19 ユーザー指示)", () => {
        const longName = "あ".repeat(30);
        const combos = [{ item: style, usage: { _id: "c1", type: "check", name: longName } }];
        const [c] = buildRequestUsageChoices(null, combos);
        // 上限22文字: 用途名16+「…」+「（見切り）」(5) = 22
        expect(c.label).toBe(`${"あ".repeat(16)}…（見切り）`);
        expect(c.label.length).toBe(22);
        expect(c.label.endsWith("（見切り）")).toBe(true);
    });

    it("親名が長くても親名は削らない(用途名は最小4文字まで残す)", () => {
        const longParent = { id: "s2", type: "styleSkill", name: "か".repeat(20), system: { actions: [] } };
        const combos = [{ item: longParent, usage: { _id: "c1", type: "check", name: "あ".repeat(10) } }];
        const [c] = buildRequestUsageChoices(null, combos);
        expect(c.label).toBe(`ああああ…（${"か".repeat(20)}）`);
    });

    it("指定技能自身の名前つき用途は名前のみ(題名が技能名を担う)・超過は末尾を省略", () => {
        const own = { id: "p2", type: "generalSkill", name: "知覚", system: { actions: [
            { _id: "u1", type: "check", name: "あ".repeat(30) },
        ] } };
        const [c] = buildRequestUsageChoices(own, []);
        expect(c.label).toBe(`${"あ".repeat(21)}…`);
        expect(c.label.length).toBe(22);
    });

    it("未命名(「判定（親名）」)は省略しない", () => {
        const longParent = { id: "s2", type: "styleSkill", name: "か".repeat(25), system: { actions: [] } };
        const combos = [{ item: longParent, usage: { _id: "c1", type: "check" } }];
        const [c] = buildRequestUsageChoices(null, combos);
        expect(c.label).toBe(`判定（${"か".repeat(25)}）`);
    });
});
