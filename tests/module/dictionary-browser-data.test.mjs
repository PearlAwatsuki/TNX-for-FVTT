import { describe, it, expect } from "vitest";
import "../setup.mjs";

const {
    BROWSER_TABS, buildFilterGroups, entryGroupValues, filterEntries,
    groupOutfitEntries, groupStyleSkillEntries, groupLifePathEntries,
    sortEntriesForTab, NPC_TYPE_LABELS,
} = await import("../../scripts/dictionary/dictionary-browser-data.mjs");

const entry = (over = {}) => ({ uuid: "u", name: "テスト", img: "", type: "weapon", system: {}, sourceLabel: "アウトフィット", ...over });

describe("BROWSER_TABS(2026-08-31 ユーザー明示のタブ8種)", () => {
    it("タブは指定の8種・指定の順", () => {
        expect(BROWSER_TABS.map((t) => t.label)).toEqual([
            "スタイル技能", "アウトフィット", "一般技能", "スタイル", "神業",
            "オーガニゼーション", "ライフパス", "NPC",
        ]);
    });

    it("ドロー表・住宅エリア・サンプルPC のパックは含まれない", () => {
        const packs = BROWSER_TABS.flatMap((t) => Object.keys(t.packs));
        expect(packs.some((p) => p.includes("draw-tables"))).toBe(false);
        expect(packs.some((p) => p.includes("housing-areas"))).toBe(false);
        expect(packs.some((p) => p.includes("sample-casts"))).toBe(false);
    });

    it("ワークス専用技能はスタイル技能タブに属し、一般技能タブは一般技能辞典のみ", () => {
        const styleTab = BROWSER_TABS.find((t) => t.key === "styleSkill");
        const generalTab = BROWSER_TABS.find((t) => t.key === "generalSkill");
        expect(Object.keys(styleTab.packs).some((p) => p.includes("works-skills"))).toBe(true);
        expect(Object.keys(generalTab.packs)).toHaveLength(1);
    });

    it("NPC タブの種別にキャストは無い(キャストは辞典に載せない・2026-08-31)", () => {
        expect(NPC_TYPE_LABELS).not.toHaveProperty("cast");
    });
});

describe("buildFilterGroups", () => {
    it("スタイル技能はスタイル(動的)＋カテゴリ＋ワークス技能＋所属組織", () => {
        const groups = buildFilterGroups("styleSkill", { styleNames: { style_common: "コモン" }, orgNames: { org_a: "組織A" } });
        expect(groups.map((g) => g.key)).toEqual(["style", "category", "works", "organization"]);
        expect(groups[0].options).toEqual([{ value: "style_common", label: "コモン" }]);
        expect(groups[3].options).toEqual([{ value: "org_a", label: "組織A" }]);
    });

    it("アウトフィットは大分類・小分類・ワークス専用装備・所属組織", () => {
        expect(buildFilterGroups("outfit").map((g) => g.key)).toEqual(["major", "minor", "works", "organization"]);
    });

    it("一般技能は種別・区分・下位区分・特性(参照元は無い=単一辞典)", () => {
        expect(buildFilterGroups("generalSkill").map((g) => g.key))
            .toEqual(["category", "onomastic", "societyClass", "trait"]);
    });

    it("スタイル・神業・オーガニゼーションは検索のみ(グループなし)", () => {
        for (const key of ["style", "miracle", "organization"]) {
            expect(buildFilterGroups(key)).toEqual([]);
        }
    });
});

describe("entryGroupValues と filterEntries", () => {
    it("検索は名前とふりがなに当たる(部分一致・大文字小文字無視)", () => {
        const entries = [
            entry({ name: "オメガブレイド" }),
            entry({ name: "神業X", system: { furigana: "みわざ" } }),
        ];
        expect(filterEntries("outfit", entries, { search: "オメガ" })).toHaveLength(1);
        expect(filterEntries("miracle", entries, { search: "みわざ" })).toHaveLength(1);
        expect(filterEntries("outfit", entries, { search: "存在しない" })).toHaveLength(0);
    });

    it("アウトフィットの大分類は分類集合(副分類・旧 isCyber 包摂)で照合する", () => {
        const bio = entry({ system: { majorCategory: "item", minorCategory: "biotech",
            additionalCategories: [{ major: "weapon", minor: "melee" }] } });
        const legacy = entry({ system: { majorCategory: "weapon", minorCategory: "melee", isCyber: true } });
        expect(entryGroupValues("outfit", "major", bio)).toContain("weapon");
        expect(entryGroupValues("outfit", "major", legacy)).toContain("cyberware");
        expect(filterEntries("outfit", [bio], { checks: { major: ["weapon"] } })).toHaveLength(1);
        expect(filterEntries("outfit", [bio], { checks: { major: ["armor"] } })).toHaveLength(0);
    });

    it("同一グループ内は OR・グループ間は AND", () => {
        const a = entry({ system: { majorCategory: "weapon", minorCategory: "melee" }, sourceLabel: "アウトフィット" });
        const b = entry({ system: { majorCategory: "armor", minorCategory: "armorGear" }, sourceLabel: "ワークス専用装備" });
        const both = filterEntries("outfit", [a, b], { checks: { major: ["weapon", "armor"] } });
        expect(both).toHaveLength(2);
        const and = filterEntries("outfit", [a, b], { checks: { major: ["weapon", "armor"], works: ["works"] } });
        expect(and).toHaveLength(1);
        expect(and[0]).toBe(b);
    });

    it("スタイル技能のワークス技能チェックと所属組織(special.works)", () => {
        const works = entry({ type: "styleSkill", system: { special: { works: { value: true, organization: "org_a" } } } });
        const normal = entry({ type: "styleSkill", system: { style: "style_common" } });
        expect(entryGroupValues("styleSkill", "works", works)).toEqual(["works"]);
        expect(entryGroupValues("styleSkill", "works", normal)).toEqual([]);
        expect(filterEntries("styleSkill", [works, normal], { checks: { organization: ["org_a"] } })).toEqual([works]);
    });

    it("アウトフィットの所属組織は専用(exclusive)の組織参照で照合する", () => {
        const dedicated = entry({ system: { exclusive: [{ type: "organization", key: "org_a" }, { type: "style", key: "style_x" }] } });
        expect(entryGroupValues("outfit", "organization", dedicated)).toEqual(["org_a"]);
        expect(filterEntries("outfit", [dedicated, entry()], { checks: { organization: ["org_a"] } })).toEqual([dedicated]);
    });

    it("購入値レンジ: 指定時は数値の購入値のみ・範囲外と「-」/解説参照を除外", () => {
        const cheap = entry({ system: { buy: { mode: "value", value: 10 } } });
        const pricey = entry({ system: { buy: { mode: "value", value: 25 } } });
        const none = entry({ system: { buy: { mode: "none", value: 0 } } });
        expect(filterEntries("outfit", [cheap, pricey, none], { buyMin: 5, buyMax: 20 })).toEqual([cheap]);
        expect(filterEntries("outfit", [cheap, pricey, none], {})).toHaveLength(3);
    });

    it("一般技能: 区分はフィールド優先・プレフィックス導出も効く(onomasticTypeOf)", () => {
        const byField = entry({ type: "generalSkill", system: { onomasticType: "craft" } });
        const byPrefix = entry({ type: "generalSkill", system: { identificationKey: "society_street" } });
        expect(entryGroupValues("generalSkill", "onomastic", byField)).toEqual(["craft"]);
        expect(entryGroupValues("generalSkill", "onomastic", byPrefix)).toEqual(["society"]);
    });

    it("NPC は Actor type で絞る", () => {
        const guest = entry({ type: "guest" });
        const troop = entry({ type: "troop" });
        expect(filterEntries("npc", [guest, troop], { checks: { npcType: ["guest"] } })).toEqual([guest]);
    });
});

describe("グループ整列", () => {
    it("アウトフィットは主分類→小分類の樹の順(副分類では束ねない)", () => {
        const bio = entry({ name: "生体剣", system: { majorCategory: "item", minorCategory: "biotech",
            additionalCategories: [{ major: "weapon", minor: "melee" }] } });
        const blade = entry({ name: "ブレイド", system: { majorCategory: "weapon", minorCategory: "melee" } });
        const groups = groupOutfitEntries([bio, blade]);
        expect(groups.map((g) => g.majorLabel)).toEqual(["武器", "アイテム"]);
        expect(groups[0].minors[0].entries).toEqual([blade]);
        expect(groups[1].minors[0].entries).toEqual([bio]);
    });

    it("スタイル技能はスタイル辞典の並び順でグループ化・不明スタイルは末尾「その他」", () => {
        const styleNames = { style_kabuki: "カブキ", style_common: "コモン" };
        const a = entry({ name: "A", system: { style: "style_common" } });
        const b = entry({ name: "B", system: { style: "style_kabuki" } });
        const c = entry({ name: "C", system: { style: "style_unknown" } });
        const groups = groupStyleSkillEntries([a, b, c], styleNames);
        expect(groups.map((g) => g.styleLabel)).toEqual(["カブキ", "コモン", "その他"]);
    });

    it("ワークス技能はスタイル群の後ろに所属組織別でグループ化する", () => {
        const styleNames = { style_common: "コモン" };
        const orgNames = { org_a: "組織A" };
        const s = entry({ name: "S", system: { style: "style_common" } });
        const w = entry({ name: "W", system: { special: { works: { value: true, organization: "org_a" } } } });
        const groups = groupStyleSkillEntries([w, s], styleNames, orgNames);
        expect(groups.map((g) => g.styleLabel)).toEqual(["コモン", "組織A"]);
        expect(groups[1].entries).toEqual([w]);
    });

    it("sortEntriesForTab: 一般技能は正規ソート順(識別キー規則)→名前", () => {
        const a = entry({ name: "製作技能", system: { identificationKey: "craft_x" } });
        const b = entry({ name: "射撃", system: { identificationKey: "ranged" } });
        const c = entry({ name: "未知", system: { identificationKey: "zzz_unknown" } });
        const sorted = sortEntriesForTab("generalSkill", [c, a, b]);
        expect(sorted.map((e) => e.name)).toEqual(["射撃", "製作技能", "未知"]);
    });

    it("sortEntriesForTab: スタイル・神業は辞典の登録順(sort)を守る", () => {
        const a = entry({ name: "後", sort: 200 });
        const b = entry({ name: "先", sort: 100 });
        expect(sortEntriesForTab("style", [a, b]).map((e) => e.name)).toEqual(["先", "後"]);
        expect(sortEntriesForTab("miracle", [a, b]).map((e) => e.name)).toEqual(["先", "後"]);
    });

    it("ライフパスは出自/経験/邂逅の順で表グループ化", () => {
        const o = entry({ system: { lifePathType: "origin" } });
        const e = entry({ system: { lifePathType: "experience" } });
        const groups = groupLifePathEntries([e, o]);
        expect(groups.map((g) => g.typeLabel)).toEqual(["出自", "経験"]);
    });
});
