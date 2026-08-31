/**
 * 改造項目レジストリ(16-4)のテスト。
 * 正本: Purchase_and_Modification.md「改造可能な項目(分類別)」(2026-08-30 ユーザー提供)
 * ＋改造の重複規約(2026-08-31 verbatim)。
 */
import { describe, it, expect } from "vitest";
import {
    paramsForClassifications, paramAvailability, listModificationChoices,
    modificationUnavailableReason, applyModificationsToTotals, hasDrugTimingOverride,
} from "../../scripts/data/item/modification-params.mjs";

const C = (major, minor = "") => ({ major, minor });

describe("paramsForClassifications()（分類別の改造可能項目=テーブルの符号化）", () => {
    it("武器: 隠・攻・受・電制", () => {
        expect(paramsForClassifications([C("weapon", "melee")]))
            .toEqual(["hide", "attack", "guard", "hack"]);
    });

    it("防具: 隠・防(一括)・制・電制", () => {
        expect(paramsForClassifications([C("armor", "bodyArmor")]))
            .toEqual(["hide", "defence", "control", "hack"]);
    });

    it("ヴィークル: 隠・攻・防・制(最大0)・乗員・スロット・電制", () => {
        expect(paramsForClassifications([C("vehicle", "groundVehicle")]))
            .toEqual(["hide", "attack", "defence", "control", "passenger", "slotNormal", "hack"]);
    });

    it("サイバーウェア(IANUS・全身義体以外): 隠・電制", () => {
        expect(paramsForClassifications([C("cyberware", "neuralware")])).toEqual(["hide", "hack"]);
    });

    it("サイバーウェア(IANUS): 隠・制・電制／(全身義体): 隠・防・攻・受・電制", () => {
        expect(paramsForClassifications([C("cyberware", "ianus")])).toEqual(["hide", "control", "hack"]);
        expect(paramsForClassifications([C("cyberware", "fullCyborg")]))
            .toEqual(["hide", "defence", "attack", "guard", "hack"]);
    });

    it("トロン(タップ以外): 隠・電制／(タップ): 隠・電制・ソ・ハ・CS", () => {
        expect(paramsForClassifications([C("tron", "pocketron")])).toEqual(["hide", "hack"]);
        expect(paramsForClassifications([C("tron", "tap")]))
            .toEqual(["hide", "hack", "slotSoftware", "slotHardware", "combatSpeed"]);
    });

    it("生体装備: 隠・電制（小分類は item 大分類配下=その他行に落ちる）", () => {
        expect(paramsForClassifications([C("item", "biotech")])).toEqual(["hide", "hack"]);
    });

    it("住宅施設: 登場±・セキュリティ一括／住宅オプション・アクセサリ: 隠・電制", () => {
        expect(paramsForClassifications([C("housing", "residence")])).toEqual(["appearance", "security"]);
        expect(paramsForClassifications([C("housing", "housingOption")])).toEqual(["hide", "hack"]);
        expect(paramsForClassifications([C("housing", "housingAccessory")])).toEqual(["hide", "hack"]);
    });

    it("ドラッグ: 特殊（マイナーアクション化）のみ", () => {
        expect(paramsForClassifications([C("item", "drug")])).toEqual(["drugTiming"]);
    });

    it("その他（該当行なし・分類なし）: 隠・電制", () => {
        expect(paramsForClassifications([C("service", "social")])).toEqual(["hide", "hack"]);
        expect(paramsForClassifications([])).toEqual(["hide", "hack"]);
    });

    it("複数分類は全分類の項目の和集合（「両方の分類として扱う」）", () => {
        expect(paramsForClassifications([C("weapon", "melee"), C("cyberware", "neuralware")]))
            .toEqual(["hide", "attack", "guard", "hack"]);
        expect(paramsForClassifications([C("item", "drug"), C("weapon", "melee")]))
            .toEqual(["drugTiming", "hide", "attack", "guard", "hack"]);
    });
});

describe("paramAvailability() / listModificationChoices()（「ー」「解説参照」「改造済み」の不能化）", () => {
    const sys = {
        hide: { mode: "value", value: 10, total: 10 },
        hack: { mode: "none" },
        guardValue: { mode: "reference" },
        attack: { damageType: "S", value: 4 },
        modifications: [{ param: "hide", value: 2, note: "" }],
    };

    it("mode=value は ok・none は novalue・reference は reference", () => {
        expect(paramAvailability(sys, "hide")).toBe("ok");
        expect(paramAvailability(sys, "hack")).toBe("novalue");
        expect(paramAvailability(sys, "guard")).toBe("reference");
    });

    it("攻撃力は種別も値も無ければ novalue（略号行の「ー」と同じ読み）", () => {
        expect(paramAvailability(sys, "attack")).toBe("ok");
        expect(paramAvailability({ attack: { damageType: "", value: 0 } }, "attack")).toBe("novalue");
    });

    it("改造済み項目は modified（1項目1回・技能を問わず）", () => {
        const choices = listModificationChoices(sys, [C("weapon", "melee")]);
        expect(choices.find((c) => c.key === "hide").availability).toBe("modified");
        expect(choices.find((c) => c.key === "attack").availability).toBe("ok");
    });

    it("不能理由の文言が区別される", () => {
        expect(modificationUnavailableReason("modified")).toContain("改造済み");
        expect(modificationUnavailableReason("reference")).toContain("解説参照");
        expect(modificationUnavailableReason("novalue")).toContain("ー");
    });
});

describe("applyModificationsToTotals()（実効値合流）", () => {
    it("modeValue 系・防(一括)・スロットへ加算する", () => {
        const sys = {
            hide: { mode: "value", value: 10, total: 10 },
            hack: { mode: "value", value: 12, total: 12 },
            defence: { mode: "value", S_total: 1, P_total: 2, I_total: 0 },
            slots: [{ kind: "software", count: { mode: "value", value: 2, total: 2 } }],
            modifications: [
                { param: "hide", value: 2 }, { param: "defence", value: 1 },
                { param: "slotSoftware", value: 1 },
            ],
        };
        applyModificationsToTotals(sys, [C("tron", "tap")]);
        expect(sys.hide.total).toBe(12);
        expect(sys.hack.total).toBe(12);
        expect(sys.defence).toEqual({ mode: "value", S_total: 2, P_total: 3, I_total: 1 });
        expect(sys.slots[0].count.total).toBe(3);
    });

    it("ヴィークル分類の制御値修正は合算後に最大0でクランプ", () => {
        const sys = {
            controlMod: { mode: "value", value: -1, total: -1 },
            modifications: [{ param: "control", value: 3 }],
        };
        applyModificationsToTotals(sys, [C("vehicle", "groundVehicle")]);
        expect(sys.controlMod.total).toBe(0);
        // 防具(非ヴィークル)はクランプしない
        const sys2 = {
            controlMod: { mode: "value", value: -1, total: -1 },
            modifications: [{ param: "control", value: 3 }],
        };
        applyModificationsToTotals(sys2, [C("armor", "bodyArmor")]);
        expect(sys2.controlMod.total).toBe(2);
    });

    it("住宅の登場±とセキュリティ一括・素値は不変", () => {
        const sys = {
            appearanceTarget: 10, appearanceTargetTotal: 10,
            cyberSecurity: 8, cyberSecurityTotal: 8, analogSecurity: 8, analogSecurityTotal: 8,
            modifications: [{ param: "appearance", value: -2 }, { param: "security", value: 2 }],
        };
        applyModificationsToTotals(sys, [C("housing", "residence")]);
        expect(sys.appearanceTargetTotal).toBe(8);
        expect(sys.appearanceTarget).toBe(10);
        expect(sys.cyberSecurityTotal).toBe(10);
        expect(sys.analogSecurityTotal).toBe(10);
    });

    it("drugTiming は数値の着地なし・hasDrugTimingOverride が読む", () => {
        const sys = { hide: { mode: "value", value: 1, total: 1 }, modifications: [{ param: "drugTiming", value: 0 }] };
        applyModificationsToTotals(sys, [C("item", "drug")]);
        expect(sys.hide.total).toBe(1);
        expect(hasDrugTimingOverride(sys)).toBe(true);
        expect(hasDrugTimingOverride({ modifications: [] })).toBe(false);
    });
});
