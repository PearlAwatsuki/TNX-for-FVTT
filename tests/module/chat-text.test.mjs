/**
 * チャットカードの文字組み(2026-09-05)。
 * 正本: llm-wiki/01_Wiki/Game_Mechanics/Conditions.md「表記規約」・カードの折り返しの是正。
 */
import { describe, it, expect } from "vitest";
import { keepTogether } from "../../scripts/chat/chat-text.mjs";

describe("keepTogether()（折ってはいけない塊を nowrap でくくる）", () => {
    it("［状態タグ］《ルール用語》「名前」をくくる（囲みは残す）", () => {
        expect(keepTogether("［完全死亡］"))
            .toBe('<span class="tnx-nobr">［完全死亡］</span>');
        expect(keepTogether("《難攻不落》が「ゲスト」への［完全死亡］を防いだ"))
            .toBe('<span class="tnx-nobr">《難攻不落》</span>が<span class="tnx-nobr">「ゲスト」</span>への'
                + '<span class="tnx-nobr">［完全死亡］</span>を防いだ');
    });

    it("カード幅に収まらない長い塊はくくらない（nowrap にするとはみ出すため）", () => {
        const long = `「${"あ".repeat(11)}」`;
        expect(keepTogether(long)).toBe(long);
        const ok = `「${"あ".repeat(10)}」`;
        expect(keepTogether(ok)).toBe(`<span class="tnx-nobr">${ok}</span>`);
    });

    it("囲みが閉じていない・改行をまたぐものはくくらない", () => {
        expect(keepTogether("［完全死亡")).toBe("［完全死亡");
        expect(keepTogether("「あ\nい」")).toBe("「あ\nい」");
    });

    it("HTML の断片はそのまま（タグの中身は触らない）", () => {
        expect(keepTogether('<i class="fas fa-shield-halved"></i> ［気絶］'))
            .toBe('<i class="fas fa-shield-halved"></i> <span class="tnx-nobr">［気絶］</span>');
        expect(keepTogether("")).toBe("");
        expect(keepTogether(null)).toBe("");
    });
});

describe("keepTogether()（短い括弧書きも塊として扱う）", () => {
    it("（対決勝利）のような短い括弧書きは折らない", () => {
        expect(keepTogether("判定成功（対決勝利）")).toBe('判定成功<span class="tnx-nobr">（対決勝利）</span>');
    });

    it("長い括弧書きは対象外（折り返させる＝横にはみ出さない）", () => {
        const long = "（スート不一致・判定不成立）";
        expect(keepTogether(`攻撃失敗${long}`)).toBe(`攻撃失敗${long}`);
    });
});
