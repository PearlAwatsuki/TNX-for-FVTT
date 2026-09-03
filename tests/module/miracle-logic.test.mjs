/**
 * 神業の純ロジック(17-1)のテスト。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Miracle_Rules.md「神業の位置づけ」「神業の構造」・
 *       llm-wiki/01_Wiki/Phases/Phase_17_Tasks_Detail.md「設計の中心 — 神業由来の印」・17-1
 */
import { describe, it, expect } from "vitest";
import {
    miracleUseGate, miracleConsumeUpdate, withDefaultMiracleConsumption,
    miracleOriginOf, isMiracleOrigin, buildMiracleCardData,
} from "../../scripts/module/miracle-logic.mjs";

describe("withDefaultMiracleConsumption()（消費先が空の神業用途は自身の使用回数×1を既定消費）", () => {
    it("消費先が空なら「このアイテム自身の使用回数 ×1」の行を補った複製を返す（元の用途は変えない）", () => {
        const usage = { _id: "u1", type: "declaration", consumeTargets: [] };
        const out = withDefaultMiracleConsumption(usage);
        expect(out.consumeTargets).toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
        expect(out).not.toBe(usage);
        expect(usage.consumeTargets).toEqual([]);
    });

    it("消費先が未定義でも同じく補う", () => {
        expect(withDefaultMiracleConsumption({ _id: "u1", type: "declaration" }).consumeTargets)
            .toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
    });

    it("消費先が設定済みならそのまま返す（上書きしない）", () => {
        const usage = { _id: "u1", consumeTargets: [{ type: "item", itemId: "x", resource: "uses", amount: 2 }] };
        expect(withDefaultMiracleConsumption(usage)).toBe(usage);
    });
});

describe("miracleOriginOf() / isMiracleOrigin()（神業由来の印）", () => {
    it("印の出どころは用途の親アイテムが miracle 型であること", () => {
        expect(miracleOriginOf({ id: "m1", type: "miracle", name: "チャイ" }))
            .toEqual({ itemId: "m1", name: "チャイ" });
    });

    it("神業以外のアイテムからは印が出ない（null）", () => {
        expect(miracleOriginOf({ id: "s1", type: "styleSkill", name: "運気変換" })).toBeNull();
        expect(miracleOriginOf(null)).toBeNull();
    });

    it("カードのフラグに miracle ブロックがあれば神業由来", () => {
        expect(isMiracleOrigin({ miracle: { itemId: "m1", name: "チャイ" } })).toBe(true);
    });

    it("miracle ブロックが無い・itemId が空なら神業由来ではない", () => {
        expect(isMiracleOrigin({})).toBe(false);
        expect(isMiracleOrigin({ miracle: null })).toBe(false);
        expect(isMiracleOrigin({ miracle: { itemId: "" } })).toBe(false);
        expect(isMiracleOrigin(undefined)).toBe(false);
    });
});

describe("buildMiracleCardData()（神業カードの描画データ）", () => {
    const item = { id: "m1", type: "miracle", name: "黄泉還り", system: { furigana: "フェニックス" } };

    it("タグ「神業」・名前・ふりがな・効果文・条件・残り/最大を持つ", () => {
        expect(buildMiracleCardData(item, {
            description: "<p>不死鳥のごとく</p>", condition: "<p>復活したら</p>", remaining: 1, max: 2,
        })).toEqual({
            typeLabel: "神業", name: "黄泉還り", furigana: "フェニックス",
            description: "<p>不死鳥のごとく</p>", condition: "<p>復活したら</p>",
            remaining: 1, max: 2,
        });
    });

    it("ふりがな・効果文・条件が無ければ空文字（テンプレート側で行ごと畳む）", () => {
        const d = buildMiracleCardData({ id: "m2", type: "miracle", name: "チャイ", system: {} }, { remaining: 0, max: 1 });
        expect(d.furigana).toBe("");
        expect(d.description).toBe("");
        expect(d.condition).toBe("");
    });
});

describe("miracleUseGate()（残回数ゲート）", () => {
    it("残りがあれば ok・残り＝実効最大値−消費済み", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "2", spent: 1 } }))
            .toEqual({ ok: true, remaining: 1, max: 2 });
    });

    it("実効値 maxTotal があれば素値より優先する（AE で母数が増えた神業＝《ファイト！》）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "1", maxTotal: 2, spent: 1 } }))
            .toEqual({ ok: true, remaining: 1, max: 2 });
    });

    it("消費済みが実効最大値に達していれば不可（残り 0）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "2", spent: 2 } }))
            .toEqual({ ok: false, remaining: 0, max: 2 });
    });

    it("消費済みが最大値を超えていても残りは 0 で止まる（負にならない）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "1", spent: 3 } }).remaining).toBe(0);
    });

    it("uses を持たない system は不可", () => {
        expect(miracleUseGate({}).ok).toBe(false);
        expect(miracleUseGate(null).ok).toBe(false);
    });
});

describe("miracleConsumeUpdate()（使用による消費）", () => {
    it("消費済みを 1 増やす更新を返す（尽きていなければ isUsed には触れない）", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "3", spent: 0 } }))
            .toEqual({ "system.uses.spent": 1 });
    });

    it("この消費で尽きるなら isUsed を true にする（手動リセットの起点として残す旧挙動の維持）", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "2", spent: 1 } }))
            .toEqual({ "system.uses.spent": 2, "system.isUsed": true });
    });

    it("消費済みは実効最大値を超えない", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "1", spent: 1 } })["system.uses.spent"]).toBe(1);
    });
});
