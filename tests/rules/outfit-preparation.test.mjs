import { describe, it, expect } from "vitest";
import { planInvalidOutfitPreparation } from "../../scripts/rules/outfit-preparation.mjs";
const host = (system = {}) => ({ id: "host", type: "weapon", system: { isPrepared: true, majorCategory: "weapon", minorCategory: "melee", part: [], slots: [{ kind: "normal", count: { mode: "value", value: 2 } }], ...system } });
const option = (id = "option", system = {}) => ({ id, type: "general", system: { isPrepared: true, isOption: true, parentItemId: "host", parentSlotKind: "normal", part: [{ kind: "option", hostMajor: "weapon", hostMinor: "melee", slots: 1 }], ...system } });
const plan = (items, partSlots = []) => planInvalidOutfitPreparation({ items, system: { partSlots } }).map(row => row.id);
describe("実効属性変更による個別準備解除", () => {
    it("ホストの小分類が条件から外れたオプションを解除する", () => {
        expect(plan([host({ minorCategory: "ranged" }), option()])).toEqual(["option"]);
        expect(plan([host(), option()])).toEqual([]);
    });
    it("副分類に条件が残っていれば解除しない", () => {
        expect(plan([host({ minorCategory: "ranged", additionalCategories: [{ major: "weapon", minor: "melee" }] }), option()])).toEqual([]);
    });
    it("ホスト未準備・スロット消失・単体の容量超過を解除する", () => {
        expect(plan([host({ isPrepared: false }), option()])).toEqual(["option"]);
        expect(plan([host({ slots: [] }), option()])).toEqual(["option"]);
        expect(plan([host({ slots: [{ kind: "normal", count: { mode: "value", value: 2, total: 0 } }] }), option()])).toEqual(["option"]);
    });
    it("スロットを持たないホストの名前指定枠を維持する", () => {
        expect(plan([host({ slots: [] }), option("option", { parentSlotKind: "outfitName" })])).toEqual([]);
    });
    it("身体部位の単体超過は解除するが、未掲載の非カウント部位は維持する", () => {
        const weapon = host({ part: [{ kind: "bodyPart", partKey: "hand", slots: 2 }] });
        expect(plan([weapon], [{ key: "hand", value: "片手", count: 1 }])).toEqual(["host"]);
        expect(plan([weapon])).toEqual([]);
    });
    it("ホストを解除すると配下の準備も解除する", () => {
        const weapon = host({ part: [{ kind: "bodyPart", partKey: "hand", slots: 2 }] });
        expect(plan([weapon, option()], [{ key: "hand", value: "片手", count: 1 }])).toEqual(["host", "option"]);
    });
    it("複数装備の合計超過では選別方針が未確定のため勝手に解除しない", () => {
        expect(plan([host({ slots: [{ kind: "normal", count: { mode: "value", value: 1 } }] }), option("a"), option("b")])).toEqual([]);
    });
});
