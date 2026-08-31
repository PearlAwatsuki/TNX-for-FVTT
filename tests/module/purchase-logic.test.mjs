/**
 * 購入判定の純ロジック(16-3)のテスト。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Purchase_and_Modification.md「購入判定」
 */
import { describe, it, expect } from "vitest";
import {
    decidePurchasePath, computeNoCardPurchase, purchaseCardInfo, purchaseUnavailableReason,
} from "../../scripts/module/purchase-logic.mjs";

describe("decidePurchasePath()（購入経路の3分岐）", () => {
    it("購入値「解説参照」は unavailable（購入手続き自体が存在しない）", () => {
        expect(decidePurchasePath({ mode: "reference" }, 10))
            .toEqual({ path: "unavailable", reason: "reference" });
    });

    it("購入値「ー」(mode=none)・フィールド欠落は unavailable", () => {
        expect(decidePurchasePath({ mode: "none" }, 10)).toEqual({ path: "unavailable", reason: "none" });
        expect(decidePurchasePath(null, 10)).toEqual({ path: "unavailable", reason: "none" });
        expect(decidePurchasePath(undefined, 10)).toEqual({ path: "unavailable", reason: "none" });
    });

    it("購入値が外界点以下は常時入手（境界=同値も常時入手）", () => {
        expect(decidePurchasePath({ mode: "value", value: 8 }, 10)).toEqual({ path: "always", targetValue: 8 });
        expect(decidePurchasePath({ mode: "value", value: 10 }, 10)).toEqual({ path: "always", targetValue: 10 });
    });

    it("購入値が外界点を超えると判定（TN=購入値）", () => {
        expect(decidePurchasePath({ mode: "value", value: 15 }, 10)).toEqual({ path: "check", targetValue: 15 });
    });

    it("実効値(total)があれば素値(value)より優先する（表示は全箇所実効値の規約と同じ読み）", () => {
        expect(decidePurchasePath({ mode: "value", value: 15, total: 9 }, 10))
            .toEqual({ path: "always", targetValue: 9 });
    });

    it("外界が数値でない場合は 0 として扱う（unavailable にはしない）", () => {
        expect(decidePurchasePath({ mode: "value", value: 5 }, undefined))
            .toEqual({ path: "check", targetValue: 5 });
    });
});

describe("computeNoCardPurchase()（カードなし特例=外界＋消費報酬点）", () => {
    it("達成値 = 外界 ＋ 消費報酬点。目標値以上で成功・差分値つき", () => {
        expect(computeNoCardPurchase({ mundaneTotal: 8, bountySpent: 3, targetValue: 10 }))
            .toEqual({ achievement: 11, success: true, diff: 1 });
    });

    it("境界=達成値が目標値と同値なら成功（diff 0）", () => {
        expect(computeNoCardPurchase({ mundaneTotal: 7, bountySpent: 3, targetValue: 10 }))
            .toEqual({ achievement: 10, success: true, diff: 0 });
    });

    it("届かなければ失敗（報酬点 0 でも計算は成立する=失敗する権利）", () => {
        expect(computeNoCardPurchase({ mundaneTotal: 8, bountySpent: 0, targetValue: 10 }))
            .toEqual({ achievement: 8, success: false, diff: -2 });
    });
});

describe("purchaseCardInfo()（結果カードの購入ブロック）", () => {
    it("継続文脈が無ければ null（ブロック非表示）", () => {
        expect(purchaseCardInfo(null, { success: true })).toBeNull();
        expect(purchaseCardInfo(undefined, { success: true })).toBeNull();
    });

    it("成功で granted・アイテム名を運ぶ", () => {
        expect(purchaseCardInfo({ itemName: "ポケットロン" }, { success: true }))
            .toEqual({ itemName: "ポケットロン", granted: true });
        expect(purchaseCardInfo({ itemName: "ポケットロン" }, { success: false }))
            .toEqual({ itemName: "ポケットロン", granted: false });
    });
});

describe("purchaseUnavailableReason()（不能化の理由文言）", () => {
    it("reference と none で別の文言を返す", () => {
        expect(purchaseUnavailableReason("reference")).toContain("解説参照");
        expect(purchaseUnavailableReason("none")).toContain("設定されていない");
        expect(purchaseUnavailableReason("reference")).not.toEqual(purchaseUnavailableReason("none"));
    });
});
