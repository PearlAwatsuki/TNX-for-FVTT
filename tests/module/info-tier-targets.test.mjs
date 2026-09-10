import { describe, it, expect } from "vitest";
import {
    infoSkillGroups, infoTierTargets, infoTiers, infoDesignationRows,
    discloseInfoByAchievement, toggleInfoDisclosure, buildInfoCardData,
    buildInfoDiscloseCardData, newlyDisclosedInfo, hudInfoTnChips,
} from "../../scripts/rules/session.mjs";

const makeContent = () => ({
    id: "content", text: "共通の入口本文", isDisclosed: false,
    skills: [
        { id: "a", label: "技能A", name: "技能A", tn: 8 },
        { id: "b", label: "技能B", name: "技能B", tn: 10 },
    ],
    tiers: [
        { id: "shared", text: "共通の追加本文", isDisclosed: false, targets: [
            { id: "ta", skillId: "a", tn: 12 }, { id: "tb", skillId: "b", tn: 16 },
        ] },
        { id: "only-b", text: "B専用本文", isDisclosed: false, targets: [
            { id: "tc", skillId: "b", tn: 14 },
        ] },
    ],
});
const opened = content => content.tiers.filter(t => t.isDisclosed).map(t => t.id);
const itemOf = content => ({ title: "情報", contents: [content] });

describe("追加目標値と入口の技能行の紐づけ", () => {
    it("技能AとBで同じ追加本文の目標値を別々に表示する", () => {
        const groups = infoSkillGroups(makeContent());
        expect(groups.map(g => [g.skillId, g.values.map(v => v.tn)])).toEqual([
            ["a", [8, 12]], ["b", [10, 14, 16]],
        ]);
        expect(groups[0].values[1].text).toBe(groups[1].values[2].text);
    });
    it("Aの達成値14は共通本文だけを開き、B専用の14は開かない", () => {
        const before = makeContent();
        const after = discloseInfoByAchievement(before, { achievement: 14, entryTn: 8, skillId: "a" });
        expect(opened(after)).toEqual(["shared"]);
        expect(after.isDisclosed).toBe(true);
        expect(opened(before)).toEqual([]);
    });
    it("Bの達成値14ではB専用、16では共通の追加本文も開く", () => {
        const before = makeContent();
        const first = discloseInfoByAchievement(before, { achievement: 14, entryTn: 10, skillId: "b" });
        expect(opened(first)).toEqual(["only-b"]);
        const next = discloseInfoByAchievement(first, { achievement: 16, entryTn: 10, skillId: "b" });
        expect(opened(next)).toEqual(["shared", "only-b"]);
        expect(newlyDisclosedInfo(first, next)).toEqual({ entryOpened: false, tierIds: ["shared"] });
        expect(discloseInfoByAchievement(next, { achievement: 10, entryTn: 10, skillId: "b" })).toEqual(next);
    });
    it("手動開示もクリックした技能行の目標値順を使う", () => {
        const before = makeContent();
        expect(opened(toggleInfoDisclosure(before, "shared", "a"))).toEqual(["shared"]);
        const both = toggleInfoDisclosure(before, "shared", "b");
        expect(opened(both)).toEqual(["shared", "only-b"]);
        expect(opened(toggleInfoDisclosure(both, "only-b", "b"))).toEqual([]);
        expect(opened(toggleInfoDisclosure(both))).toEqual([]);
    });
    it("既存の単一tnは各技能で共通として扱い、読み出しで変更しない", () => {
        const c = makeContent(); c.tiers = [{ id: "old", tn: 13, text: "既存", isDisclosed: false }];
        const snapshot = structuredClone(c);
        expect(infoTierTargets(c.tiers[0])).toEqual([{ id: "legacy", skillId: "", tn: 13 }]);
        expect(infoSkillGroups(c).map(g => g.values.map(v => v.tn))).toEqual([[8, 13], [10, 13]]);
        expect(opened(discloseInfoByAchievement(c, { achievement: 13 }))).toEqual(["old"]);
        expect(c).toEqual(snapshot);
    });
    it("対象条件が空でも古いtnへ戻らず、本文を保持する", () => {
        const c = makeContent(); c.tiers[0].targets = []; c.tiers[0].tn = 1;
        expect(opened(discloseInfoByAchievement(c, { achievement: 99, skillId: "a" }))).toEqual([]);
        expect(c.tiers[0].text).toBe("共通の追加本文");
    });
    it("削除した技能行や不明な判定経路から専用情報を開かない", () => {
        const c = makeContent(); c.skills = c.skills.filter(s => s.id !== "a");
        expect(opened(discloseInfoByAchievement(c, { achievement: 99, skillId: "a" }))).toEqual([]);
        expect(opened(discloseInfoByAchievement(c, { achievement: 99 }))).toEqual([]);
        expect(infoSkillGroups(c)).toHaveLength(1);
    });
    it("同じ入口目標値の技能でもIDで区別する", () => {
        const c = makeContent(); c.skills[1].tn = 8;
        expect(opened(discloseInfoByAchievement(c, { achievement: 14, entryTn: 8, skillId: "a" }))).toEqual(["shared"]);
        expect(opened(discloseInfoByAchievement(c, { achievement: 14, entryTn: 8, skillId: "b" }))).toEqual(["only-b"]);
        expect(infoDesignationRows(itemOf(c), new Map()).map(r => r.skillId)).toEqual(["a", "b"]);
    });
    it("目標値送信に技能別の値だけを含め、未開示本文は出さない", () => {
        const card = buildInfoCardData(itemOf(makeContent()));
        expect(card.blocks.map(b => b.tnList)).toEqual(["8, 12", "10, 14, 16"]);
        expect(JSON.stringify(card)).not.toContain("本文");
        expect(hudInfoTnChips(itemOf(makeContent())).map(v => v.tn)).toEqual([8, 10, 12, 14, 16]);
    });
    it("自動公開カードは新規共通本文を出し、別技能の未開示本文を漏らさない", () => {
        const before = makeContent();
        const after = discloseInfoByAchievement(before, { achievement: 14, skillId: "a", entryTn: 8 });
        const card = buildInfoDiscloseCardData(itemOf(after), "content", newlyDisclosedInfo(before, after));
        expect(JSON.stringify(card)).toContain("共通の追加本文");
        expect(JSON.stringify(card)).not.toContain("B専用本文");
    });
    it("追加情報の表示順は設定された目標値の最小値順で、保存順を変えない", () => {
        const c = makeContent(); c.tiers.reverse();
        expect(infoTiers(c).map(t => t.id)).toEqual(["shared", "only-b"]);
        expect(c.tiers.map(t => t.id)).toEqual(["only-b", "shared"]);
    });
});
