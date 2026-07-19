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
