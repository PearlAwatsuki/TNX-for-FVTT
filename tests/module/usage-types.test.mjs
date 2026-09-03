import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { executionFormOf } = await import("../../scripts/module/usage-types.mjs");

// アイテムロール(_activateItemCheck)の候補は**用途を種別で絞らない**(2026-07-19 ユーザー指示
// 「宣言用途を勝手に除外しないでください」)。旧 usableUsagesOf(フラグ無し宣言を除外)は廃止した
// ——宣言用途しか持たないアウトフィットがロールできず解説カードに落ちていたため。
// ここでは、候補に入った各用途が _activateItemCheck の分岐で実行経路を持つこと(=到達不能な
// 用途が生まれないこと)を、分岐の判別に使う executionFormOf の側から確認する。

describe("executionFormOf()（用途の実行形式＝アイテムロールの分岐先）", () => {
    it("判定を行う用途(行動種別タイプ含む)は check", () => {
        expect(executionFormOf({ type: "check" })).toBe("check");
        expect(executionFormOf({ type: "physicalAttack" })).toBe("check");
        expect(executionFormOf({ type: "dodge" })).toBe("check");
        expect(executionFormOf({ type: "move" })).toBe("check");
    });

    it("宣言は declaration（フラグの有無で形式は変わらない＝どちらも実行経路を持つ）", () => {
        expect(executionFormOf({ type: "declaration" })).toBe("declaration");
        expect(executionFormOf({ type: "declaration", grantRecheck: true })).toBe("declaration");
        expect(executionFormOf({ type: "declaration", npcAcquire: true })).toBe("declaration");
    });

    it("治療は用途の executionForm で判定形/宣言形が固定される", () => {
        expect(executionFormOf({ type: "treatment" })).toBe("check");
        expect(executionFormOf({ type: "treatment", executionForm: "declaration" })).toBe("declaration");
    });
});

// ─── 神業専用の用途タイプ(フェーズ17-2・2026-09-03 ユーザー提案) ───────────────────────
// 「神業アイテムにしか表示されず、神業アイテムではこれ以外表示されない用途」。
// 正本: Phase_17_Tasks_Detail 設計判断1(宣言・即死・防御・社会戦・破壊の5種)。
const { USAGE_TYPE_DEFS, isMiracleType, usageTypeLabelsFor, defaultUsageTypeFor }
    = await import("../../scripts/module/usage-types.mjs");

describe("神業専用の用途タイプ（宣言・即死・防御・社会戦・破壊）", () => {
    const MIRACLE_KEYS = ["miracleDeclaration", "miracleKill", "miracleDefence", "miracleSocial", "miracleDestroy"];

    it("5種が kind=miracle で登録され、ラベルは 宣言/即死/防御/社会戦/破壊", () => {
        expect(MIRACLE_KEYS.map(k => USAGE_TYPE_DEFS[k]?.kind)).toEqual(Array(5).fill("miracle"));
        expect(MIRACLE_KEYS.map(k => USAGE_TYPE_DEFS[k]?.label)).toEqual(["宣言", "即死", "防御", "社会戦", "破壊"]);
    });

    it("isMiracleType は5種だけ真", () => {
        for (const k of MIRACLE_KEYS) expect(isMiracleType(k)).toBe(true);
        expect(isMiracleType("declaration")).toBe(false);
        expect(isMiracleType("check")).toBe(false);
        expect(isMiracleType("")).toBe(false);
        expect(isMiracleType(undefined)).toBe(false);
    });

    it("神業は判定を行わない＝実行形式はすべて宣言", () => {
        for (const k of MIRACLE_KEYS) expect(executionFormOf({ type: k })).toBe("declaration");
    });

    it("usageTypeLabelsFor('miracle') は神業の5種だけ（順序どおり）", () => {
        expect(Object.keys(usageTypeLabelsFor("miracle"))).toEqual(MIRACLE_KEYS);
        expect(usageTypeLabelsFor("miracle").miracleDefence).toBe("防御");
    });

    it("神業以外の親には神業の5種を出さず、既存タイプはそのまま", () => {
        const labels = usageTypeLabelsFor("styleSkill");
        for (const k of MIRACLE_KEYS) expect(labels).not.toHaveProperty(k);
        expect(labels.check).toBe("判定");
        expect(labels.declaration).toBe("宣言");
        expect(labels.purchase).toBe("購入");
    });

    it("新規用途の既定タイプ: 神業は「宣言」、それ以外は「判定」", () => {
        expect(defaultUsageTypeFor("miracle")).toBe("miracleDeclaration");
        expect(defaultUsageTypeFor("styleSkill")).toBe("check");
        expect(defaultUsageTypeFor("weapon")).toBe("check");
    });
});
