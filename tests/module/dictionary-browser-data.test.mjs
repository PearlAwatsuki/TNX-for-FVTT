import { describe, it, expect } from "vitest";
import "../setup.mjs";

const {
    BROWSER_TABS, buildFilterGroups, entryGroupValues, filterEntries,
    groupOutfitEntries, groupStyleSkillEntries, groupLifePathEntries,
} = await import("../../scripts/module/dictionary-browser-data.mjs");

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
});

describe("buildFilterGroups", () => {
    it("スタイル技能はスタイル(動的)＋カテゴリ", () => {
        const groups = buildFilterGroups("styleSkill", { styleNames: { style_common: "コモン" } });
        expect(groups.map((g) => g.key)).toEqual(["style", "category"]);
        expect(groups[0].options).toEqual([{ value: "style_common", label: "コモン" }]);
    });

    it("アウトフィットは大分類・小分類・参照元", () => {
        expect(buildFilterGroups("outfit").map((g) => g.key)).toEqual(["major", "minor", "source"]);
    });

    it("一般技能は種別・区分・下位区分・特性・参照元", () => {
        expect(buildFilterGroups("generalSkill").map((g) => g.key))
            .toEqual(["category", "onomastic", "societyClass", "trait", "source"]);
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
        const and = filterEntries("outfit", [a, b], { checks: { major: ["weapon", "armor"], source: ["ワークス専用装備"] } });
        expect(and).toHaveLength(1);
        expect(and[0]).toBe(b);
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

    it("ライフパスは出自/経験/邂逅の順で表グループ化", () => {
        const o = entry({ system: { lifePathType: "origin" } });
        const e = entry({ system: { lifePathType: "experience" } });
        const groups = groupLifePathEntries([e, o]);
        expect(groups.map((g) => g.typeLabel)).toEqual(["出自", "経験"]);
    });
});
