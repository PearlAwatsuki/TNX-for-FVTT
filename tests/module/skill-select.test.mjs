import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { orderSkills } = await import("../../scripts/module/skill-select.mjs");
const { skillSortPosition } = await import("../../scripts/module/identification.mjs");
const { groupGeneralSkillEntries } = await import("../../scripts/module/skill-dictionary.mjs");

// 技能選択プルダウンの並び統一(2026-07-19 ユーザー指示):
// シートのソート順(手動 sort)→正規ソート順(識別キー)→名前(ja)。

describe("skillSortPosition()（正規ソート順の位置・identification.mjs へ移設）", () => {
    it("無条件取得技能・固有名詞技能ともプレフィックスで位置が決まる", () => {
        expect(skillSortPosition("medicine")).toBe(0);
        expect(skillSortPosition("craft")).toBe(4);
        expect(skillSortPosition("craft_food")).toBe(4);
        expect(skillSortPosition("art_dance")).toBe(8);
        expect(skillSortPosition("contact")).toBe(17);
    });

    it("未知キー・空は Infinity(末尾)", () => {
        expect(skillSortPosition("unknown_key")).toBe(Infinity);
        expect(skillSortPosition("")).toBe(Infinity);
    });
});

describe("orderSkills()（一般→スタイル・シート順→正規順→名前）", () => {
    const g = (id, key, name, sort) => ({ id, type: "generalSkill", name, sort, system: { identificationKey: key } });
    const s = (id, name, sort) => ({ id, type: "styleSkill", name, sort, system: { identificationKey: "" } });

    it("アクター所持(手動 sort あり)は sort 順=シートの並びを維持する", () => {
        const items = [g("a", "melee", "白兵", 3000), g("b", "evasion", "回避", 1000), g("c", "medicine", "医療", 2000)];
        expect(orderSkills(items).map(i => i.id)).toEqual(["b", "c", "a"]);
    });

    it("辞典由来(sort なし)は正規ソート順になる", () => {
        const items = [g("a", "melee", "白兵"), g("b", "medicine", "医療"), g("c", "craft_food", "製作：食品")];
        expect(orderSkills(items).map(i => i.id)).toEqual(["b", "c", "a"]);
    });

    it("正規位置が同じ(同一固有名詞分類)は名前(ja)で並ぶ", () => {
        const items = [g("a", "art_song", "芸術：歌"), g("b", "art_dance", "芸術：ダンス")];
        expect(orderSkills(items).map(i => i.id)).toEqual(["b", "a"]);
    });

    it("一般技能が先・スタイル技能が後(各群内は上記の順)", () => {
        const items = [s("s1", "特技A", 100), g("a", "melee", "白兵", 9000)];
        expect(orderSkills(items).map(i => i.id)).toEqual(["a", "s1"]);
    });
});

describe("groupGeneralSkillEntries()（判定要求プルダウンの分類グループ化）", () => {
    it("無条件取得技能と固有名詞分類へ初出順で束ねる(正規順入力で 無条件→製作→芸術)", () => {
        const entries = [
            { identificationKey: "medicine", name: "医療", generalSkillCategory: "initialSkill" },
            { identificationKey: "craft_food", name: "製作：食品", generalSkillCategory: "onomasticSkill" },
            { identificationKey: "negotiation", name: "交渉", generalSkillCategory: "initialSkill" },
            { identificationKey: "art_dance", name: "芸術：ダンス", generalSkillCategory: "onomasticSkill" },
        ];
        const groups = groupGeneralSkillEntries(entries);
        expect(groups.map(x => x.label)).toEqual(["無条件取得技能", "製作", "芸術"]);
        expect(groups[0].skills.map(x => x.identificationKey)).toEqual(["medicine", "negotiation"]);
        expect(groups[1].skills.map(x => x.identificationKey)).toEqual(["craft_food"]);
    });

    it("未知プレフィックスの固有名詞技能は「固有名詞技能」へ", () => {
        const groups = groupGeneralSkillEntries([
            { identificationKey: "mystery_x", name: "謎", generalSkillCategory: "onomasticSkill" },
        ]);
        expect(groups.map(x => x.label)).toEqual(["固有名詞技能"]);
    });

    it("空・未定義は空配列", () => {
        expect(groupGeneralSkillEntries([])).toEqual([]);
        expect(groupGeneralSkillEntries(undefined)).toEqual([]);
    });
});
