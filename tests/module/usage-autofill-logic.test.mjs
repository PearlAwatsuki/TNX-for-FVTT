import { describe, it, expect } from "vitest";
import "../setup.mjs";

const {
    resolveTarget, resolveRange, resolveTargetValue, resolveTiming, normalizeUsageExplanation,
} = await import("../../scripts/module/usage-autofill-logic.mjs");

// 正本: Check_Rules.md「組み合わせ後の対象」「組み合わせ後の射程」。
// 解説参照/その他の最下位フォールバックと「その他」への変換は KI-033(2026-07-19 ユーザー裁定)。

describe("resolveTarget()（対象優先度）", () => {
    it("優先度順に解決する(自身 > 単体)", () => {
        expect(resolveTarget([
            { target: "single", isFixed: false },
            { target: "self", isFixed: false },
        ])).toEqual({ target: "self", isFixed: false });
    });

    it("単体※(変更不可)は単体より優先される", () => {
        expect(resolveTarget([
            { target: "team", isFixed: false },
            { target: "single", isFixed: true },
        ])).toEqual({ target: "single", isFixed: true });
    });

    it("有効値が1つでもあれば解説参照/その他は勝たない", () => {
        expect(resolveTarget([
            { target: "explanation" },
            { target: "single", isFixed: false },
        ])).toEqual({ target: "single", isFixed: false });
        expect(resolveTarget([
            { target: "other", otherText: "自由記入" },
            { target: "area", isFixed: false },
        ])).toEqual({ target: "area", isFixed: false });
    });

    it("解説参照だけなら「その他」(自由記入欄は空)", () => {
        expect(resolveTarget([{ target: "explanation" }, { target: "blank" }]))
            .toEqual({ target: "other", isFixed: false, otherText: "" });
    });

    it("その他だけなら「その他」+自由記入欄を複写", () => {
        expect(resolveTarget([{ target: "other", otherText: "任意のトループ" }]))
            .toEqual({ target: "other", isFixed: false, otherText: "任意のトループ" });
    });

    it("blank のみ・空は null(何も写さない)", () => {
        expect(resolveTarget([{ target: "blank" }])).toBeNull();
        expect(resolveTarget([])).toBeNull();
    });
});

describe("resolveRange()（射程優先度）", () => {
    it("至近※は最優先・※複数は最短を採用", () => {
        expect(resolveRange([
            { range: "long", isFixed: false },
            { range: "close", isFixed: true },
        ])).toEqual({ range: "close", isFixed: true });
        expect(resolveRange([
            { range: "middle", isFixed: true },
            { range: "short", isFixed: true },
        ])).toEqual({ range: "short", isFixed: true });
    });

    it("有効値が1つでもあれば解説参照/その他は勝たない", () => {
        expect(resolveRange([
            { range: "explanation" },
            { range: "close", isFixed: false },
        ])).toEqual({ range: "close", isFixed: false });
    });

    it("解説参照だけなら「その他」・その他は自由記入欄を複写", () => {
        expect(resolveRange([{ range: "explanation" }]))
            .toEqual({ range: "other", isFixed: false, otherText: "" });
        expect(resolveRange([{ range: "other", otherText: "視界" }]))
            .toEqual({ range: "other", isFixed: false, otherText: "視界" });
    });

    it("blank・なし(none)は無視される", () => {
        expect(resolveRange([{ range: "none" }, { range: "blank" }])).toBeNull();
    });
});

describe("resolveTargetValue()（目標値）", () => {
    it("数値があれば最大を採用", () => {
        expect(resolveTargetValue([
            { targetValue: "number", number: 8 },
            { targetValue: "number", number: 12 },
            { targetValue: "control" },
        ])).toEqual({ targetValue: "number", targetValueNumber: 12 });
    });

    it("実値型(制御値等)は記載順が後でも解説参照/その他より優先", () => {
        expect(resolveTargetValue([
            { targetValue: "explanation" },
            { targetValue: "control" },
        ])).toEqual({ targetValue: "control" });
    });

    it("解説参照だけなら「その他」(式欄は空)・その他は式欄を複写", () => {
        expect(resolveTargetValue([{ targetValue: "explanation", otherText: "式" }]))
            .toEqual({ targetValue: "other", targetValueOther: "" });
        expect(resolveTargetValue([{ targetValue: "other", otherText: "@system.reason.value" }]))
            .toEqual({ targetValue: "other", targetValueOther: "@system.reason.value" });
    });

    it("blank・なし(none)のみは null", () => {
        expect(resolveTargetValue([{ targetValue: "none" }, { targetValue: "blank" }])).toBeNull();
    });
});

describe("resolveTiming()（タイミング）", () => {
    it("最初の実値 timing を採用する", () => {
        expect(resolveTiming([
            { value: "blank" },
            { value: "action", actionName: "major", processName: "blank", timingOther: "" },
        ])).toEqual({ value: "action", actionName: "major", processName: "blank", timingOther: "" });
    });

    it("解説参照/その他を跨いで実値を採る", () => {
        expect(resolveTiming([
            { value: "explanation" },
            { value: "always" },
        ])).toEqual({ value: "always", actionName: "blank", processName: "blank", timingOther: "" });
    });

    it("解説参照だけなら「その他」(サブ選択は blank・自由記入欄は空)", () => {
        expect(resolveTiming([{ value: "explanation" }]))
            .toEqual({ value: "other", actionName: "blank", processName: "blank", timingOther: "" });
    });

    it("その他だけならそのまま採用(自由記入欄を保持)", () => {
        expect(resolveTiming([{ value: "other", timingOther: "解決時" }]))
            .toEqual({ value: "other", actionName: "blank", processName: "blank", timingOther: "解決時" });
    });

    it("サブ選択(アクション/プロセス種別)の解説参照も「その他」へ変換", () => {
        expect(resolveTiming([{ value: "action", actionName: "explanation", processName: "blank" }]))
            .toEqual({ value: "action", actionName: "other", processName: "blank", timingOther: "" });
    });

    it("全て blank・空配列・非配列は null", () => {
        expect(resolveTiming([{ value: "blank" }])).toBeNull();
        expect(resolveTiming([])).toBeNull();
        expect(resolveTiming(undefined)).toBeNull();
    });
});

describe("normalizeUsageExplanation()（保存済み用途の解説参照→その他の冪等正規化）", () => {
    it("対象・射程・目標値・タイミング(値/サブ選択)の解説参照を「その他」へ変換する", () => {
        const usage = {
            target: "explanation", range: "explanation", targetValue: "explanation",
            timing: { value: "explanation", actionName: "explanation", processName: "explanation", timingOther: "" },
            targetValueOther: "@system.reason.value",
        };
        expect(normalizeUsageExplanation(usage)).toBe(true);
        expect(usage.target).toBe("other");
        expect(usage.range).toBe("other");
        expect(usage.targetValue).toBe("other");
        expect(usage.timing).toEqual({ value: "other", actionName: "other", processName: "other", timingOther: "" });
        // 目標値の式欄は両値で共用のため保持される
        expect(usage.targetValueOther).toBe("@system.reason.value");
    });

    it("解説参照が無ければ何も変えず false", () => {
        const usage = { target: "single", range: "close", targetValue: "number", timing: { value: "action" } };
        const before = JSON.parse(JSON.stringify(usage));
        expect(normalizeUsageExplanation(usage)).toBe(false);
        expect(usage).toEqual(before);
    });

    it("冪等(2回目は変更なし)・timing 欠落データも安全", () => {
        const usage = { target: "explanation" };
        expect(normalizeUsageExplanation(usage)).toBe(true);
        expect(normalizeUsageExplanation(usage)).toBe(false);
        expect(usage.target).toBe("other");
    });
});
