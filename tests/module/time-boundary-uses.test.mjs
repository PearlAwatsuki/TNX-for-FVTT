import { describe, it, expect } from "vitest";
import { TNX_BOUNDARIES } from "../../scripts/rules/time-boundary.mjs";
import { planItemBoundaryUpdates } from "../../scripts/rules/time-boundary.mjs";

/** 使用回数を持つアイテム(スタイル技能・アウトフィット共通の uses 形) */
const withUses = (id, type, spent, itemType = "styleSkill") => ({
    id, type: itemType,
    system: { uses: { isLimit: true, type, max: "3", spent } },
});

/** 消費アイテム(個数を持つアウトフィット) */
const consumable = (id, value, max, isConsumption = true) => ({
    id, type: "general",
    system: { isConsumption, quantity: { value, max } },
});

describe("planItemBoundaryUpdates()（境界でのアイテム側リセット・15-2）", () => {
    it("「カット中N回」はカット終了で消費が戻る", () => {
        expect(planItemBoundaryUpdates([withUses("a", "cut", 2)], TNX_BOUNDARIES.cutEnd))
            .toEqual([{ _id: "a", "system.uses.spent": 0 }]);
    });

    it("「カット中N回」はメインプロセス終了では戻らない", () => {
        expect(planItemBoundaryUpdates([withUses("a", "cut", 2)], TNX_BOUNDARIES.mainProcessEnd))
            .toEqual([]);
    });

    it("「シーン中N回」はカット進行終了では戻らず、退場で戻る", () => {
        const items = [withUses("a", "scene", 1)];
        expect(planItemBoundaryUpdates(items, TNX_BOUNDARIES.cutProgressionEnd)).toEqual([]);
        expect(planItemBoundaryUpdates(items, TNX_BOUNDARIES.exit))
            .toEqual([{ _id: "a", "system.uses.spent": 0 }]);
    });

    it("「アクト中N回」は退場では戻らず、アクト終了で戻る", () => {
        const items = [withUses("a", "act", 1)];
        expect(planItemBoundaryUpdates(items, TNX_BOUNDARIES.exit)).toEqual([]);
        expect(planItemBoundaryUpdates(items, TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "a", "system.uses.spent": 0 }]);
    });

    it("上位の境界は下位の単位も戻す（アクト終了でカット中N回も戻る）", () => {
        expect(planItemBoundaryUpdates([withUses("a", "cut", 3)], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "a", "system.uses.spent": 0 }]);
    });

    it("神業は期間の指定が無くてもアクト単位で戻る", () => {
        const miracle = withUses("m", "", 2, "miracle");
        expect(planItemBoundaryUpdates([miracle], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "m", "system.uses.spent": 0 }]);
        expect(planItemBoundaryUpdates([miracle], TNX_BOUNDARIES.exit)).toEqual([]);
    });

    it("神業以外で期間の指定が無いものは境界で戻さない", () => {
        expect(planItemBoundaryUpdates([withUses("a", "", 2)], TNX_BOUNDARIES.actEnd)).toEqual([]);
    });

    it("消費していないものは更新に含めない（無駄な書き込みをしない）", () => {
        expect(planItemBoundaryUpdates([withUses("a", "cut", 0)], TNX_BOUNDARIES.cutEnd)).toEqual([]);
    });

    it("消費アイテムの個数はアクト終了で常備化個数まで戻る", () => {
        expect(planItemBoundaryUpdates([consumable("c", 1, 4)], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "c", "system.quantity.value": 4 }]);
    });

    it("消費アイテムの個数はアクト終了より手前の境界では戻らない", () => {
        expect(planItemBoundaryUpdates([consumable("c", 1, 4)], TNX_BOUNDARIES.exit)).toEqual([]);
    });

    it("消費アイテムでないものの個数は触らない", () => {
        expect(planItemBoundaryUpdates([consumable("c", 1, 4, false)], TNX_BOUNDARIES.actEnd))
            .toEqual([]);
    });

    it("個数が満ちているものは更新に含めない", () => {
        expect(planItemBoundaryUpdates([consumable("c", 4, 4)], TNX_BOUNDARIES.actEnd)).toEqual([]);
    });

    it("使用回数と個数の両方が該当するアイテムは1つの更新にまとまる", () => {
        const item = {
            id: "x", type: "general",
            system: {
                uses: { isLimit: true, type: "act", max: "2", spent: 1 },
                isConsumption: true, quantity: { value: 0, max: 3 },
            },
        };
        expect(planItemBoundaryUpdates([item], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "x", "system.uses.spent": 0, "system.quantity.value": 3 }]);
    });

    it("アイテムが無くても落ちない", () => {
        expect(planItemBoundaryUpdates(null, TNX_BOUNDARIES.actEnd)).toEqual([]);
    });
});

describe("故障・破壊のアクト終了解除（15-5）", () => {
    const broken = (id, malfunction, destroyed) => ({
        id, type: "weapon",
        system: { isMalfunction: malfunction, isDestroyed: destroyed },
    });

    it("アクト終了で故障・破壊がどちらも解除される（アクト間に持ち越さない）", () => {
        expect(planItemBoundaryUpdates([broken("a", true, true)], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "a", "system.isMalfunction": false, "system.isDestroyed": false }]);
    });

    it("立っているフラグだけを落とす", () => {
        expect(planItemBoundaryUpdates([broken("a", true, false)], TNX_BOUNDARIES.actEnd))
            .toEqual([{ _id: "a", "system.isMalfunction": false }]);
    });

    it("アクト終了より手前の境界では解除しない", () => {
        expect(planItemBoundaryUpdates([broken("a", true, true)], TNX_BOUNDARIES.exit)).toEqual([]);
    });

    it("どちらも立っていなければ更新に含めない", () => {
        expect(planItemBoundaryUpdates([broken("a", false, false)], TNX_BOUNDARIES.actEnd)).toEqual([]);
    });
});

describe("改造のアクト終了リセット（16-4 是正・KI-045）", () => {
    const modded = (id, rows) => ({ id, type: "weapon", system: { modifications: rows } });

    it("アクト終了で改造行が全て除去される（改造はアクト終了で元に戻る）", () => {
        expect(planItemBoundaryUpdates(
            [modded("a", [{ param: "attack", value: 2, note: "" }, { param: "hide", value: 2, note: "" }])],
            TNX_BOUNDARIES.actEnd,
        )).toEqual([{ _id: "a", "system.modifications": [] }]);
    });

    it("アクト終了より手前の境界では除去しない・改造なしは更新に含めない", () => {
        expect(planItemBoundaryUpdates(
            [modded("a", [{ param: "attack", value: 2, note: "" }])], TNX_BOUNDARIES.exit)).toEqual([]);
        expect(planItemBoundaryUpdates([modded("a", [])], TNX_BOUNDARIES.actEnd)).toEqual([]);
    });
});
