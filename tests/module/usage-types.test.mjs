import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { usableUsagesOf } = await import("../../scripts/module/usage-types.mjs");

// _activateItemCheck(アイテムロール)の実行対象規則(2026-07-17 行動種別再編)。
// 2026-07-19 に usage-types.mjs へ抽出(KI-025 の判定要求候補列挙と規則を共有)。

describe("usableUsagesOf()（アイテムロールの実行対象用途）", () => {
    it("判定を行う用途(行動種別タイプ含む)は全て実行対象", () => {
        const actions = [
            { _id: "a", type: "check" },
            { _id: "b", type: "physicalAttack" },
            { _id: "c", type: "dodge" },
            { _id: "d", type: "move" },
            { _id: "e", type: "treatment" }, // 判定形(既定)
        ];
        expect(usableUsagesOf(actions).map(a => a._id)).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("フラグ無しの宣言は実行対象外(直接指定時のみ宣言使用)", () => {
        expect(usableUsagesOf([{ type: "declaration" }])).toEqual([]);
    });

    it("事後系フラグ付きの宣言(バフ宣言)・宣言形の治療・NPC取得宣言は実行対象", () => {
        const actions = [
            { _id: "a", type: "declaration", grantRecheck: true },
            { _id: "b", type: "declaration", modifyCheck: true },
            { _id: "c", type: "declaration", modifyDamage: true },
            { _id: "d", type: "declaration", grantSuitChange: true },
            { _id: "e", type: "treatment", executionForm: "declaration" },
            { _id: "f", type: "declaration", npcAcquire: true },
        ];
        expect(usableUsagesOf(actions).map(a => a._id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    it("空・未定義は空配列", () => {
        expect(usableUsagesOf([])).toEqual([]);
        expect(usableUsagesOf(undefined)).toEqual([]);
    });
});
